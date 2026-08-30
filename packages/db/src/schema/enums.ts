import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Page classification. Derived from combined DOM/content signals, never from
 * the URL alone: on the source site products, categories and brands all live
 * at `/<slug>/`.
 */
export const pageTypeEnum = pgEnum("page_type", [
  "home",
  "category",
  "subcategory",
  "product",
  "brand",
  "brand_index",
  "promotion",
  "search",
  "blog_index",
  "blog_article",
  "contact",
  "legal",
  "soft_404",
  "asset",
  "other",
]);

export const crawlRunTypeEnum = pgEnum("crawl_run_type", ["discovery", "catalog"]);

export const runStatusEnum = pgEnum("run_status", [
  "running",
  "succeeded",
  "partial",
  "failed",
  "aborted",
]);

export const availabilityEnum = pgEnum("availability", [
  "in_stock",
  "out_of_stock",
  "preorder",
  "unknown",
]);

/**
 * Reconciliation state. `missing` is a soft state guarded by a counter so a
 * single bad crawl can never delete catalog.
 */
export const productStatusEnum = pgEnum("product_status", ["active", "missing", "removed"]);

export const entityStatusEnum = pgEnum("entity_status", ["active", "missing", "removed"]);

export const changeTypeEnum = pgEnum("change_type", [
  "created",
  "updated",
  "marked_missing",
  "removed",
  "restored",
]);

export const imageStatusEnum = pgEnum("image_status", ["active", "orphaned", "failed"]);

export const snapshotReasonEnum = pgEnum("snapshot_reason", [
  "parser_error",
  "page_type_change",
  "circuit_breaker",
  "new_page_shape",
  "manual",
]);
