import { type Logger, canonicalizeUrl, decodedPath, silentLogger } from "@catalog/shared";
import type { ScraperConfig } from "../config.ts";
import type { Fetcher } from "../fetch/fetcher.ts";
import { type FilterInit, flattenCategories, parseFilterInit } from "../parsers/filterInit.ts";
import { parseListingPage } from "../parsers/listing.ts";
import { normalizeSourceSlug } from "./identity.ts";
import {
  type NormalizedProduct,
  type RawProductRecord,
  normalizeProduct,
  validateNormalizedProduct,
} from "./normalize.ts";

/**
 * Catalog discovery.
 *
 * Deliberately separate from the generic recursive crawler: the recurring sync
 * has no business fetching blog or legal pages. It needs the catalog and
 * nothing else.
 *
 * Two independent sources, in priority order:
 *
 *   1. `FILTER_INIT` on `/search/` — the site's own structured catalog. One
 *      request returns every product with prices, attributes and taxonomy.
 *   2. The category listing pages — server-rendered `.product-item` cards.
 *
 * Keeping the second path alive is not redundancy for its own sake. If the
 * source stops shipping the blob, sync degrades to HTML instead of reporting
 * an empty catalog, and the confidence drop is what tells the circuit breaker
 * that something structural changed.
 */

export type CatalogSourceKind = "filter_init" | "listing_html" | "none";

export interface DiscoveredBrand {
  readonly sourceKey: string;
  readonly rawSlug: string;
  readonly sourceId: string | null;
  readonly name: string;
  readonly url: string | null;
  readonly productCount: number | null;
}

export interface DiscoveredCategory {
  readonly sourceKey: string;
  readonly rawSlug: string;
  readonly sourceId: string | null;
  readonly name: string;
  readonly url: string | null;
  readonly parentKey: string | null;
  readonly position: number;
  readonly productCount: number | null;
}

export interface CatalogDiscoveryResult {
  readonly source: CatalogSourceKind;
  readonly products: NormalizedProduct[];
  readonly brands: DiscoveredBrand[];
  readonly categories: DiscoveredCategory[];
  /** Records seen before de-duplication. */
  readonly rawRecordCount: number;
  /** Source keys that appeared more than once. */
  readonly duplicateKeys: string[];
  /** Paths serving more than one distinct product. */
  readonly collidingPaths: string[];
  readonly invalidRecords: Array<{ path: string; issues: string[] }>;
  /** 0..1. Drives the circuit breaker's parser-confidence check. */
  readonly confidence: number;
  readonly pagesFetched: string[];
  readonly errors: Array<{ url: string; stage: string; message: string }>;
}

export interface CatalogDiscoveryOptions {
  readonly config: ScraperConfig;
  readonly fetcher: Fetcher;
  readonly logger?: Logger;
  /** Cap on products, for `--product-limit` during development. */
  readonly productLimit?: number;
}

const CATALOG_INDEX_PATH = "/search/";

/** Category paths used by the HTML fallback when the blob is unavailable. */
const FALLBACK_LISTING_PATHS = [
  "/kafe-na-zyrna/",
  "/kapsuli/",
  "/kafe-dozi/",
  "/raztvorimo kafe/",
  "/vending-zona/",
];

