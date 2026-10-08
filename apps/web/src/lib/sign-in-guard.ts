import "server-only";
import type { RateLimitStore } from "@/lib/rate-limit";

/**
 * Attempt limiting for admin sign-in.
 *
 * The sign-in action used to sleep 600 ms after a wrong password. On a
 * long-running server that is a crude limit; on serverless it is none, because
 * every concurrent request gets its own instance and its own sleep. What
 * bounds guessing has to be a count that all instances share, so this is built
 * on the same store as the public rate limiters.
 *
 * Three independent controls, all keyed in the shared store:
 *
 *  1. **Burst, per client.** At most `burstLimit` attempts per `burstWindowMs`,
 *     counted before the password is looked at. This is the atomic one: it is
 *     what stops a client that sends a thousand requests in the same
 *     millisecond, before any of them has had time to be recorded as a failure.
 *  2. **Backoff, per client.** After `freeFailures` wrong passwords, every
 *     further attempt opens a lock during which nothing from that client is
 *     evaluated. The lock doubles with each failure up to `maxBackoffMs`.
 *  3. **A global ceiling.** At most `globalLimit` password evaluations per
 *     `globalWindowMs` across every client. A client is cheap to change — an
 *     attacker with a pool of addresses has a pool of clean per-client
 *     allowances — and this is the number that still holds then.
 *
 * A request refused by any of them is refused **before** the password is
 * compared. That is what makes a correct password wait out a lockout: during
 * one, the answer does not depend on what was typed, so it cannot be used to
 * test a guess.
 *
 * The ceiling has a cost that is accepted on purpose: someone hammering the
 * form from many addresses can keep the operator out for as long as they keep
 * it up. For a panel that reads every customer's phone number, "nobody gets in
 * for a while" is the right failure next to "guessing is unbounded".
 *
 * Every store error fails **closed**. This is the security control itself; if
 * it cannot count, it refuses.
 */

export interface SignInPolicy {
  readonly burstLimit: number;
  readonly burstWindowMs: number;
  /** Wrong passwords a client may enter before backoff starts. */
  readonly freeFailures: number;
  /** The first lock; each further failure doubles it. */
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  /** How long a client's failures are remembered, from the first one. */
  readonly failureMemoryMs: number;
  readonly globalLimit: number;
  readonly globalWindowMs: number;
}

export const DEFAULT_SIGN_IN_POLICY: SignInPolicy = {
  burstLimit: 5,
  burstWindowMs: 60_000,
  freeFailures: 3,
  baseBackoffMs: 30_000,
  maxBackoffMs: 15 * 60_000,
  failureMemoryMs: 60 * 60_000,
  globalLimit: 20,
  globalWindowMs: 15 * 60_000,
};

/**
 * The lock an attempt opens, given the failures already on record.
 *
 * 0 until the free failures are used up, then 30 s, 1 min, 2 min, 4 min,
 * 8 min and 15 min from there on, with the default policy.
 */
export function backoffMs(failures: number, policy: SignInPolicy = DEFAULT_SIGN_IN_POLICY): number {
  if (failures < policy.freeFailures) return 0;
  // Capped before the multiplication so a large count cannot overflow.
  const doublings = Math.min(failures - policy.freeFailures, 30);
  return Math.min(policy.baseBackoffMs * 2 ** doublings, policy.maxBackoffMs);
}

export type SignInRefusal = "burst" | "backoff" | "global_ceiling" | "store_error";

export type SignInAdmission =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: SignInRefusal; readonly retryAt: number };

export interface SignInGuard {
  /** Decide whether this attempt may be evaluated. Call before comparing. */
  admit(client: string): Promise<SignInAdmission>;
  /** Record a wrong password. Returns the client's failures on record. */
  recordFailure(client: string): Promise<number>;
  /** Forget a client's failures after a correct password. */
  recordSuccess(client: string): Promise<void>;
}

