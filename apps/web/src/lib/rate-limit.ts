import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@catalog/db";

/**
 * Rate limiting for the public endpoints and for admin sign-in.
 *
 * A fixed-window counter over a pluggable store. There are two stores:
 *
 *  - **PostgreSQL** (`rate_limit_buckets`), used whenever a database is
 *    configured. The storefront runs on serverless functions, and a counter
 *    held in memory there is one counter per warm instance: the effective
 *    limit is the configured one times N, and it resets with every cold
 *    start. A row in the database is the one place all instances share.
 *  - **In memory**, for unit tests, for a checkout with no database, and as
 *    the floor a fail-open limiter drops to when the table is unreachable.
 *
 * The database was chosen over a Redis because it is already there. This is a
 * small shop: one more round trip on a form submission is nothing, and a
 * second stateful service to provision, pay for and monitor is not.
 *
 * What happens when the store itself fails is decided per limiter and is
 * never implicit — see `onStoreError` below.
 */

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
  /** True when the shared store failed and this answer is the fallback. */
  readonly degraded?: boolean;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

/** One bucket as a store reports it. Times are epoch milliseconds. */
export interface BucketState {
  readonly count: number;
  readonly resetAt: number;
}

/**
 * Where the counters live.
 *
 * `now` is passed in rather than read from the store's own clock so that the
 * memory and PostgreSQL stores behave identically and both can be tested
 * against an injected clock. The cost is that two instances disagree about a
 * window's edge by their clock skew — milliseconds on a platform that syncs
 * its clocks, against windows measured in minutes.
 */
export interface RateLimitStore {
  /**
   * Count one hit and return the bucket as it stands afterwards.
   *
   * Must be atomic: two concurrent hits on one key return different counts.
   * An expired bucket restarts at 1 with a fresh window of `windowMs`; a live
   * one keeps the window it was opened with.
   */
  hit(key: string, windowMs: number, now: number): Promise<BucketState>;
  /** Read a live bucket without counting. Expired or absent is `null`. */
  peek(key: string, now: number): Promise<BucketState | null>;
  /** Forget a bucket. */
  reset(key: string): Promise<void>;
}

/**
 * A store error, reduced to what is safe and useful to log.
 *
 * Drizzle wraps a failed query in an error whose message repeats the SQL and
 * **its parameters**, and the first parameter here is the bucket key. That is
 * a salted hash, not an address, but it has no business in a log line either.
 * The driver's own error underneath says what went wrong without it.
 */
export function describeStoreError(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return String(cause).slice(0, 300);
}

/* -- in-memory store ------------------------------------------------------- */

/** Above this many buckets, a hit first drops the expired ones. */
const MEMORY_SWEEP_THRESHOLD = 5_000;

export function createMemoryStore(): RateLimitStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  /** Drop expired buckets so the map cannot grow without bound. */
  const sweep = (now: number): void => {
    if (buckets.size < MEMORY_SWEEP_THRESHOLD) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  return {
    async hit(key, windowMs, now) {
      sweep(now);

      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        const fresh = { count: 1, resetAt: now + windowMs };
        buckets.set(key, fresh);
        return { ...fresh };
      }

      bucket.count += 1;
      return { ...bucket };
    },

    async peek(key, now) {
      const bucket = buckets.get(key);
      return bucket && bucket.resetAt > now ? { ...bucket } : null;
    },

    async reset(key) {
      buckets.delete(key);
    },
  };
}

/* -- PostgreSQL store ------------------------------------------------------ */

/** The one method of the Drizzle client the store needs. */
export type SqlExecutor = Pick<Database, "execute">;

export interface PostgresStoreOptions {
  /**
   * Chance, per hit, of also deleting expired rows. 1 in 50 by default.
   *
   * Opportunistic rather than scheduled: there is no cron to forget to
   * configure, and the cleanup rate follows the write rate by construction.
   */
  readonly sweepProbability?: number;
  /** Most rows one sweep deletes, so a sweep is never a long statement. */
  readonly sweepBatch?: number;
  readonly random?: () => number;
}

const DEFAULT_SWEEP_PROBABILITY = 0.02;
const DEFAULT_SWEEP_BATCH = 500;

/** Epoch milliseconds as a `timestamptz` expression. */
const at = (ms: number) => sql`to_timestamp(${ms}::double precision / 1000.0)`;

function toState(row: Record<string, unknown> | undefined): BucketState | null {
  if (!row) return null;
  // Numeric columns arrive as strings: the client keeps them exact on purpose.
  return { count: Number(row.count), resetAt: Number(row.reset_at_ms) };
}

/**
 * Counters in `rate_limit_buckets`.
 *
 * `executor` may be a function so the caller can defer creating a connection
 * pool until the first request that needs one.
 */
