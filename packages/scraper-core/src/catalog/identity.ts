import { type NormalizedWeight, parseWeight, slugify } from "@catalog/shared";

/**
 * Product identity.
 *
 * The obvious key — the product URL — is provably not unique on this source.
 * `/borbone-crema-classica/` is served for two genuinely different products:
 *
 *     Borbone Crema Classica 0.500кг.  EUR 10.70
 *     Borbone Crema Classica 1кг.      EUR 20.50
 *
 * Keying on URL would silently discard one of them on every sync. Keying on
 * name is worse (the prompt's own warning, and names change for marketing
 * reasons). Keying on the image id would be unique today, but re-uploading a
 * photo would resurrect the product as a brand-new row and lose its history.
 *
 * So identity is: canonical source path + normalised pack size.
 *
 *     /borbone-crema-classica/#1000g
 *     /borbone-crema-classica/#500g
 *
 * Pack size is part of the SKU for coffee, and normalising it means `1 кг.`
 * and `1000 г` cannot fork one product into two.
 *
 * The one accepted trade-off: two records that share a URL *and* a pack size
 * collapse into one. That is the correct outcome for the observed case — the
 * duplicated `/eurocaf-piacere-oro/` entry is the same product typed twice
 * into the source CMS.
 */

export const SOURCE_KEY_SEPARATOR = "#";

export interface ProductIdentityInput {
  /** Decoded, canonical source path, e.g. `/borbone-crema-classica/`. */
  readonly path: string;
  /** Raw pack-size text as scraped, e.g. `0.500кг.`. */
  readonly weightText?: string | null;
  /** Explicit source identifier, when the source ever exposes one. */
  readonly sourceId?: string | null;
  /** SKU, when present. */
  readonly sku?: string | null;
}

export interface ProductIdentity {
  readonly sourceKey: string;
  /** Which rule produced the key, for auditing and reporting. */
  readonly strategy: "source_id" | "sku" | "path_and_size" | "path";
  readonly path: string;
  readonly variantKey: string | null;
  readonly weight: NormalizedWeight | null;
}

/**
 * Resolve the strongest available identity, in priority order:
 *
 *   1. an explicit stable source identifier,
 *   2. a SKU,
 *   3. canonical path + normalised pack size,
 *   4. canonical path alone.
 *
 * Product name is never used.
 */
export function resolveProductIdentity(input: ProductIdentityInput): ProductIdentity {
  const path = normalizePathKey(input.path);
  const weight = parseWeight(input.weightText ?? null);
  const variantKey = weight?.canonical ?? null;

  const sourceId = input.sourceId?.trim();
  if (sourceId) {
    return { sourceKey: `id:${sourceId}`, strategy: "source_id", path, variantKey, weight };
  }

  const sku = input.sku?.trim();
  if (sku) {
    return { sourceKey: `sku:${sku}`, strategy: "sku", path, variantKey, weight };
  }

  if (variantKey) {
    return {
      sourceKey: `${path}${SOURCE_KEY_SEPARATOR}${variantKey}`,
      strategy: "path_and_size",
      path,
      variantKey,
      weight,
    };
  }

  return { sourceKey: path, strategy: "path", path, variantKey: null, weight };
}

/** Lower-cases nothing: this site's paths are case-sensitive. */
function normalizePathKey(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

/**
 * Build a storefront slug that is unique across the catalog.
 *
 * Two products can legitimately produce the same base slug (the Borbone pair
 * differs only by pack size), so the pack size is appended when needed and a
 * numeric suffix is the final tie-breaker. Deterministic for a given input
 * order, which keeps slugs stable between syncs.
 */
export function assignUniqueSlug(
  name: string,
  taken: Set<string>,
  options: { readonly variantKey?: string | null; readonly fallback?: string } = {},
): string {
  const base = slugify(name) || slugify(options.fallback ?? "") || "product";
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }

  if (options.variantKey) {
    const withVariant = `${base}-${slugify(options.variantKey)}`;
    if (!taken.has(withVariant)) {
      taken.add(withVariant);
      return withVariant;
    }
  }

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Unable to allocate a unique slug for ${JSON.stringify(name)}`);
}

/**
 * Normalise a source slug for use as a join key.
 *
 * The source publishes at least one brand slug with a leading space
 * (`" vergnano"`, which is why `/ vergnano/` appears in its own markup).
 * Keys are trimmed and lower-cased so joins are reliable; the untouched slug
 * still drives URL construction, so the wart is preserved where it matters.
 */
export function normalizeSourceSlug(slug: string | null | undefined): string | null {
  if (slug === null || slug === undefined) return null;
  const normalized = slug.trim().toLowerCase();
  return normalized === "" ? null : normalized;
}
