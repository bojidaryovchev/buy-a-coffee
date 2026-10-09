/**
 * How a brand's name is written on the storefront.
 *
 * The one place a synced brand name becomes a displayed one. Every query that
 * hands a brand to a page goes through `brandDisplayName`, so a product card,
 * a filter, the brand index and the search dropdown cannot disagree about how
 * a brand is spelled.
 *
 * The stored name is still what listings sort by and what search matches. A
 * brand's published slug is curated separately (`brandSlug` in `lib/routes.ts`).
 */

/**
 * Reduce a source key or a name to letters and digits.
 *
 * The same brand reaches us spelled several ways — the key the supplier's
 * catalogue uses, the storefront slug, the name with or without a space — and
 * they differ only in case and separators ("rema-caffe", "REMA CAFFE",
 * "3-bourbons", "3bourbons"). Comparing in this form makes all of them hit the
 * same entry.
 */
export function brandLookupKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/*
 * The lookup itself lives in `@catalog/shared`, beside the product name model
 * that needs the same answer when the sync derives a product's URL. One
 * implementation, so a brand cannot be spelled one way on a page and another
 * way in a slug.
 */
export { brandDisplayName, fallbackBrandName } from "@catalog/shared";