export function createPostgresStore(
  executor: SqlExecutor | (() => SqlExecutor | Promise<SqlExecutor>),
  options: PostgresStoreOptions = {},
): RateLimitStore {
  const sweepProbability = options.sweepProbability ?? DEFAULT_SWEEP_PROBABILITY;
  const sweepBatch = options.sweepBatch ?? DEFAULT_SWEEP_BATCH;
  const random = options.random ?? Math.random;
  const resolve = async (): Promise<SqlExecutor> =>
    typeof executor === "function" ? executor() : executor;

  /**
   * Delete the oldest expired rows, at most `sweepBatch` of them.
   *
   * Growth is bounded because deletion outpaces creation: a hit creates at
   * most one row, and deletes `sweepProbability * sweepBatch` (ten, by
   * default) expired ones on average. `skip locked` keeps two sweeps, or a
   * sweep and a hit, from waiting on each other.
   *
   * The batch is a materialised CTE and not `where key in (select ... limit
   * n)`, which is the obvious way to write it and is wrong: the planner is
   * free to run that subquery once per outer row, each run skips the rows the
   * last one locked and returns the next `n`, and the statement deletes far
   * more than its limit. The integration test caught exactly that.
   */
  const sweep = async (db: SqlExecutor, now: number): Promise<void> => {
    await db.execute(sql`
      with expired as materialized (
        select key from rate_limit_buckets
        where reset_at <= ${at(now)}
        order by reset_at
        limit ${sweepBatch}
        for update skip locked
      )
      delete from rate_limit_buckets as b
      using expired
      where b.key = expired.key
    `);
  };

  return {
    async hit(key, windowMs, now) {
      const db = await resolve();

      /*
       * One statement, and that is the whole point. A read followed by a write
       * lets two concurrent requests both read the old count and both pass.
       * Here the insert either creates the row or takes its row lock; a
       * concurrent hit on the same key waits for that lock and then updates
       * the row the first one committed, so no increment is ever lost.
       */
      const rows = await db.execute(sql`
        insert into rate_limit_buckets as b (key, count, reset_at)
        values (${key}, 1, ${at(now + windowMs)})
        on conflict (key) do update set
          count = case when b.reset_at <= ${at(now)} then 1 else b.count + 1 end,
          reset_at = case when b.reset_at <= ${at(now)} then excluded.reset_at else b.reset_at end
        returning count, round(extract(epoch from reset_at) * 1000) as reset_at_ms
      `);

      const state = toState(rows[0]);
      if (!state) throw new Error("rate_limit_buckets upsert returned no row");

      if (random() < sweepProbability) {
        /*
         * Awaited, because a serverless function is frozen once the response
         * is sent and a floating promise may never run. Its failure is not the
         * caller's problem: the hit above is already counted.
         */
        try {
          await sweep(db, now);
        } catch (error) {
          console.error(
            JSON.stringify({
              level: "warn",
              msg: "rate_limit.sweep_failed",
              error: describeStoreError(error),
            }),
          );
        }
      }

      return state;
    },

    async peek(key, now) {
      const db = await resolve();
      const rows = await db.execute(sql`
        select count, round(extract(epoch from reset_at) * 1000) as reset_at_ms
        from rate_limit_buckets
        where key = ${key} and reset_at > ${at(now)}
      `);
      return toState(rows[0]);
    },

    async reset(key) {
      const db = await resolve();
      await db.execute(sql`delete from rate_limit_buckets where key = ${key}`);
    },
  };
}

/* -- the limiter ----------------------------------------------------------- */

/**
 * What a limiter answers when its store throws.
 *
 *  - `"allow"` — fail open. The request goes ahead, counted against a
 *    per-process memory limiter instead, so a broken table degrades to the
 *    old behaviour rather than to no limit at all. Right wherever refusing
 *    would cost a customer something: an order must not be lost because the
 *    limiter's table is missing.
 *  - `"deny"` — fail closed. Right where the limiter is the security control
 *    itself, which is sign-in.
 *
 * There is no default. Which way a limiter fails is a decision about what it
 * protects, and it belongs in front of whoever creates one.
 */
export type StoreFailurePolicy = "allow" | "deny";

export interface RateLimiterOptions {
  /** Namespaces the keys, so limiters sharing a store cannot collide. */
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly onStoreError: StoreFailurePolicy;
  readonly store?: RateLimitStore;
  readonly now?: () => number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const store = options.store ?? createMemoryStore();
  const now = options.now ?? (() => Date.now());
  // Created on the first failure; most processes never need it.
  let fallback: RateLimitStore | undefined;

  const verdict = (state: BucketState): RateLimitResult => ({
    allowed: state.count <= options.limit,
    remaining: Math.max(0, options.limit - state.count),
    resetAt: state.resetAt,
  });

  return {
    async check(key: string): Promise<RateLimitResult> {
      const currentTime = now();
      const bucketKey = `${options.name}:${key}`;

      try {
        return verdict(await store.hit(bucketKey, options.windowMs, currentTime));
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "rate_limit.store_failed",
            limiter: options.name,
            failing: options.onStoreError === "allow" ? "open" : "closed",
            error: describeStoreError(error),
          }),
        );

