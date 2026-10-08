import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@catalog/db";
import { createPostgresStore, createRateLimiter } from "@/lib/rate-limit";
import { DEFAULT_SIGN_IN_POLICY, createSignInGuard } from "@/lib/sign-in-guard";
import {
  isDatabaseAvailable,
  setupTestDatabase,
  testDatabaseUrl,
} from "../../../packages/scraper-core/test/helpers/testDb.ts";

/**
 * The PostgreSQL rate-limit store against a real server.
 *
 * What the unit tests cannot show: that two stores with nothing in common but
 * the database enforce one limit between them. Each "instance" below has its
 * own connection pool, which is exactly the relationship two serverless
 * function instances have to each other.
 *
 * Runs in the integration-test database, never the development catalog, and
 * every key carries a prefix unique to this run, so it can share that database
 * with any other suite.
 */

const available = await isDatabaseAvailable();
const describeIntegration = available ? describe : describe.skip;

if (!available) {
  console.warn(
    "\n[integration] PostgreSQL is not reachable; skipping. Run `docker compose up -d` to enable these tests.\n",
  );
}

describeIntegration("rate-limit store (integration)", () => {
  const run = `it-${randomUUID()}`;
  const instances: (() => Promise<void>)[] = [];
  let admin: Database;
  let closeAdmin: () => Promise<void>;

  /** A store on a connection pool of its own: one serverless instance. */
  function instance(options: Parameters<typeof createPostgresStore>[1] = { sweepProbability: 0 }) {
    const { db, close } = createDatabase({ url: testDatabaseUrl(), max: 2 });
    instances.push(close);
    return createPostgresStore(db, options);
  }

  const rowsLike = async (pattern: string): Promise<number> => {
    const rows = await admin.execute(
      sql`select count(*)::int as n from rate_limit_buckets where key like ${pattern}`,
    );
    return Number(rows[0]?.n);
  };

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    admin = setup.db;
    closeAdmin = setup.close;
  }, 120_000);

  afterAll(async () => {
    if (admin) {
      // `signin:global` is the one key below that is not unique to this run.
      await admin.execute(
        sql`delete from rate_limit_buckets where key like ${`%${run}%`} or key = 'signin:global'`,
      );
    }
    await Promise.all(instances.map((close) => close()));
    await closeAdmin?.();
  });

  it("enforces one limit between two independent instances", async () => {
    let time = 1_700_000_000_000;
    const options = {
      name: `${run}-shared`,
      limit: 5,
      windowMs: 60_000,
      onStoreError: "deny",
      now: () => time,
    } as const;
    const a = createRateLimiter({ ...options, store: instance() });
    const b = createRateLimiter({ ...options, store: instance() });

    // Alternate between them: with a counter each, all eight would pass.
    const outcomes: boolean[] = [];
    for (let i = 0; i < 8; i += 1) {
      const result = await (i % 2 === 0 ? a : b).check("visitor");
      expect(result.degraded).toBeUndefined();
      outcomes.push(result.allowed);
      time += 10;
    }
    expect(outcomes).toEqual([true, true, true, true, true, false, false, false]);

    // Both report the same window, the one the first hit opened.
    const [fromA, fromB] = [await a.check("visitor"), await b.check("visitor")];
    expect(fromA.resetAt).toBe(1_700_000_000_000 + 60_000);
    expect(fromB.resetAt).toBe(fromA.resetAt);
  });

  it("resets when the window has passed, for both instances", async () => {
    let time = 1_700_000_000_000;
    const options = {
      name: `${run}-window`,
      limit: 2,
      windowMs: 30_000,
      onStoreError: "deny",
      now: () => time,
    } as const;
    const a = createRateLimiter({ ...options, store: instance() });
    const b = createRateLimiter({ ...options, store: instance() });

    expect((await a.check("visitor")).allowed).toBe(true);
    expect((await b.check("visitor")).allowed).toBe(true);
    expect((await a.check("visitor")).allowed).toBe(false);

    time += 29_999;
    expect((await b.check("visitor")).allowed).toBe(false);

    time += 1;
    const reopened = await b.check("visitor");
    expect(reopened).toMatchObject({ allowed: true, remaining: 1, resetAt: time + 30_000 });
    expect((await a.check("visitor")).allowed).toBe(true);
    expect((await a.check("visitor")).allowed).toBe(false);
  });

  it("never loses an increment under concurrency", async () => {
    const stores = [instance(), instance()];
    const key = `${run}-race:visitor`;

    // Forty hits at once, across two pools. A read-then-write would hand
    // several of them the same count.
    const states = await Promise.all(
      Array.from({ length: 40 }, (_, i) => stores[i % 2]!.hit(key, 60_000, 1_700_000_000_000)),
    );
    const counts = states.map((state) => state.count).sort((x, y) => x - y);
    expect(counts).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));

    const limit = 10;
    expect(states.filter((state) => state.count <= limit)).toHaveLength(limit);
  });

  it("keeps separate keys separate, and peeks and resets across instances", async () => {
    const [a, b] = [instance(), instance()];
    const now = 1_700_000_000_000;

    await a.hit(`${run}-keys:one`, 60_000, now);
    await a.hit(`${run}-keys:one`, 60_000, now);
    await a.hit(`${run}-keys:two`, 60_000, now);

    expect(await b.peek(`${run}-keys:one`, now)).toEqual({ count: 2, resetAt: now + 60_000 });
    expect(await b.peek(`${run}-keys:two`, now)).toEqual({ count: 1, resetAt: now + 60_000 });
    expect(await b.peek(`${run}-keys:none`, now)).toBeNull();
    // Expired is the same as absent.
    expect(await b.peek(`${run}-keys:one`, now + 60_000)).toBeNull();

    await b.reset(`${run}-keys:one`);
    expect(await a.peek(`${run}-keys:one`, now)).toBeNull();
    expect((await a.hit(`${run}-keys:one`, 60_000, now)).count).toBe(1);
  });

  it("sweeps expired rows in bounded batches and leaves live ones alone", async () => {
    const quiet = instance();
    /*
     * Far in the past, so that these are the oldest expired rows in the table
     * whatever else is in it: the sweep takes the oldest first.
     */
    const past = 1_000_000;
    for (let i = 0; i < 7; i += 1) await quiet.hit(`${run}-sweep:old-${i}`, 1_000, past + i);
    await quiet.hit(`${run}-sweep:live`, 60_000, past + 5_000);
    expect(await rowsLike(`${run}-sweep:%`)).toBe(8);

    // Every hit sweeps, three rows at a time.
    const sweeper = instance({ sweepProbability: 1, sweepBatch: 3 });
    await sweeper.hit(`${run}-sweep:live`, 60_000, past + 5_000);
    expect(await rowsLike(`${run}-sweep:old-%`)).toBe(4);

    await sweeper.hit(`${run}-sweep:live`, 60_000, past + 5_000);
    await sweeper.hit(`${run}-sweep:live`, 60_000, past + 5_000);
    expect(await rowsLike(`${run}-sweep:old-%`)).toBe(0);

    // The live bucket was counted three more times and never deleted.
    expect(await quiet.peek(`${run}-sweep:live`, past + 5_000)).toEqual({
      count: 4,
      resetAt: past + 65_000,
    });
  });

  it("stores nothing but the key, a count and a time", async () => {
    await instance().hit(`${run}-shape:0123456789abcdef`, 60_000, 1_700_000_000_000);
    const rows = await admin.execute(
      sql`select * from rate_limit_buckets where key = ${`${run}-shape:0123456789abcdef`}`,
    );
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["count", "key", "reset_at"]);
  });

  it("holds an admin sign-in lockout across instances", async () => {
    let time = Date.now();
    const client = `${run}-client`;
    const guards = [instance(), instance()].map((store) =>
      // The burst limit is out of the way: this is about the lock.
      createSignInGuard({
        store,
        now: () => time,
        policy: { ...DEFAULT_SIGN_IN_POLICY, burstLimit: 100 },
      }),
    );

    // Four wrong passwords, spread over both instances.
    for (let i = 0; i < 4; i += 1) {
      const guard = guards[i % 2]!;
      expect(await guard.admit(client)).toEqual({ allowed: true });
      expect(await guard.recordFailure(client)).toBe(i + 1);
      time += 100;
    }

    // The lock opened on one instance is in force on the other.
    for (const guard of guards) {
      expect(await guard.admit(client)).toMatchObject({ allowed: false, reason: "backoff" });
    }

    time += 31_000;
    expect(await guards[0]!.admit(client)).toEqual({ allowed: true });
    await guards[0]!.recordSuccess(client);
  });
});
