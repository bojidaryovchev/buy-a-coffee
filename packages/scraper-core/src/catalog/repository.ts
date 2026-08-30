import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import {
  brands,
  catalogBaselines,
  categories,
  productCategories,
  productImages,
  products,
  scrapeErrors,
  sourceSites,
  syncChanges,
  syncRuns,
} from "@catalog/db/schema";
import { slugify } from "@catalog/shared";
import type { ExistingProduct } from "./diff.ts";
import type { DiscoveredBrand, DiscoveredCategory } from "./discover.ts";

/**
 * All catalog persistence lives here.
 *
 * Keeping SQL out of the sync orchestration keeps the dangerous logic (diff,
 * circuit breaker) pure and testable, and means the storefront can reuse these
 * reads without importing the scraper's control flow.
 */

export interface SourceSiteRecord {
  readonly id: string;
  readonly key: string;
}

export async function ensureSourceSite(
  db: Database,
  input: { key: string; name: string; baseUrl: string; canonicalHost: string },
): Promise<SourceSiteRecord> {
  const [row] = await db
    .insert(sourceSites)
    .values({
      key: input.key,
      name: input.name,
      baseUrl: input.baseUrl,
      canonicalHost: input.canonicalHost,
    })
    .onConflictDoUpdate({
      target: sourceSites.key,
      set: {
        name: input.name,
        baseUrl: input.baseUrl,
        canonicalHost: input.canonicalHost,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: sourceSites.id, key: sourceSites.key });

  if (!row) throw new Error("Failed to upsert source site");
  return row;
}

/** Load stored products in the shape the diff engine needs. */
export async function loadExistingProducts(
  db: Database,
  sourceSiteId: string,
): Promise<ExistingProduct[]> {
  const rows = await db
    .select({
      id: products.id,
      sourceKey: products.sourceKey,
      semanticHash: products.semanticHash,
      status: products.status,
      consecutiveMissingCount: products.consecutiveMissingCount,
      name: products.name,
      currentPrice: products.currentPrice,
      oldPrice: products.oldPrice,
      currency: products.currency,
      availability: products.availability,
      brandId: products.brandId,
      weight: products.weight,
      sku: products.sku,
      gtin: products.gtin,
      attributes: products.attributes,
      descriptionText: products.descriptionText,
      sourceData: products.sourceData,
    })
    .from(products)
    .where(eq(products.sourceSiteId, sourceSiteId));

  return rows.map((row) => ({
    id: row.id,
    sourceKey: row.sourceKey,
    semanticHash: row.semanticHash,
    status: row.status,
    consecutiveMissingCount: row.consecutiveMissingCount,
    // The stored snapshot is rebuilt from the columns so a diff can describe
    // exactly which business field changed.
    snapshot: {
      name: row.name,
      currentPrice: row.currentPrice,
      oldPrice: row.oldPrice,
      currency: row.currency,
      availability: row.availability,
      brandKey: (row.sourceData as Record<string, unknown>)?.brandKey ?? null,
      categoryKeys: ((row.sourceData as Record<string, unknown>)?.categoryKeys as string[]) ?? [],
      weight: (row.sourceData as Record<string, unknown>)?.weightCanonical ?? null,
      sku: row.sku,
      gtin: row.gtin,
      attributes: row.attributes,
      imageUrls: ((row.sourceData as Record<string, unknown>)?.imageUrls as string[]) ?? [],
      descriptionText: row.descriptionText,
      semanticHash: row.semanticHash,
    },
  }));
}

export async function countActiveProducts(db: Database, sourceSiteId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.sourceSiteId, sourceSiteId), eq(products.status, "active")));
  return row?.count ?? 0;
}

export async function countAllProducts(db: Database, sourceSiteId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.sourceSiteId, sourceSiteId));
  return row?.count ?? 0;
}

/** Most recent healthy baseline, used by the circuit breaker. */
export async function loadLatestBaseline(
  db: Database,
  sourceSiteId: string,
): Promise<{ discoveredProductCount: number; activeProductCount: number } | null> {
  const [row] = await db
    .select({
      discoveredProductCount: catalogBaselines.discoveredProductCount,
      activeProductCount: catalogBaselines.activeProductCount,
    })
    .from(catalogBaselines)
    .where(eq(catalogBaselines.sourceSiteId, sourceSiteId))
    .orderBy(desc(catalogBaselines.recordedAt))
    .limit(1);
  return row ?? null;
}

export async function recordBaseline(
  db: Database,
  input: {
    sourceSiteId: string;
    syncRunId: string;
    activeProductCount: number;
    discoveredProductCount: number;
    categoryCount: number;
    brandCount: number;
  },
): Promise<void> {
  await db.insert(catalogBaselines).values(input);
}

