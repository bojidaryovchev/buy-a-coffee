import type { ProductStatus } from "./types";

/**
 * What a product's status means for its page, in one place.
 *
 * The sync marks a product `missing` the first time a run does not find it at
 * the source, and `removed` only after three such runs in a row
 * (`packages/scraper-core/src/catalog/diff.ts`). One failed fetch is therefore
 * enough for `missing`, and most `missing` products come back on the next run.
 *
 * So the two are told apart:
 *
 *  - **Orderable** only while `active`. A `missing` product's price is the last
 *    one the sync saw and may be stale, so it cannot be ordered either: the
 *    order panel gives way to an explanation on both.
 *  - **Indexable and in the sitemap** until `removed`. Taking a page out of
 *    the index for one failed fetch, and putting it back six hours later,
 *    throws away whatever ranking it had for a state that rarely lasts.
 */
export function isOrderable(status: ProductStatus): boolean {
  return status === "active";
}

export function isIndexable(status: ProductStatus): boolean {
  return status !== "removed";
}

/** The statuses whose product pages the sitemap lists: every indexable one. */
export const SITEMAP_PRODUCT_STATUSES = [
  "active",
  "missing",
] as const satisfies readonly ProductStatus[];
