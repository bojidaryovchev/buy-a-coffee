import { describe, expect, it } from "vitest";
import { type RateLimitStore, createMemoryStore } from "@/lib/rate-limit";
import {
  DEFAULT_SIGN_IN_POLICY,
  type SignInLogEntry,
  type SignInPolicy,
  attemptSignIn,
  backoffMs,
  createSignInGuard,
} from "@/lib/sign-in-guard";

/**
 * Admin sign-in attempt limiting.
 *
 * Driven through `attemptSignIn`, the same function the server action calls,
 * against the memory store and an injected clock.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const PASSWORD = "correct horse battery staple";

/** A burst limit high enough to stay out of the way of the backoff tests. */
const QUIET_BURST: SignInPolicy = { ...DEFAULT_SIGN_IN_POLICY, burstLimit: 1_000 };

function harness(policy: SignInPolicy = QUIET_BURST, store: RateLimitStore = createMemoryStore()) {
  let time = 1_000_000;
  const log: SignInLogEntry[] = [];
  let comparisons = 0;
  const guard = createSignInGuard({ store, policy, now: () => time });

  const attempt = (password: string, client = "client-a") =>
    attemptSignIn({
      guard,
      client,
      matches: () => {
        comparisons += 1;
        return password === PASSWORD;
      },
      log: (entry) => log.push(entry),
      now: () => time,
    });

  return {
    attempt,
    log,
    advance: (ms: number) => {
      time += ms;
    },
    comparisons: () => comparisons,
  };
}

describe("backoffMs", () => {
  it("is zero for the free failures, then doubles to a cap", () => {
    expect([0, 1, 2].map((n) => backoffMs(n))).toEqual([0, 0, 0]);
    expect([3, 4, 5, 6, 7].map((n) => backoffMs(n))).toEqual([
      30 * SECOND,
      MINUTE,
      2 * MINUTE,
      4 * MINUTE,
      8 * MINUTE,
    ]);
    expect(backoffMs(8)).toBe(15 * MINUTE);
    expect(backoffMs(10_000)).toBe(15 * MINUTE);
  });
});

describe("sign-in lockout and backoff", () => {
  it("signs in with the right password and no history", async () => {
    const { attempt, log } = harness();
    expect(await attempt(PASSWORD)).toEqual({ ok: true });
    expect(log).toEqual([]);
  });

  it("locks a client out after repeated wrong passwords", async () => {
    const { attempt } = harness();

    // Three free failures, and the fourth attempt opens the first lock.
    for (let i = 0; i < 4; i += 1) {
      expect(await attempt("wrong")).toEqual({ ok: false, reason: "bad_password" });
    }
    expect(await attempt("wrong")).toEqual({ ok: false, reason: "backoff" });
  });

  it("makes a correct password wait out the lockout, then accepts it", async () => {
    const { attempt, advance, comparisons } = harness();
    for (let i = 0; i < 4; i += 1) await attempt("wrong");
    const compared = comparisons();

    // Locked for 30 s. The right password is refused, without being compared.
    expect(await attempt(PASSWORD)).toEqual({ ok: false, reason: "backoff" });
    advance(29 * SECOND);
    expect(await attempt(PASSWORD)).toEqual({ ok: false, reason: "backoff" });
    expect(comparisons()).toBe(compared);

    advance(2 * SECOND);
    expect(await attempt(PASSWORD)).toEqual({ ok: true });
  });

  it("grows the lock with every further failure", async () => {
    const { attempt, advance } = harness();
    for (let i = 0; i < 4; i += 1) await attempt("wrong");

    // After the 4th failure the lock in force is the 30 s one it opened; each
    // attempt after that opens one twice as long.
    const expectedLocks = [30 * SECOND, MINUTE, 2 * MINUTE, 4 * MINUTE];
    for (const lock of expectedLocks) {
      advance(lock - SECOND);
      expect(await attempt("wrong")).toEqual({ ok: false, reason: "backoff" });
      advance(SECOND);
      expect(await attempt("wrong")).toEqual({ ok: false, reason: "bad_password" });
    }
  });

  it("does not lengthen the wait when a locked-out client keeps retrying", async () => {
    const { attempt, advance } = harness();
    for (let i = 0; i < 4; i += 1) await attempt("wrong");

    for (let i = 0; i < 20; i += 1) {
      expect(await attempt(PASSWORD)).toEqual({ ok: false, reason: "backoff" });
      advance(SECOND);
    }
    advance(10 * SECOND);
    expect(await attempt(PASSWORD)).toEqual({ ok: true });
  });

  it("keeps one client's lockout from touching another", async () => {
    const { attempt } = harness();
    for (let i = 0; i < 5; i += 1) await attempt("wrong", "client-a");
    expect(await attempt(PASSWORD, "client-b")).toEqual({ ok: true });
  });

  it("forgets a client's failures after a successful sign-in", async () => {
    const { attempt } = harness();
    for (let i = 0; i < 3; i += 1) await attempt("wrong");
    expect(await attempt(PASSWORD)).toEqual({ ok: true });

    // Three free failures again, rather than an immediate lock.
    for (let i = 0; i < 4; i += 1) {
      expect(await attempt("wrong")).toEqual({ ok: false, reason: "bad_password" });
    }
  });

  it("lets only one of several simultaneous attempts through a lock", async () => {
    const { attempt, advance } = harness();
    for (let i = 0; i < 4; i += 1) await attempt("wrong");
    advance(31 * SECOND);

    const outcomes = await Promise.all(Array.from({ length: 10 }, () => attempt("wrong")));
    expect(outcomes.filter((o) => !o.ok && o.reason === "bad_password")).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok && o.reason === "backoff")).toHaveLength(9);
  });
});

