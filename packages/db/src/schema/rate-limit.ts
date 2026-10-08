import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Rate-limit counters.
 *
 * Storefront-owned, like `storefront.ts` and `mail.ts`: the sync never writes
 * here. It exists because the storefront runs on serverless functions, where
 * an in-memory counter is one counter *per instance* and the effective limit
 * is the configured one multiplied by however many instances are warm.
 *
 * One row per bucket, and a bucket is a fixed window: `count` requests have
 * been seen since the window opened, and the window closes at `resetAt`. The
 * row is written by a single `INSERT ... ON CONFLICT DO UPDATE`, which is what
 * makes the check-and-increment atomic — see `apps/web/src/lib/rate-limit.ts`.
 *
 * `key` is a limiter name plus a salted hash of the caller. No address, no
 * user agent and nothing else that identifies a person is stored here.
 *
 * Rows are disposable. Truncating the table forgives everybody and breaks
 * nothing, which is also why nothing references it.
 */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // The opportunistic sweep deletes the oldest expired rows first.
    index("rate_limit_buckets_reset_at_idx").on(table.resetAt),
  ],
);

export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
