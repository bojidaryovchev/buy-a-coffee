import { brandDisplayNames } from "../../../content/brand-names";

/**
 * How a brand's name is written on the storefront.
 *
 * The one place a synced brand name becomes a displayed one. Every query that
 * hands a brand to a page goes through `brandDisplayName`, so a product card,
 * a filter, the brand index and the search dropdown cannot disagree about how
 * a brand is spelled.
 *
 * Display only: the stored name is still what listings sort by and what search
 * matches, and the URL slug is not derived from anything here.
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

const DISPLAY_NAMES = new Map(
  Object.entries(brandDisplayNames).map(([key, name]) => [brandLookupKey(key), name]),
);

/** Trim, and collapse the runs of whitespace the source leaves inside names. */
function tidy(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * The name for a brand nobody has written an entry for.
 *
 * A name typed in one case throughout ("NEW BRAND", "newbrand") carries no
 * information in its casing, so it is title-cased, word by word and across
 * hyphens. A name in mixed case ("FoodNess") is kept as typed: someone chose
 * those capitals, and re-casing it would be our guess replacing theirs.
 */
export function fallbackBrandName(sourceName: string): string {
  const name = tidy(sourceName);
  const singleCase = name === name.toUpperCase() || name === name.toLowerCase();
  if (!singleCase) return name;
  return name.replace(/[\p{L}\p{N}]+/gu, capitalise);
}

/**
 * The display name for a synced brand.
 *
 * Looked up by source key first, because that is the identity the sync holds
 * stable; then by the name itself, which catches a brand whose key differs
 * from ours by a typo upstream. Anything unknown falls through to
 * `fallbackBrandName` — this never throws and never returns the raw value.
 */
export function brandDisplayName(brand: {
  readonly name: string;
  readonly sourceKey?: string | null;
}): string {
  const byKey = brand.sourceKey ? DISPLAY_NAMES.get(brandLookupKey(brand.sourceKey)) : undefined;
  return byKey ?? DISPLAY_NAMES.get(brandLookupKey(brand.name)) ?? fallbackBrandName(brand.name);
}