export async function discoverCatalog(
  options: CatalogDiscoveryOptions,
): Promise<CatalogDiscoveryResult> {
  const { config, fetcher } = options;
  const logger = options.logger ?? silentLogger;
  const errors: CatalogDiscoveryResult["errors"] = [];
  const pagesFetched: string[] = [];

  const absolute = (value: string): string | null =>
    canonicalizeUrl(value, {
      base: config.baseUrl,
      canonicalHost: config.canonicalHost,
      hostAliases: config.hostAliases,
    })?.href ?? null;

  // --- Primary source -------------------------------------------------------
  const indexUrl = absolute(CATALOG_INDEX_PATH);
  let filterInit: FilterInit | null = null;

  if (indexUrl) {
    const response = await fetcher.get(indexUrl);
    pagesFetched.push(indexUrl);
    if (response.outcome === "ok") {
      filterInit = parseFilterInit(response.body);
      if (filterInit && filterInit.invalidRecords.length > 0) {
        logger.warn("catalog.filter_init_invalid_records", {
          count: filterInit.invalidRecords.length,
          sample: filterInit.invalidRecords.slice(0, 5),
        });
      }
    } else {
      errors.push({
        url: indexUrl,
        stage: "catalog_index_fetch",
        message: `outcome=${response.outcome} status=${response.statusCode ?? "-"}`,
      });
      logger.warn("catalog.index_unavailable", { url: indexUrl, outcome: response.outcome });
    }
  }

  if (filterInit && filterInit.products.length > 0) {
    return buildFromFilterInit(filterInit, {
      config,
      logger,
      absolute,
      pagesFetched,
      errors,
      ...(options.productLimit !== undefined ? { productLimit: options.productLimit } : {}),
    });
  }

  // --- Fallback source ------------------------------------------------------
  logger.warn("catalog.falling_back_to_html", {
    reason: filterInit === null ? "no FILTER_INIT blob" : "FILTER_INIT contained no products",
  });

  return buildFromListingHtml({
    config,
    fetcher,
    logger,
    absolute,
    pagesFetched,
    errors,
    ...(options.productLimit !== undefined ? { productLimit: options.productLimit } : {}),
  });
}

interface BuildContext {
  readonly config: ScraperConfig;
  readonly logger: Logger;
  readonly absolute: (value: string) => string | null;
  readonly pagesFetched: string[];
  readonly errors: CatalogDiscoveryResult["errors"];
  readonly productLimit?: number;
}

function buildFromFilterInit(
  filterInit: FilterInit,
  context: BuildContext,
): CatalogDiscoveryResult {
  const { config, absolute } = context;

  const brands: DiscoveredBrand[] = filterInit.brands
    .map((brand) => {
      const key = normalizeSourceSlug(brand.slug);
      if (!key) return null;
      return {
        sourceKey: key,
        rawSlug: brand.slug,
        sourceId: brand.id ?? null,
        name: brand.h1.trim() || key,
        // The raw slug drives the URL: `/ vergnano/` really is the live path.
        url: absolute(`/${brand.slug}/`),
        productCount: brand.count ?? null,
      } satisfies DiscoveredBrand;
    })
    .filter((brand): brand is DiscoveredBrand => brand !== null);

  const categories: DiscoveredCategory[] = flattenCategories(filterInit.categories)
    .map(({ category, parentSlug, position }) => {
      const key = normalizeSourceSlug(category.slug);
      if (!key) return null;
      return {
        sourceKey: key,
        rawSlug: category.slug,
        sourceId: category.id ?? null,
        name: category.h1.trim() || key,
        url: absolute(`/${category.slug}/`),
        parentKey: normalizeSourceSlug(parentSlug),
        position,
        productCount: category.count ?? null,
      } satisfies DiscoveredCategory;
    })
    .filter((category): category is DiscoveredCategory => category !== null);

  const rawRecords: RawProductRecord[] = [];
  for (const product of filterInit.products) {
    const url = absolute(product.url);
    if (!url) continue;
    const canonical = canonicalizeUrl(product.url, {
      base: config.baseUrl,
      canonicalHost: config.canonicalHost,
      hostAliases: config.hostAliases,
    });
    if (!canonical) continue;

    rawRecords.push({
      path: decodedPath(canonical),
      url,
      name: product.h1,
      priceText: product.price,
      oldPriceText: product.old_price,
      availabilityText: product.availability,
      weightText: product.weight,
      brandKey: product.brandSlug,
      categoryKeys: product.categorySlug ? [product.categorySlug] : [],
      descriptionText: product.description,
      imageUrls: product.imageUrl ? [product.imageUrl] : [],
      attributes: {
        intensity: product.intensity,
        strength: product.brewStrength,
        decaf: product.decaf,
        aromas: product.aromas,
      },
      sourceData: { ...product, discoveredVia: "filter_init" },
    });
  }

  /*
   * A product may reference a brand the blob does not list. Dropping the
   * association would silently orphan those products on the storefront, so the
   * brand is derived from the reference instead.
   */
  const declaredBrandKeys = new Set(brands.map((brand) => brand.sourceKey));
  const derivedBrands: DiscoveredBrand[] = [];
  for (const record of rawRecords) {
    const key = normalizeSourceSlug(record.brandKey ?? null);
    if (!key || declaredBrandKeys.has(key)) continue;
    declaredBrandKeys.add(key);
    derivedBrands.push({
      sourceKey: key,
      rawSlug: record.brandKey ?? key,
      sourceId: null,
      name: key,
      url: absolute(`/${record.brandKey ?? key}/`),
      productCount: null,
    });
  }
  if (derivedBrands.length > 0) {
    context.logger.info("catalog.derived_brands_from_products", {
      count: derivedBrands.length,
      keys: derivedBrands.map((brand) => brand.sourceKey),
    });
  }

  return finalise(rawRecords, [...brands, ...derivedBrands], categories, {
    ...context,
    source: "filter_init",
    // The structured blob is the site's own data; nothing is inferred.
    baseConfidence: 1,
  });
}

