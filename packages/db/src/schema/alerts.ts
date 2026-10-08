import { sql } from "drizzle-orm";
import { date, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

const now = sql`now()`;

/**
 * Which operational alerts have already been sent today.
 *
 * The sync-health cron runs daily, but it can also be invoked by hand or
 * retried by the platform, and a mailbox that receives the same warning three
 * times in an hour trains its reader to ignore the fourth. This table is the
 * memory that makes "at most one email per condition per day" true across
 * invocations and across serverless instances, neither of which share memory.
 *
 * `day` is the UTC calendar date. The primary key is the claim: the first
 * insert for a (condition, day) wins and sends; every later one conflicts and
 * stays quiet.
 *
 * Storefront-owned, like `storefront.ts`; the sync never writes here.
 */
export const syncAlerts = pgTable(
  "sync_alerts",
  {
    /** A condition id from `lib/sync-health.ts`. Text, not an enum: adding a
        condition is a code change and should not need an `ALTER TYPE`. */
    condition: text("condition").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [primaryKey({ columns: [table.condition, table.day] })],
);
