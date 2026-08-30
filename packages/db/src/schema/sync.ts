import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { changeTypeEnum, runStatusEnum } from "./enums.ts";
import { products } from "./catalog.ts";
import { sourceSites } from "./source.ts";

const now = sql`now()`;

/**
 * One row per catalog synchronisation attempt.
 *
 * The before/after counts and the circuit-breaker columns are what make a
 * suspicious run auditable after the fact rather than a mystery.
 */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    crawlRunId: uuid("crawl_run_id"),
    status: runStatusEnum("status").notNull().default("running"),
    dryRun: boolean("dry_run").notNull().default(false),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(now),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),

    /** Products the source exposed in this run, after de-duplication. */
    discoveredCount: integer("discovered_count").notNull().default(0),
    /** Raw record count before de-duplication, so collisions stay visible. */
    discoveredRawCount: integer("discovered_raw_count").notNull().default(0),

    productsBefore: integer("products_before").notNull().default(0),
    productsAfter: integer("products_after").notNull().default(0),

    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    unchangedCount: integer("unchanged_count").notNull().default(0),
    missingCount: integer("missing_count").notNull().default(0),
    removedCount: integer("removed_count").notNull().default(0),
    restoredCount: integer("restored_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),

    imagesMirrored: integer("images_mirrored").notNull().default(0),
    imagesSkipped: integer("images_skipped").notNull().default(0),
    imagesFailed: integer("images_failed").notNull().default(0),

    /** True when mass-removal protection refused to apply the diff. */
    circuitBreakerTripped: boolean("circuit_breaker_tripped").notNull().default(false),
    circuitBreakerReason: text("circuit_breaker_reason"),
    circuitBreakerDetail: jsonb("circuit_breaker_detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    /** Which parser produced the catalog: the structured blob or HTML fallback. */
    catalogSource: text("catalog_source"),
    parserConfidence: text("parser_confidence"),

    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    errorSummary: text("error_summary"),
  },
  (table) => [
    index("sync_runs_site_started_idx").on(table.sourceSiteId, table.startedAt),
    index("sync_runs_status_idx").on(table.status),
    index("sync_runs_breaker_idx").on(table.circuitBreakerTripped),
  ],
);

/** Append-only audit trail of every catalog mutation. */
export const syncChanges = pgTable(
  "sync_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    /** Retained even if the product row is later deleted. */
    sourceKey: text("source_key").notNull(),
    changeType: changeTypeEnum("change_type").notNull(),
    changedFields: jsonb("changed_fields").$type<string[]>().notNull().default([]),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    index("sync_changes_run_idx").on(table.syncRunId),
    index("sync_changes_product_idx").on(table.productId),
    index("sync_changes_source_key_idx").on(table.sourceKey),
    index("sync_changes_type_idx").on(table.changeType),
    index("sync_changes_created_idx").on(table.createdAt),
  ],
);

/**
 * The healthy baseline the circuit breaker compares against.
 *
 * Kept as its own table rather than derived on the fly so that a string of bad
 * runs cannot slowly ratchet the baseline down until mass removal looks normal.
 */
export const catalogBaselines = pgTable(
  "catalog_baselines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id").references(() => syncRuns.id, { onDelete: "set null" }),
    activeProductCount: integer("active_product_count").notNull(),
    discoveredProductCount: integer("discovered_product_count").notNull(),
    categoryCount: integer("category_count").notNull().default(0),
    brandCount: integer("brand_count").notNull().default(0),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [index("catalog_baselines_site_recorded_idx").on(table.sourceSiteId, table.recordedAt)],
);

export const syncRunsRelations = relations(syncRuns, ({ one, many }) => ({
  sourceSite: one(sourceSites, {
    fields: [syncRuns.sourceSiteId],
    references: [sourceSites.id],
  }),
  changes: many(syncChanges),
}));

export const syncChangesRelations = relations(syncChanges, ({ one }) => ({
  syncRun: one(syncRuns, { fields: [syncChanges.syncRunId], references: [syncRuns.id] }),
  product: one(products, { fields: [syncChanges.productId], references: [products.id] }),
}));