async function buildFromListingHtml(
  context: BuildContext & { readonly fetcher: Fetcher },
): Promise<CatalogDiscoveryResult> {
  const { config, fetcher, absolute, pagesFetched, errors, logger } = context;
  const rawRecords: RawProductRecord[] = [];
  const categories: DiscoveredCategory[] = [];
  const brandKeys = new Map<string, DiscoveredBrand>();
  let pagesParsed = 0;
  let pagesWithCards = 0;

  for (const [position, listingPath] of FALLBACK_LISTING_PATHS.entries()) {
    const url = absolute(listingPath);
    if (!url) continue;

    const response = await fetcher.get(url);
    pagesFetched.push(url);
    if (response.outcome !== "ok") {
      errors.push({
        url,
        stage: "catalog_listing_fetch",
        message: `outcome=${response.outcome} status=${response.statusCode ?? "-"}`,
      });
      continue;
    }
    pagesParsed += 1;

    const listing = parseListingPage(response.body);
    if (listing.cards.length > 0) pagesWithCards += 1;

    const categoryKey = normalizeSourceSlug(listingPath.replace(/^\/|\/$/g, ""));
    if (categoryKey) {
      categories.push({
        sourceKey: categoryKey,
        rawSlug: listingPath.replace(/^\/|\/$/g, ""),
        sourceId: null,
        name: categoryKey,
        url,
        parentKey: null,
        position,
        productCount: listing.cards.length,
      });
    }

    for (const card of listing.cards) {
      if (!card.href || !card.name) continue;
      const canonical = canonicalizeUrl(card.href, {
        base: config.baseUrl,
        canonicalHost: config.canonicalHost,
        hostAliases: config.hostAliases,
      });
      if (!canonical) continue;

      const brandKey = normalizeSourceSlug(card.dataAttributes.brand ?? null);
      if (brandKey && !brandKeys.has(brandKey)) {
        brandKeys.set(brandKey, {
          sourceKey: brandKey,
          rawSlug: card.dataAttributes.brand ?? brandKey,
          sourceId: null,
          name: brandKey,
          url: absolute(`/${card.dataAttributes.brand ?? brandKey}/`),
          productCount: null,
        });
      }

      rawRecords.push({
        path: decodedPath(canonical),
        url: canonical.href,
        name: card.name,
        priceText: card.priceText,
        oldPriceText: card.oldPriceText,
        // Listing cards do not state availability; `unknown` is honest.
        availabilityText: null,
        weightText: extractWeightFromName(card.name),
        brandKey,
        categoryKeys: categoryKey ? [categoryKey] : [],
        descriptionText: card.description,
        imageUrls: card.imageUrl ? [card.imageUrl] : [],
        attributes: {
          strength: card.dataAttributes.strength ?? "",
          decaf: card.dataAttributes.decaf ?? "",
          aromas: card.dataAttributes.aromas ?? "",
        },
        sourceData: { ...card, discoveredVia: "listing_html" },
      });
    }
  }

  logger.info("catalog.html_fallback_complete", { pagesParsed, pagesWithCards, records: rawRecords.length });

  return finalise(rawRecords, [...brandKeys.values()], categories, {
    ...context,
    source: rawRecords.length > 0 ? "listing_html" : "none",
    /*
     * The HTML path recovers less than the structured blob: availability is
     * absent and pack size is inferred from the product name. Capping
     * confidence at 0.7 is what makes a silent switch to this path visible to
     * the circuit breaker instead of looking like a healthy run.
     */
    baseConfidence: pagesParsed === 0 ? 0 : 0.7 * (pagesParsed / FALLBACK_LISTING_PATHS.length),
  });
}