export function createSignInGuard(options: {
  readonly store: RateLimitStore;
  readonly policy?: SignInPolicy;
  readonly now?: () => number;
}): SignInGuard {
  const { store } = options;
  const policy = options.policy ?? DEFAULT_SIGN_IN_POLICY;
  const now = options.now ?? (() => Date.now());

  const burstKey = (client: string) => `signin:burst:${client}`;
  const failuresKey = (client: string) => `signin:failures:${client}`;
  const lockKey = (client: string) => `signin:lock:${client}`;
  const GLOBAL_KEY = "signin:global";

  return {
    async admit(client) {
      const currentTime = now();

      try {
        const burst = await store.hit(burstKey(client), policy.burstWindowMs, currentTime);
        if (burst.count > policy.burstLimit) {
          return { allowed: false, reason: "burst", retryAt: burst.resetAt };
        }

        /*
         * The lock is a bucket whose window is the backoff, and the attempt
         * that opens it is hit number one. Any later hit inside the window is
         * a refusal. Because opening the lock *is* the atomic increment, two
         * simultaneous attempts cannot both be the one that is let through.
         *
         * Refused attempts land in a window that is already fixed, so
         * retrying early does not extend the wait.
         */
        const failures = (await store.peek(failuresKey(client), currentTime))?.count ?? 0;
        const lockFor = backoffMs(failures, policy);
        if (lockFor > 0) {
          const lock = await store.hit(lockKey(client), lockFor, currentTime);
          if (lock.count > 1) {
            return { allowed: false, reason: "backoff", retryAt: lock.resetAt };
          }
        }

        /*
         * Last, so that it counts password evaluations and not requests. If
         * it counted everything, one locked-out client retrying in a loop
         * would spend the whole ceiling on attempts that were never going to
         * be evaluated.
         */
        const global = await store.hit(GLOBAL_KEY, policy.globalWindowMs, currentTime);
        if (global.count > policy.globalLimit) {
          return { allowed: false, reason: "global_ceiling", retryAt: global.resetAt };
        }

        return { allowed: true };
      } catch {
        return {
          allowed: false,
          reason: "store_error",
          retryAt: currentTime + policy.burstWindowMs,
        };
      }
    },

    async recordFailure(client) {
      const state = await store.hit(failuresKey(client), policy.failureMemoryMs, now());
      return state.count;
    },

    async recordSuccess(client) {
      await store.reset(failuresKey(client));
      await store.reset(lockKey(client));
    },
  };
}

/* -- the attempt ----------------------------------------------------------- */

/**
 * One line per attempt that did not sign anyone in.
 *
 * `client` is the salted hash from `networkFingerprint`. The attempted
 * password, the raw address and the user agent are not parameters of anything
 * in this file, which is the simplest way to be sure they are never logged.
 */
export interface SignInLogEntry {
  readonly level: "warn" | "error";
  readonly msg: "admin.signin.failed" | "admin.signin.refused" | "admin.signin.guard_error";
  readonly reason: SignInRefusal | "bad_password";
  readonly client: string;
  readonly failures?: number;
  readonly retryAfterSeconds?: number;
}

export type SignInOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: SignInRefusal | "bad_password" };

/**
 * Run one sign-in attempt through the guard.
 *
 * `matches` is a thunk rather than the password so that the comparison is
 * provably not reached when the guard refuses, and so that this module never
 * holds the attempted value.
 */
export async function attemptSignIn(input: {
  readonly guard: SignInGuard;
  readonly client: string;
  readonly matches: () => boolean;
  readonly log: (entry: SignInLogEntry) => void;
  readonly now?: () => number;
}): Promise<SignInOutcome> {
  const { guard, client, log } = input;
  const now = input.now ?? (() => Date.now());

  const admission = await guard.admit(client);
  if (!admission.allowed) {
    log({
      level: admission.reason === "store_error" ? "error" : "warn",
      msg: "admin.signin.refused",
      reason: admission.reason,
      client,
      retryAfterSeconds: Math.max(1, Math.ceil((admission.retryAt - now()) / 1000)),
    });
    return { ok: false, reason: admission.reason };
  }

  if (!input.matches()) {
    try {
      const failures = await guard.recordFailure(client);
      log({ level: "warn", msg: "admin.signin.failed", reason: "bad_password", client, failures });
    } catch {
      /* The failure could not be counted. This attempt is refused either way,
         and the next one meets the same broken store in `admit`, which fails
         closed — so nothing is gained by the guess, only the count is lost. */
      log({ level: "error", msg: "admin.signin.guard_error", reason: "bad_password", client });
    }
    return { ok: false, reason: "bad_password" };
  }

  try {
    await guard.recordSuccess(client);
  } catch {
    /* The password was right and the guard let it through. Failing to clear
       old counters only means a stale lock expires by itself; it is not a
       reason to refuse the operator. */
    log({ level: "error", msg: "admin.signin.guard_error", reason: "store_error", client });
  }
  return { ok: true };
}
