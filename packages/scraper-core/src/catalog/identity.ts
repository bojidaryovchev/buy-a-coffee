import {
  type NormalizedWeight,
  type ProductNameInput,
  allocateProductSlug,
  normalizeLabel,
  parseWeight,
  productName,
  transliterate,
} from "@catalog/shared";

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
 * Two records that share a URL *and* a pack size collapse into one when they
 * are the same product: the duplicated `/eurocaf-piacere-oro/` entry was the
 * same product typed twice into the source CMS. When they are not — the
 * source lists Moreno Espresso Bar and Moreno Super Bar, both 1 kg, at
 * `/moreno-super-bar-1/` — collapsing them dropped one product and let the
 * other take its name and price whenever the source swapped the two. So such
 * records are told apart by their product code, else their name, and the
 * second product gets a key of its own (`splitSourceKey`, `collisions.ts`).
 * Records nothing tells apart still collapse, and the run says so.
 *
 * The product code is deliberately NOT an identity. The source began printing
 * one on its product pages ("Код: 00072") long after every row here had a
 * path-shaped key; switching to `sku:<code>` the moment a code turns up would
 * re-key the whole catalog a second time, and would do it piecemeal, as each
 * page happened to be read. The code is stored on the row and used by move
 * detection as evidence that two keys are one product (see `moves.ts`). It
 * cannot be passed to `resolveProductIdentity` at all: the input type refuses
 * it. The one place a code may shape a key is the tie-break above, between
 * products that already share one, and only when the listing itself states a
 * code for every one of them — which today it never does.
 */

export const SOURCE_KEY_SEPARATOR = "#";

/**
 * Marks the part of a key that tells apart two products the source lists at
 * one address and one pack size:
 *
 *     /moreno-super-bar-1/#1000g~name:kafenazarnamorenosuperbar1kg
 *
 * It sits inside the variant, after the pack size, so everything that reads a
 * key as `path#variant` — move detection's path stem, `catalog:link` — still
 * reads the right path. A key with no pack size gets an empty one first
 * (`/x/#~name:…`) for the same reason. No canonical pack size contains `~`.
 */
export const SOURCE_KEY_SPLIT = "~";

/** What told two products at one key apart. */
export type KeyTiebreaker = "code" | "name";

export interface SplitSourceKey {
  /** The key both products would have had: path and pack size. */
  readonly plainKey: string;
  readonly tiebreaker: KeyTiebreaker;
  /** `code:<code>` or `name:<name>`, as `splitDiscriminator` builds it. */
  readonly discriminator: string;
}

/**
 * A name or a product code reduced to what tells one product from another:
 * transliterated, lower-cased, every space and mark of punctuation removed.
 *
 *     "Кафе на зърна Moreno Super Bar 1кг."   -> kafenazarnamorenosuperbar1kg
 *     "Кафе на зърна Moreno Super Bar 1 кг"   -> kafenazarnamorenosuperbar1kg
 *
 * The one normaliser for split keys. The key is built with it and a stored
 * product is recognised with it (`collisions.ts`), so the two cannot disagree:
 * a name the source re-spaces or re-punctuates is the same name to both, and
 * neither moves the product. Two records it cannot tell apart are, for the
 * sync, one product.
 */
export function identityToken(value: string): string {
  return transliterate(normalizeLabel(value))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** `code:<token>` or `name:<token>`: the part of a split key after `~`. */
export function splitDiscriminator(tiebreaker: KeyTiebreaker, value: string): string {
  return `${tiebreaker}:${identityToken(value)}`;
}

export function splitSourceKey(plainKey: string, discriminator: string): string {
  const withVariant = plainKey.includes(SOURCE_KEY_SEPARATOR)
    ? plainKey
    : `${plainKey}${SOURCE_KEY_SEPARATOR}`;
  return `${withVariant}${SOURCE_KEY_SPLIT}${discriminator}`;
}

/** The parts of a split key, or null for any other key. */
export function parseSplitSourceKey(sourceKey: string): SplitSourceKey | null {
  const variantStart = sourceKey.indexOf(SOURCE_KEY_SEPARATOR);
  if (variantStart === -1) return null;
  const splitAt = sourceKey.indexOf(SOURCE_KEY_SPLIT, variantStart);
  if (splitAt === -1) return null;

  const discriminator = sourceKey.slice(splitAt + SOURCE_KEY_SPLIT.length);
  const tiebreaker = discriminator.slice(0, discriminator.indexOf(":"));
  if (tiebreaker !== "code" && tiebreaker !== "name") return null;

  const head = sourceKey.slice(0, splitAt);
  // `/x/#~name:…` is `/x/` split; `/x/#1000g~name:…` is `/x/#1000g` split.
  const plainKey = head.endsWith(SOURCE_KEY_SEPARATOR) ? head.slice(0, -1) : head;
  return { plainKey, tiebreaker, discriminator };
}

export interface ProductIdentityInput {
  /** Decoded, canonical source path, e.g. `/borbone-crema-classica/`. */
  readonly path: string;
  /** Raw pack-size text as scraped, e.g. `0.500кг.`. */
  readonly weightText?: string | null;
  /** Explicit source identifier, when the source ever exposes one. */
  readonly sourceId?: string | null;
  /**
   * There is no product code here, on purpose — see the note above. `never`
   * makes an attempt to pass one a compile error instead of an ignored field.
   */
  readonly sku?: never;
}

export interface ProductIdentity {
  readonly sourceKey: string;
  /** Which rule produced the key, for auditing and reporting. */
  readonly strategy: "source_id" | "path_and_size" | "path";
  readonly path: string;
  readonly variantKey: string | null;
  readonly weight: NormalizedWeight | null;
}

/**
 * Resolve the strongest available identity, in priority order:
 *
 *   1. an explicit stable source identifier,
 *   2. canonical path + normalised pack size,
 *   3. canonical path alone.
 *
 * Product name is never used, and neither is the product code.
 */
export function resolveProductIdentity(input: ProductIdentityInput): ProductIdentity {
  const path = normalizePathKey(input.path);
  const weight = parseWeight(input.weightText ?? null);
  const variantKey = weight?.canonical ?? null;

  const sourceId = input.sourceId?.trim();
  if (sourceId) {
    return { sourceKey: `id:${sourceId}`, strategy: "source_id", path, variantKey, weight };
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
 * The storefront slug for a product the sync has not stored before.
 *
 * `<brand>-<line>-<format>-<qty>`, from the shop's own name for the product
 * (`productName` in `@catalog/shared`), so the URL leads with what people
 * search for and shares nothing with the supplier's address for the same
 * product.
 *
 * `taken` holds every address already spoken for: each product's slug and
 * every slug a product used to have, each category's, and every route. A
 * newcomer whose slug is taken gets a suffix derived from its own source key
 * (`allocateProductSlug`), never a counter: a counter would make the slug
 * depend on which of two products the sync happened to meet first, and two
 * databases holding the same catalog would then publish different URLs.
 *
 * The slug is registered in `taken` before it is returned, so two newcomers in
 * one run cannot be given the same one.
 */
export function assignProductSlug(product: ProductNameInput, taken: Set<string>): string {
  const slug = allocateProductSlug(
    productName(product).slugBase,
    product.sourceKey ?? product.sourceName,
    (candidate) => taken.has(candidate),
  );
  taken.add(slug);
  return slug;
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