/**
 * Recover the pack size from a product name such as
 * "Кафе на зърна Lavazza Super Crema 1кг." — the HTML fallback has no
 * dedicated weight field, and pack size is part of product identity.
 */
export function extractWeightFromName(name: string): string | null {
  const match = name.match(/(\d+(?:[.,]\d+)?)\s*(кг\.?|г\.?|гр\.?|бр\.?|kg|g|ml|мл|л\.?)(?=\s|$|\.)/iu);
  return match ? `${match[1]} ${match[2]}` : null;
}

function finalise(
  rawRecords: readonly RawProductRecord[],
  brands: readonly DiscoveredBrand[],
  categories: readonly DiscoveredCategory[],
  context: BuildContext & { source: CatalogSourceKind; baseConfidence: number },
): CatalogDiscoveryResult {
  const { config, logger } = context;

  const byKey = new Map<string, NormalizedProduct>();
  const duplicateKeys: string[] = [];
  const invalidRecords: CatalogDiscoveryResult["invalidRecords"] = [];
  const pathCounts = new Map<string, Set<string>>();

  for (const raw of rawRecords) {
    const product = normalizeProduct(raw, {
      sourceSite: config.sourceKey,
      defaultCurrency: "EUR",
      resolveUrl: (value) =>
        canonicalizeUrl(value, {
          base: config.baseUrl,
          canonicalHost: config.canonicalHost,
          hostAliases: config.hostAliases,
        })?.href ?? null,
    });

    const validation = validateNormalizedProduct(product);
    if (!validation.ok) {
      invalidRecords.push({ path: raw.path, issues: validation.issues });
      logger.warn("catalog.invalid_product", { path: raw.path, issues: validation.issues });
      continue;
    }

    let keysForPath = pathCounts.get(product.sourcePath);
    if (!keysForPath) {
      keysForPath = new Set<string>();
      pathCounts.set(product.sourcePath, keysForPath);
    }
    keysForPath.add(product.sourceKey);

    const existing = byKey.get(product.sourceKey);
    if (existing) {
      duplicateKeys.push(product.sourceKey);
      // Identical records collapse silently; differing ones are worth a line
      // in the log because they mean the source has genuinely ambiguous data.
      if (existing.semanticHash !== product.semanticHash) {
        logger.warn("catalog.duplicate_key_conflict", {
          sourceKey: product.sourceKey,
          keptName: existing.name,
          discardedName: product.name,
        });
      }
      continue;
    }
    byKey.set(product.sourceKey, product);
  }

  const collidingPaths = [...pathCounts.entries()]
    .filter(([, keys]) => keys.size > 1)
    .map(([path]) => path);

  const withCollisionFlag = new Set(collidingPaths);
  let products: NormalizedProduct[] = [...byKey.values()].map((product) =>
    withCollisionFlag.has(product.sourcePath) ? { ...product, hasUrlCollision: true } : product,
  );

  if (context.productLimit !== undefined && context.productLimit > 0) {
    products = products.slice(0, context.productLimit);
  }

  const validRatio = rawRecords.length === 0 ? 0 : 1 - invalidRecords.length / rawRecords.length;
  const confidence = Math.max(0, Math.min(1, context.baseConfidence * validRatio));

  logger.info("catalog.discovery_complete", {
    source: context.source,
    rawRecords: rawRecords.length,
    products: products.length,
    duplicates: duplicateKeys.length,
    collidingPaths: collidingPaths.length,
    invalid: invalidRecords.length,
    confidence,
  });

  return {
    source: context.source,
    products,
    brands: [...brands],
    categories: [...categories],
    rawRecordCount: rawRecords.length,
    duplicateKeys,
    collidingPaths,
    invalidRecords,
    confidence,
    pagesFetched: context.pagesFetched,
    errors: context.errors,
  };
}
