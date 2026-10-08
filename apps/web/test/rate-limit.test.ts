import { afterEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  type RateLimitStore,
  type SqlExecutor,
  clientFingerprint,
  createMemoryStore,
  createPostgresStore,
  createRateLimiter,
  networkFingerprint,
} from "@/lib/rate-limit";

/**
 * Store and limiter logic, without a database.
 *
 * The PostgreSQL store is exercised here against a recording executor: what
 * statements it sends, and what it does when one fails. That the statement is
 * actually atomic can only be shown against a real server, which is what
 * `rate-limit.integration.test.ts` is for.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const brokenStore: RateLimitStore = {
  hit: () => Promise.reject(new Error("relation rate_limit_buckets does not exist")),
  peek: () => Promise.reject(new Error("down")),
  reset: () => Promise.reject(new Error("down")),
};

describe("createMemoryStore", () => {
  it("counts hits inside one window and keeps the window it opened with", async () => {
    const store = createMemoryStore();
    expect(await store.hit("k", 1000, 0)).toEqual({ count: 1, resetAt: 1000 });
    expect(await store.hit("k", 1000, 400)).toEqual({ count: 2, resetAt: 1000 });
    // A different window length on a live bucket does not move its end.
    expect(await store.hit("k", 9000, 999)).toEqual({ count: 3, resetAt: 1000 });
  });

  it("restarts an expired bucket", async () => {
    const store = createMemoryStore();
    await store.hit("k", 1000, 0);
    expect(await store.hit("k", 1000, 1000)).toEqual({ count: 1, resetAt: 2000 });
  });

  it("peeks without counting, and not at expired buckets", async () => {
    const store = createMemoryStore();
    expect(await store.peek("k", 0)).toBeNull();
    await store.hit("k", 1000, 0);
    expect(await store.peek("k", 500)).toEqual({ count: 1, resetAt: 1000 });
    expect(await store.peek("k", 500)).toEqual({ count: 1, resetAt: 1000 });
    expect(await store.peek("k", 1000)).toBeNull();
  });

  it("forgets a bucket on reset", async () => {
    const store = createMemoryStore();
    await store.hit("k", 1000, 0);
    await store.reset("k");
    expect(await store.peek("k", 1)).toBeNull();
    expect((await store.hit("k", 1000, 1)).count).toBe(1);
  });
});

describe("createRateLimiter", () => {
  it("namespaces keys, so two limiters on one store do not share a count", async () => {
    const store = createMemoryStore();
    const options = {
      limit: 1,
      windowMs: 1000,
      onStoreError: "deny",
      store,
      now: () => 0,
    } as const;
    const first = createRateLimiter({ ...options, name: "first" });
    const second = createRateLimiter({ ...options, name: "second" });

    expect((await first.check("a")).allowed).toBe(true);
    expect((await second.check("a")).allowed).toBe(true);
    expect((await first.check("a")).allowed).toBe(false);
  });

  it("shares a count between two limiters with the same name on one store", async () => {
    const store = createMemoryStore();
    const options = { name: "n", limit: 2, windowMs: 1000, onStoreError: "deny", store } as const;
    const a = createRateLimiter({ ...options, now: () => 0 });
    const b = createRateLimiter({ ...options, now: () => 0 });

    expect((await a.check("x")).allowed).toBe(true);
    expect((await b.check("x")).allowed).toBe(true);
    expect((await a.check("x")).allowed).toBe(false);
    expect((await b.check("x")).allowed).toBe(false);
  });

  it("fails open when told to: allows, says so, and still limits per process", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const limiter = createRateLimiter({
      name: "inquiry",
      limit: 2,
      windowMs: 1000,
      onStoreError: "allow",
      store: brokenStore,
      now: () => 0,
    });

    const first = await limiter.check("a");
    expect(first).toMatchObject({ allowed: true, degraded: true });
    expect((await limiter.check("a")).allowed).toBe(true);
    // The fallback is a real limiter, not an open door.
    expect((await limiter.check("a")).allowed).toBe(false);

    const line = JSON.parse(String(logged.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({
      msg: "rate_limit.store_failed",
      limiter: "inquiry",
      failing: "open",
    });
  });

  it("fails closed when told to: refuses and says so", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const limiter = createRateLimiter({
      name: "signin",
      limit: 100,
      windowMs: 1000,
      onStoreError: "deny",
      store: brokenStore,
      now: () => 0,
    });

    expect(await limiter.check("a")).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: 1000,
      degraded: true,
    });
    const line = JSON.parse(String(logged.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({ limiter: "signin", failing: "closed" });
  });

  it("never logs the key when the store fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const limiter = createRateLimiter({
      name: "contact",
      limit: 1,
      windowMs: 1000,
      onStoreError: "allow",
      store: brokenStore,
    });
    await limiter.check("fingerprint-value");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("fingerprint-value");
  });

  it("logs the driver's error, not the wrapper that repeats the query parameters", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // The shape Drizzle throws: the key is in the message, the reason in the cause.
    const wrapped = new Error("Failed query: insert ... params: contact:fingerprint-value,1,2", {
      cause: new Error('relation "rate_limit_buckets" does not exist'),
    });
    const limiter = createRateLimiter({
      name: "contact",
      limit: 1,
      windowMs: 1000,
      onStoreError: "allow",
      store: { ...brokenStore, hit: () => Promise.reject(wrapped) },
    });
    await limiter.check("fingerprint-value");

    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain("does not exist");
    expect(line).not.toContain("fingerprint-value");
    expect(line).not.toContain("params");
  });
});

describe("createPostgresStore", () => {
  const dialect = new PgDialect();

  /** An executor that records what it was sent and answers from a script. */
  function recorder(answer: (text: string) => Record<string, unknown>[]) {
    const statements: { text: string; params: unknown[] }[] = [];
    const executor = {
      execute: async (query: SQL) => {
        const { sql: text, params } = dialect.sqlToQuery(query);
        statements.push({ text, params });
        return answer(text);
      },
    } as unknown as SqlExecutor;
    return { executor, statements };
  }

  const oneRow = () => [{ count: "3", reset_at_ms: "61000" }];

  it("counts a hit with exactly one statement, an upsert", async () => {
    const { executor, statements } = recorder(oneRow);
    const store = createPostgresStore(executor, { random: () => 1 });

    expect(await store.hit("inquiry:abc", 60_000, 1_000)).toEqual({ count: 3, resetAt: 61_000 });

    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toMatch(/insert into rate_limit_buckets/);
    expect(statements[0]?.text).toMatch(/on conflict \(key\) do update/);
    expect(statements[0]?.text).toMatch(/returning count/);
    // The key, the new window's end, and the current time for the expiry test.
    expect(statements[0]?.params).toEqual(["inquiry:abc", 61_000, 1_000, 1_000]);
  });

  it("sweeps expired rows only on the configured fraction of hits, bounded", async () => {
    let roll = 0.5;
    const { executor, statements } = recorder(oneRow);
    const store = createPostgresStore(executor, {
      sweepProbability: 0.1,
      sweepBatch: 25,
      random: () => roll,
    });

    await store.hit("k", 1000, 5_000);
    expect(statements).toHaveLength(1);

    roll = 0.05;
    await store.hit("k", 1000, 5_000);
    expect(statements).toHaveLength(3);
    expect(statements[2]?.text).toMatch(/delete from rate_limit_buckets/);
    expect(statements[2]?.text).toMatch(/limit \$2/);
    expect(statements[2]?.params).toEqual([5_000, 25]);
  });

  it("does not fail the hit when the sweep fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { executor } = recorder((text) => {
      if (text.includes("delete from")) throw new Error("deadlock detected");
      return oneRow();
    });
    const store = createPostgresStore(executor, { sweepProbability: 1, random: () => 0 });

    await expect(store.hit("k", 1000, 0)).resolves.toEqual({ count: 3, resetAt: 61_000 });
  });

  it("reads a live bucket on peek and nothing when there is none", async () => {
    const live = createPostgresStore(recorder(oneRow).executor);
    expect(await live.peek("k", 0)).toEqual({ count: 3, resetAt: 61_000 });

    const { executor, statements } = recorder(() => []);
    expect(await createPostgresStore(executor).peek("k", 7)).toBeNull();
    expect(statements[0]?.text).toMatch(/reset_at > /);
  });

  it("resolves a deferred executor only when first used", async () => {
    const { executor } = recorder(oneRow);
    const open = vi.fn(async () => executor);
    const store = createPostgresStore(open, { random: () => 1 });
    expect(open).not.toHaveBeenCalled();
    await store.hit("k", 1000, 0);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("fingerprints", () => {
  const request = (address: string, agent: string) =>
    new Headers({ "x-forwarded-for": `${address}, 10.0.0.1`, "user-agent": agent });

  it("never contain the address or the user agent", () => {
    for (const fingerprint of [
      clientFingerprint(request("203.0.113.7", "Mozilla/5.0"), "salt"),
      networkFingerprint(request("203.0.113.7", "Mozilla/5.0"), "salt"),
    ]) {
      expect(fingerprint).toMatch(/^[0-9a-f]{32}$/);
      expect(fingerprint).not.toContain("203");
    }
  });

  it("depend on the salt", () => {
    const headers = request("203.0.113.7", "a");
    expect(clientFingerprint(headers, "one")).not.toBe(clientFingerprint(headers, "two"));
    expect(networkFingerprint(headers, "one")).not.toBe(networkFingerprint(headers, "two"));
  });

  it("network fingerprint ignores the user agent; client fingerprint does not", () => {
    const a = request("203.0.113.7", "agent-a");
    const b = request("203.0.113.7", "agent-b");
    expect(networkFingerprint(a, "s")).toBe(networkFingerprint(b, "s"));
    expect(clientFingerprint(a, "s")).not.toBe(clientFingerprint(b, "s"));
    expect(networkFingerprint(a, "s")).not.toBe(
      networkFingerprint(request("203.0.113.8", "agent-a"), "s"),
    );
  });
});
