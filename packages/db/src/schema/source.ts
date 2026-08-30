import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { crawlRunTypeEnum, pageTypeEnum, runStatusEnum, snapshotReasonEnum } from "./enums.ts";

const now = sql`now()`;

/** The reference site(s) we mirror. One row today, but never hard-coded. */
export const sourceSites = pgTable(
  "source_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    canonicalHost: text("canonical_host").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [uniqueIndex("source_sites_key_idx").on(table.key)],
);

/** One row per full discovery or catalog-discovery crawl. */
export const crawlRuns = pgTable(
  "crawl_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    type: crawlRunTypeEnum("type").notNull(),
    status: runStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(now),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    pagesAttempted: integer("pages_attempted").notNull().default(0),
    pagesSucceeded: integer("pages_succeeded").notNull().default(0),
    pagesFailed: integer("pages_failed").notNull().default(0),
    pagesSoft404: integer("pages_soft_404").notNull().default(0),
    /** Crawler version plus effective configuration, for reproducibility. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    errorSummary: text("error_summary"),
  },
  (table) => [
    index("crawl_runs_site_started_idx").on(table.sourceSiteId, table.startedAt),
    index("crawl_runs_status_idx").on(table.status),
  ],
);

/** Latest known representation of every public page we have seen. */
export const discoveredPages = pgTable(
  "discovered_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    /** Canonical absolute URL. The identity of a page. */
    canonicalUrl: text("canonical_url").notNull(),
    /** URL as first discovered, before canonicalisation. */
    discoveredUrl: text("discovered_url").notNull(),
    /** URL after redirects were followed. */
    finalUrl: text("final_url").notNull(),
    /** Decoded path, so `/raztvorimo%20kafe/` reads naturally in reports. */
    path: text("path").notNull(),

    statusCode: smallint("status_code"),
    contentType: text("content_type"),
    /**
     * The source returns HTTP 200 plus the homepage shell for unknown routes.
     * Treating those as real pages would poison the catalog, so this is a
     * first-class column rather than a heuristic applied at read time.
     */
    isSoft404: boolean("is_soft_404").notNull().default(false),
    redirectedFrom: text("redirected_from"),

    title: text("title"),
    metaDescription: text("meta_description"),
    canonicalTag: text("canonical_tag"),
    robotsMeta: text("robots_meta"),

    pageType: pageTypeEnum("page_type").notNull().default("other"),
    pageTypeConfidence: text("page_type_confidence"),
    pageTypeEvidence: jsonb("page_type_evidence").$type<string[]>().notNull().default([]),

    headings: jsonb("headings")
      .$type<Array<{ level: number; text: string }>>()
      .notNull()
      .default([]),
    forms: jsonb("forms").$type<unknown[]>().notNull().default([]),
    structuredData: jsonb("structured_data").$type<unknown[]>().notNull().default([]),
    externalLinks: jsonb("external_links").$type<string[]>().notNull().default([]),
    /** Parser-visible extras (product counts, filter keys, data attributes). */
    signals: jsonb("signals").$type<Record<string, unknown>>().notNull().default({}),

    /** Hash of normalised HTML; stable across Cloudflare rotating tokens. */
    contentHash: text("content_hash").notNull(),
    byteSize: integer("byte_size"),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).notNull().default(now),
    latestCrawlRunId: uuid("latest_crawl_run_id").references(() => crawlRuns.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("discovered_pages_canonical_url_idx").on(table.sourceSiteId, table.canonicalUrl),
    index("discovered_pages_page_type_idx").on(table.pageType),
    index("discovered_pages_last_seen_idx").on(table.lastSeenAt),
    index("discovered_pages_soft404_idx").on(table.isSoft404),
  ],
);

/** Edges of the site graph: which page links to which. */
export const pageLinks = pgTable(
  "page_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crawlRunId: uuid("crawl_run_id")
      .notNull()
      .references(() => crawlRuns.id, { onDelete: "cascade" }),
    fromPageId: uuid("from_page_id")
      .notNull()
      .references(() => discoveredPages.id, { onDelete: "cascade" }),
    toCanonicalUrl: text("to_canonical_url").notNull(),
    toPageId: uuid("to_page_id").references(() => discoveredPages.id, { onDelete: "set null" }),
    anchorText: text("anchor_text"),
    rel: text("rel"),
    ordinal: integer("ordinal").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    index("page_links_run_idx").on(table.crawlRunId),
    index("page_links_from_idx").on(table.fromPageId),
    index("page_links_to_url_idx").on(table.toCanonicalUrl),
    uniqueIndex("page_links_unique_edge_idx").on(
      table.crawlRunId,
      table.fromPageId,
      table.toCanonicalUrl,
    ),
  ],
);

/** Structured failure records; the first place to look when a sync degrades. */
export const scrapeErrors = pgTable(
  "scrape_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id").references(() => sourceSites.id, { onDelete: "cascade" }),
    crawlRunId: uuid("crawl_run_id").references(() => crawlRuns.id, { onDelete: "cascade" }),
    syncRunId: uuid("sync_run_id"),
    url: text("url"),
    stage: text("stage").notNull(),
    errorClass: text("error_class").notNull(),
    errorMessage: text("error_message").notNull(),
    statusCode: smallint("status_code"),
    retryCount: integer("retry_count").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    index("scrape_errors_crawl_run_idx").on(table.crawlRunId),
    index("scrape_errors_sync_run_idx").on(table.syncRunId),
    index("scrape_errors_created_idx").on(table.createdAt),
    index("scrape_errors_stage_idx").on(table.stage),
  ],
);

/** Compressed HTML kept only for diagnosable events, never for every run. */
export const pageSnapshots = pgTable(
  "page_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    crawlRunId: uuid("crawl_run_id").references(() => crawlRuns.id, { onDelete: "set null" }),
    syncRunId: uuid("sync_run_id"),
    canonicalUrl: text("canonical_url").notNull(),
    contentHash: text("content_hash").notNull(),
    reason: snapshotReasonEnum("reason").notNull(),
    objectKey: text("object_key").notNull(),
    byteSize: integer("byte_size"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("page_snapshots_hash_reason_idx").on(table.contentHash, table.reason),
    index("page_snapshots_url_idx").on(table.canonicalUrl),
    index("page_snapshots_created_idx").on(table.createdAt),
  ],
);

export const sourceSitesRelations = relations(sourceSites, ({ many }) => ({
  crawlRuns: many(crawlRuns),
  discoveredPages: many(discoveredPages),
}));

export const crawlRunsRelations = relations(crawlRuns, ({ one, many }) => ({
  sourceSite: one(sourceSites, {
    fields: [crawlRuns.sourceSiteId],
    references: [sourceSites.id],
  }),
  links: many(pageLinks),
}));

export const discoveredPagesRelations = relations(discoveredPages, ({ one, many }) => ({
  sourceSite: one(sourceSites, {
    fields: [discoveredPages.sourceSiteId],
    references: [sourceSites.id],
  }),
  outboundLinks: many(pageLinks),
}));
