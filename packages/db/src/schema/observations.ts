import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { crawlRuns, sourceSites } from "./source.ts";

const now = sql`now()`;

/**
 * Public storefront capabilities observed during discovery.
 *
 * This is the functional contract handed to the storefront build: it records
 * only what was actually seen, with the evidence URLs that prove it.
 */
export const observedFeatures = pgTable(
  "observed_features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    crawlRunId: uuid("crawl_run_id").references(() => crawlRuns.id, { onDelete: "set null" }),
    featureKey: text("feature_key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    evidenceUrls: jsonb("evidence_urls").$type<string[]>().notNull().default([]),
    pageTypes: jsonb("page_types").$type<string[]>().notNull().default([]),
    inputs: jsonb("inputs").$type<string[]>().notNull().default([]),
    outputs: jsonb("outputs").$type<string[]>().notNull().default([]),
    implementationNotes: jsonb("implementation_notes").$type<string[]>().notNull().default([]),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [uniqueIndex("observed_features_key_idx").on(table.sourceSiteId, table.featureKey)],
);

/** Catalog filters, including how their state is encoded in the URL. */
export const observedFilters = pgTable(
  "observed_filters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    crawlRunId: uuid("crawl_run_id").references(() => crawlRuns.id, { onDelete: "set null" }),
    filterKey: text("filter_key").notNull(),
    name: text("name").notNull(),
    /** URL search parameter, when the filter state is observable in the URL. */
    urlParam: text("url_param"),
    multiValue: boolean("multi_value").notNull().default(false),
    values: jsonb("values")
      .$type<Array<{ value: string; label: string | null; count: number | null }>>()
      .notNull()
      .default([]),
    pageUrls: jsonb("page_urls").$type<string[]>().notNull().default([]),
    appliesToPageTypes: jsonb("applies_to_page_types").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [uniqueIndex("observed_filters_key_idx").on(table.sourceSiteId, table.filterKey)],
);

/**
 * Public forms.
 *
 * `submitted` is always false: discovery inspects form structure and client
 * code, and never sends a request that would create a real order, message or
 * newsletter subscription for the source business.
 */
export const observedForms = pgTable(
  "observed_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    crawlRunId: uuid("crawl_run_id").references(() => crawlRuns.id, { onDelete: "set null" }),
    formKey: text("form_key").notNull(),
    name: text("name").notNull(),
    purpose: text("purpose"),
    pageUrls: jsonb("page_urls").$type<string[]>().notNull().default([]),
    action: text("action"),
    method: text("method"),
    /** True when the form posts to a third party rather than the site itself. */
    externalEndpoint: boolean("external_endpoint").notNull().default(false),
    fields: jsonb("fields")
      .$type<
        Array<{
          name: string | null;
          type: string | null;
          required: boolean;
          label: string | null;
        }>
      >()
      .notNull()
      .default([]),
    /** Always false. Kept explicit so the guarantee is visible in the data. */
    submitted: boolean("submitted").notNull().default(false),
    sideEffectWarning: text("side_effect_warning"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [uniqueIndex("observed_forms_key_idx").on(table.sourceSiteId, table.formKey)],
);

/** Route patterns summarised from the observed URL set. */
export const observedRoutePatterns = pgTable(
  "observed_route_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSiteId: uuid("source_site_id")
      .notNull()
      .references(() => sourceSites.id, { onDelete: "cascade" }),
    crawlRunId: uuid("crawl_run_id").references(() => crawlRuns.id, { onDelete: "set null" }),
    pattern: text("pattern").notNull(),
    pageType: text("page_type").notNull(),
    exampleUrls: jsonb("example_urls").$type<string[]>().notNull().default([]),
    matchCount: jsonb("match_count").$type<number>().notNull().default(0),
    notes: text("notes"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().default(now),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("observed_route_patterns_idx").on(table.sourceSiteId, table.pattern, table.pageType),
    index("observed_route_patterns_type_idx").on(table.pageType),
  ],
);