describe("sign-in burst limit", () => {
  it("refuses a client's attempts beyond the burst, before comparing", async () => {
    const { attempt, comparisons, advance } = harness({
      ...DEFAULT_SIGN_IN_POLICY,
      freeFailures: 1_000,
    });

    const outcomes = await Promise.all(Array.from({ length: 12 }, () => attempt("wrong")));
    expect(outcomes.filter((o) => !o.ok && o.reason === "burst")).toHaveLength(7);
    expect(comparisons()).toBe(5);

    advance(MINUTE + 1);
    expect(await attempt(PASSWORD)).toEqual({ ok: true });
  });
});

describe("sign-in global ceiling", () => {
  it("stops evaluating passwords for everybody once the ceiling is reached", async () => {
    const { attempt, advance, comparisons } = harness();

    // Twenty different clients, one guess each: no per-client control trips.
    for (let i = 0; i < 20; i += 1) {
      expect(await attempt("wrong", `client-${i}`)).toEqual({ ok: false, reason: "bad_password" });
    }
    expect(comparisons()).toBe(20);

    // The twenty-first is a client nobody has seen, with the right password.
    expect(await attempt(PASSWORD, "operator")).toEqual({ ok: false, reason: "global_ceiling" });
    expect(comparisons()).toBe(20);

    advance(15 * MINUTE + 1);
    expect(await attempt(PASSWORD, "operator")).toEqual({ ok: true });
  });

  it("does not spend the ceiling on attempts refused by a client's own lock", async () => {
    const { attempt, advance } = harness();
    for (let i = 0; i < 4; i += 1) await attempt("wrong", "noisy");
    for (let i = 0; i < 100; i += 1) await attempt("wrong", "noisy");

    advance(SECOND);
    expect(await attempt(PASSWORD, "operator")).toEqual({ ok: true });
  });
});

describe("sign-in when the store is down", () => {
  const broken: RateLimitStore = {
    hit: () => Promise.reject(new Error("connection refused")),
    peek: () => Promise.reject(new Error("connection refused")),
    reset: () => Promise.reject(new Error("connection refused")),
  };

  it("fails closed: the right password is refused and never compared", async () => {
    const { attempt, comparisons, log } = harness(QUIET_BURST, broken);
    expect(await attempt(PASSWORD)).toEqual({ ok: false, reason: "store_error" });
    expect(comparisons()).toBe(0);
    expect(log[0]).toMatchObject({
      level: "error",
      msg: "admin.signin.refused",
      reason: "store_error",
    });
  });
});

describe("sign-in logging", () => {
  it("logs failures and refusals as structured lines", async () => {
    const { attempt, log } = harness();
    for (let i = 0; i < 4; i += 1) await attempt("wrong");
    await attempt("wrong");

    expect(log).toHaveLength(5);
    expect(log[0]).toEqual({
      level: "warn",
      msg: "admin.signin.failed",
      reason: "bad_password",
      client: "client-a",
      failures: 1,
    });
    expect(log[3]).toMatchObject({ msg: "admin.signin.failed", failures: 4 });
    expect(log[4]).toEqual({
      level: "warn",
      msg: "admin.signin.refused",
      reason: "backoff",
      client: "client-a",
      retryAfterSeconds: 30,
    });
  });

  it("never logs the attempted value", async () => {
    const { attempt, log } = harness();
    const guesses = ["hunter2-attempted-value", "another-secret-guess", PASSWORD.slice(0, -1)];
    for (const guess of guesses) await attempt(guess);
    for (let i = 0; i < 3; i += 1) await attempt("locked-out-guess");

    const written = JSON.stringify(log);
    for (const guess of [...guesses, "locked-out-guess"]) expect(written).not.toContain(guess);
    // And no field exists that could carry one.
    for (const entry of log) {
      expect(Object.keys(entry).sort()).toEqual(
        expect.arrayContaining(["client", "level", "msg", "reason"]),
      );
      expect(Object.keys(entry)).not.toEqual(expect.arrayContaining(["password"]));
    }
  });
});