        if (options.onStoreError === "deny") {
          return {
            allowed: false,
            remaining: 0,
            resetAt: currentTime + options.windowMs,
            degraded: true,
          };
        }

        fallback ??= createMemoryStore();
        const state = await fallback.hit(bucketKey, options.windowMs, currentTime);
        return { ...verdict(state), degraded: true };
      }
    },
  };
}

/* -- identifying a caller -------------------------------------------------- */

/**
 * The fallback salt, and a complaint about using it.
 *
 * Rate limiting keeps working without `RATE_LIMIT_SALT`, which is precisely the
 * problem: nothing breaks, so nobody notices that the IP fingerprint is now
 * identical and predictable across every deployment of this code. Warned about
 * once at startup rather than thrown, because refusing to boot the storefront
 * over a salt would be a worse outage than the weakness it prevents.
 */
const FALLBACK_SALT = "catalog-storefront";

if (!process.env.RATE_LIMIT_SALT && process.env.NODE_ENV === "production") {
  console.error(
    "RATE_LIMIT_SALT is not set. Rate-limit fingerprints are using a public " +
      "default and are predictable across deployments. Set it to a long " +
      "random value.",
  );
}

const defaultSalt = (): string => process.env.RATE_LIMIT_SALT || FALLBACK_SALT;

function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}

/**
 * Identify a caller without storing their IP address.
 *
 * The raw address is never persisted or logged: it is salted and hashed, so
 * rate limiting works while the stored value is not personal data we have to
 * account for.
 */
export function clientFingerprint(headers: Headers, salt = defaultSalt()): string {
  const agent = headers.get("user-agent") ?? "";
  return createHash("sha256")
    .update(`${salt}:${clientAddress(headers)}:${agent}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * The same, without the user agent.
 *
 * For sign-in, where the caller is an adversary rather than a shopper. The
 * user agent is a header the client chooses, so a fingerprint that includes it
 * hands a new identity — and a fresh allowance — to anyone who changes one
 * string per request. The forms keep the agent in, because there the opposite
 * error is the expensive one: two customers behind one office address should
 * not share an enquiry allowance.
 */
export function networkFingerprint(headers: Headers, salt = defaultSalt()): string {
  return createHash("sha256")
    .update(`${salt}:net:${clientAddress(headers)}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Deterministic idempotency key.
 *
 * Buckets by a coarse time window so a double-clicked button or a retried
 * request collapses into one row, while a genuine second order minutes later
 * still goes through.
 */
export function idempotencyKey(
  parts: readonly string[],
  windowMs = 5 * 60_000,
  now = Date.now(),
): string {
  const bucket = Math.floor(now / windowMs);
  return createHash("sha256")
    .update([...parts, String(bucket)].join("|"))
    .digest("hex");
}

/* -- shared instances ------------------------------------------------------ */

/**
 * The store every limiter below shares.
 *
 * PostgreSQL when a database is configured, memory when it is not. `@/lib/db`
 * is imported on first use rather than at the top of this file: it opens a
 * pool as a side effect and throws without `DATABASE_URL`, and neither should
 * happen to a unit test that only wants `idempotencyKey`.
 */
export const sharedStore: RateLimitStore = process.env.DATABASE_URL
  ? createPostgresStore(async () => (await import("@/lib/db")).db)
  : createMemoryStore();

/*
 * The three forms fail open. Each one writes something a person is waiting
 * on — an order, a message, a subscription — and losing that because the
 * limiter's own table is unreachable would be the limiter doing more damage
 * than the abuse it exists to stop. They drop to the per-process counter and
 * say so in the log.
 */
export const inquiryLimiter = createRateLimiter({
  name: "inquiry",
  limit: 5,
  windowMs: 10 * 60_000,
  onStoreError: "allow",
  store: sharedStore,
});
export const newsletterLimiter = createRateLimiter({
  name: "newsletter",
  limit: 3,
  windowMs: 60 * 60_000,
  onStoreError: "allow",
  store: sharedStore,
});
export const contactLimiter = createRateLimiter({
  name: "contact",
  limit: 3,
  windowMs: 30 * 60_000,
  onStoreError: "allow",
  store: sharedStore,
});
/*
 * Search suggestions are a read, not a write, and one visitor genuinely makes
 * many of them — the client debounces, but a fast typist still fires several
 * requests per search. The limit is set to stop a script from turning the
 * typeahead into a load generator, and is far above what typing produces.
 *
 * Fails open as well: a typeahead that answers 429 to everybody because a
 * table is missing is a broken search box, and what it serves is public.
 */
export const suggestLimiter = createRateLimiter({
  name: "suggest",
  limit: 60,
  windowMs: 60_000,
  onStoreError: "allow",
  store: sharedStore,
});