/** Upsert brands and return a source-key -> id map. */
export async function upsertBrands(
  db: Database,
  sourceSiteId: string,
  discovered: readonly DiscoveredBrand[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (discovered.length === 0) return map;

  const takenSlugs = new Set<string>();
  for (const brand of discovered) {
    let slug = slugify(brand.name) || brand.sourceKey;
    let attempt = 2;
    while (takenSlugs.has(slug)) slug = `${slugify(brand.name) || brand.sourceKey}-${attempt++}`;
    takenSlugs.add(slug);

    const [row] = await db
      .insert(brands)
      .values({
        sourceSiteId,
        sourceKey: brand.sourceKey,
        sourceId: brand.sourceId,
        sourceUrl: brand.url,
        name: brand.name,
        slug,
        sourceProductCount: brand.productCount,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [brands.sourceSiteId, brands.sourceKey],
        set: {
          name: brand.name,
          sourceId: brand.sourceId,
          sourceUrl: brand.url,
          sourceProductCount: brand.productCount,
          status: "active",
          lastSeenAt: sql`now()`,
        },
      })
      .returning({ id: brands.id, sourceKey: brands.sourceKey });
    if (row) map.set(row.sourceKey, row.id);
  }
  return map;
}

/** Upsert categories, then wire up parents in a second pass. */
export async function upsertCategories(
  db: Database,
  sourceSiteId: string,
  discovered: readonly DiscoveredCategory[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (discovered.length === 0) return map;

  const takenSlugs = new Set<string>();
  for (const category of discovered) {
    let slug = slugify(category.name) || category.sourceKey;
    let attempt = 2;
    while (takenSlugs.has(slug)) slug = `${slugify(category.name) || category.sourceKey}-${attempt++}`;
    takenSlugs.add(slug);

    const [row] = await db
      .insert(categories)
      .values({
        sourceSiteId,
        sourceKey: category.sourceKey,
        sourceId: category.sourceId,
        sourceUrl: category.url,
        name: category.name,
        slug,
        position: category.position,
        sourceProductCount: category.productCount,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [categories.sourceSiteId, categories.sourceKey],
        set: {
          name: category.name,
          sourceId: category.sourceId,
          sourceUrl: category.url,
          position: category.position,
          sourceProductCount: category.productCount,
          status: "active",
          lastSeenAt: sql`now()`,
        },
      })
      .returning({ id: categories.id, sourceKey: categories.sourceKey });
    if (row) map.set(row.sourceKey, row.id);
  }

  // Parents can only be linked once every category has an id.
  for (const category of discovered) {
    if (!category.parentKey) continue;
    const childId = map.get(category.sourceKey);
    const parentId = map.get(category.parentKey);
    if (!childId || !parentId || childId === parentId) continue;
    await db.update(categories).set({ parentId }).where(eq(categories.id, childId));
  }

  return map;
}

export async function loadTakenProductSlugs(
  db: Database,
  sourceSiteId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ slug: products.slug, sourceKey: products.sourceKey })
    .from(products)
    .where(eq(products.sourceSiteId, sourceSiteId));
  return new Map(rows.map((row) => [row.sourceKey, row.slug]));
}

export async function replaceProductCategories(
  db: Database,
  productId: string,
  categoryIds: readonly string[],
  primaryCategoryId: string | null,
): Promise<void> {
  await db.delete(productCategories).where(eq(productCategories.productId, productId));
  if (categoryIds.length === 0) return;
  await db
    .insert(productCategories)
    .values(
      categoryIds.map((categoryId) => ({
        productId,
        categoryId,
        isPrimary: categoryId === primaryCategoryId,
      })),
    )
    .onConflictDoNothing();
}

export async function loadProductImages(
  db: Database,
  productIds: readonly string[],
): Promise<Map<string, Array<{ sourceUrl: string; contentHash: string | null; objectKey: string | null }>>> {
  const map = new Map<
    string,
    Array<{ sourceUrl: string; contentHash: string | null; objectKey: string | null }>
  >();
  if (productIds.length === 0) return map;

  const rows = await db
    .select({
      productId: productImages.productId,
      sourceUrl: productImages.sourceUrl,
      contentHash: productImages.sourceContentHash,
      objectKey: productImages.objectKey,
    })
    .from(productImages)
    .where(inArray(productImages.productId, [...productIds]));

  for (const row of rows) {
    const list = map.get(row.productId) ?? [];
    list.push({ sourceUrl: row.sourceUrl, contentHash: row.contentHash, objectKey: row.objectKey });
    map.set(row.productId, list);
  }
  return map;
}

export async function recordScrapeError(
  db: Database,
  input: {
    sourceSiteId?: string | null;
    crawlRunId?: string | null;
    syncRunId?: string | null;
    url?: string | null;
    stage: string;
    errorClass: string;
    errorMessage: string;
    statusCode?: number | null;
    retryCount?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(scrapeErrors).values({
    sourceSiteId: input.sourceSiteId ?? null,
    crawlRunId: input.crawlRunId ?? null,
    syncRunId: input.syncRunId ?? null,
    url: input.url ?? null,
    stage: input.stage,
    errorClass: input.errorClass,
    // Bound the stored message: a stack trace or an HTML error page would
    // otherwise bloat this table without adding diagnostic value.
    errorMessage: input.errorMessage.slice(0, 4000),
    statusCode: input.statusCode ?? null,
    retryCount: input.retryCount ?? 0,
    metadata: input.metadata ?? {},
  });
}

export async function insertSyncChange(
  db: Database,
  input: {
    syncRunId: string;
    productId: string | null;
    sourceKey: string;
    changeType: "created" | "updated" | "marked_missing" | "removed" | "restored";
    changedFields: string[];
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.insert(syncChanges).values(input);
}

export { brands, categories, productCategories, productImages, products, syncRuns };
