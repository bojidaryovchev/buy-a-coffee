import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { AnyPgColumn, PgUpdateSetSource } from "drizzle-orm/pg-core";
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
import type { ExistingProduct } from "./diff.ts";
import type { DiscoveredBrand, DiscoveredCategory } from "./discover.ts";
import { type TaxonomyChanges, planEntities, summarisePlan } from "./taxonomy.ts";

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
      sourcePath: products.sourcePath,
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
    sourcePath: row.sourcePath,
    semanticHash: row.semanticHash,
    status: row.status,
    consecutiveMissingCount: row.consecutiveMissingCount,
    // Enrichment's column. Beside the snapshot, not in it: see `ExistingProduct`.
    sku: row.sku,
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

export interface TaxonomyOptions {
  /**
   * Hide live rows the listing does not account for. Only ever true for a run
   * the circuit breaker trusted, read from the source's structured catalog.
   */
  readonly markAbsent?: boolean;
  /** Work out what would change and write nothing. */
  readonly dryRun?: boolean;
}

export interface TaxonomyResult {
  /** Source key -> row id, for every record in the listing that has a row. */
  readonly ids: Map<string, string>;
  readonly changes: TaxonomyChanges;
}

/** Append `key` to a `previous_source_keys` column unless it is already there. */
function appendKey(column: AnyPgColumn, key: string) {
  return sql`case
    when ${key}::text = any(${column}) then ${column}
    else array_append(${column}, ${key}::text)
  end`;
}

/**
 * Reconcile brands against the listing and return a source-key -> id map.
 *
 * A brand is matched on the source's numeric id first and on its slug second
 * (see `taxonomy.ts`), so a brand the source re-slugs is updated in place: its
 * row id and its storefront `slug` — an indexed URL — never change, and the
 * key it left is kept in `previous_source_keys`.
 */
export async function upsertBrands(
  db: Database,
  sourceSiteId: string,
  discovered: readonly DiscoveredBrand[],
  options: TaxonomyOptions = {},
): Promise<TaxonomyResult> {
  const existing = await db
    .select({
      id: brands.id,
      sourceKey: brands.sourceKey,
      sourceId: brands.sourceId,
      slug: brands.slug,
      status: brands.status,
    })
    .from(brands)
    .where(eq(brands.sourceSiteId, sourceSiteId))
    .orderBy(brands.firstSeenAt, brands.id);

  const plan = planEntities(existing, discovered);
  const markAbsent = (options.markAbsent ?? false) && discovered.length > 0;
  const changes = summarisePlan(plan, { markAbsent });
  const ids = new Map<string, string>();

  if (options.dryRun) {
    for (const { incoming, existing: row } of plan.assignments) {
      if (row) ids.set(incoming.sourceKey, row.id);
    }
    return { ids, changes };
  }

  for (const { incoming: brand, existing: row, renamedFrom, slug } of plan.assignments) {
    if (row) {
      await db
        .update(brands)
        .set({
          sourceKey: brand.sourceKey,
          name: brand.name,
          // The HTML fallback knows no ids; it must not erase the ones we hold.
          ...(brand.sourceId !== null ? { sourceId: brand.sourceId } : {}),
          sourceUrl: brand.url,
          sourceProductCount: brand.productCount,
          status: "active",
          lastSeenAt: sql`now()`,
          // `slug` is not in this statement: it is allocated once and frozen.
          ...(renamedFrom !== null
            ? {
                previousSourceKeys: appendKey(brands.previousSourceKeys, renamedFrom),
                lastChangedAt: sql`now()`,
              }
            : {}),
        })
        .where(eq(brands.id, row.id));
      ids.set(brand.sourceKey, row.id);
      continue;
    }

    const [inserted] = await db
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
      .returning({ id: brands.id });
    if (inserted) ids.set(brand.sourceKey, inserted.id);
  }

  if (markAbsent && plan.absent.length > 0) {
    await db
      .update(brands)
      .set({ status: "missing" })
      .where(
        inArray(
          brands.id,
          plan.absent.map((row) => row.id),
        ),
      );
  }

  return { ids, changes };
}

/**
 * Reconcile categories, then wire up parents in a second pass.
 *
 * Matching and slug rules are the same as for brands. Parents are resolved
 * through the row ids, so a parent the source renames keeps its children: the
 * children's `parent_id` already points at the row, and the row stays.
 */
export async function upsertCategories(
  db: Database,
  sourceSiteId: string,
  discovered: readonly DiscoveredCategory[],
  options: TaxonomyOptions = {},
): Promise<TaxonomyResult> {
  const existing = await db
    .select({
      id: categories.id,
      sourceKey: categories.sourceKey,
      sourceId: categories.sourceId,
      slug: categories.slug,
      status: categories.status,
    })
    .from(categories)
    .where(eq(categories.sourceSiteId, sourceSiteId))
    .orderBy(categories.firstSeenAt, categories.id);

  const plan = planEntities(existing, discovered);
  const markAbsent = (options.markAbsent ?? false) && discovered.length > 0;
  const changes = summarisePlan(plan, { markAbsent });
  const ids = new Map<string, string>();

  if (options.dryRun) {
    for (const { incoming, existing: row } of plan.assignments) {
      if (row) ids.set(incoming.sourceKey, row.id);
    }
    return { ids, changes };
  }

  for (const { incoming: category, existing: row, renamedFrom, slug } of plan.assignments) {
    if (row) {
      await db
        .update(categories)
        .set({
          sourceKey: category.sourceKey,
          name: category.name,
          ...(category.sourceId !== null ? { sourceId: category.sourceId } : {}),
          sourceUrl: category.url,
          position: category.position,
          sourceProductCount: category.productCount,
          status: "active",
          lastSeenAt: sql`now()`,
          // `slug` is not in this statement: it is allocated once and frozen.
          ...(renamedFrom !== null
            ? {
                previousSourceKeys: appendKey(categories.previousSourceKeys, renamedFrom),
                lastChangedAt: sql`now()`,
              }
            : {}),
        })
        .where(eq(categories.id, row.id));
      ids.set(category.sourceKey, row.id);
      continue;
    }

    const [inserted] = await db
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
      .returning({ id: categories.id });
    if (inserted) ids.set(category.sourceKey, inserted.id);
  }

  // Parents can only be linked once every category has an id. The listing is
  // the whole tree, so a category it shows at the top level is moved there.
  const linked = new Set<string>();
  for (const category of discovered) {
    const childId = ids.get(category.sourceKey);
    if (!childId || linked.has(childId)) continue;
    linked.add(childId);
    const parentId = category.parentKey ? (ids.get(category.parentKey) ?? null) : null;
    if (category.parentKey && (!parentId || parentId === childId)) continue;
    await db.update(categories).set({ parentId }).where(eq(categories.id, childId));
  }

  if (markAbsent && plan.absent.length > 0) {
    await db
      .update(categories)
      .set({ status: "missing" })
      .where(
        inArray(
          categories.id,
          plan.absent.map((row) => row.id),
        ),
      );
  }

  return { ids, changes };
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
): Promise<
  Map<string, Array<{ sourceUrl: string; contentHash: string | null; objectKey: string | null }>>
> {
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

/**
 * The columns the enrichment step owns: everything read from the source's
 * product page rather than from its catalog listing.
 *
 * The listing has none of this, so a listing-driven write that included any of
 * these columns would overwrite what enrichment stored with nothing, on every
 * run. They are therefore excluded from `ProductMoveColumns` below — the type
 * the sync's own column list must satisfy — which turns "the upsert wrote
 * `sku: null`" from a bug someone has to notice into one that does not compile.
 */
export const ENRICHMENT_COLUMNS = [
  "sku",
  "arabicaPercent",
  "origin",
  "roast",
  "characteristics",
  "enrichedAt",
  "enrichAttemptedAt",
] as const satisfies ReadonlyArray<keyof typeof products.$inferSelect>;

export type EnrichmentColumn = (typeof ENRICHMENT_COLUMNS)[number];

/**
 * What a move may write besides the key itself. Never the slug, never the
 * copy, never what enrichment stored.
 */
export type ProductMoveColumns = Omit<
  PgUpdateSetSource<typeof products>,
  | EnrichmentColumn
  | "id"
  | "sourceSiteId"
  | "slug"
  | "sourceKey"
  | "sourcePath"
  | "sourceUrl"
  | "sourceVariantKey"
  | "previousSourceKeys"
  | "descriptionTextOverride"
  | "descriptionHtmlOverride"
  | "retailPriceOverride"
  | "retailOldPriceOverride"
>;

export interface ProductMoveInput {
  readonly syncRunId: string;
  readonly productId: string;
  readonly to: {
    readonly sourceKey: string;
    readonly sourcePath: string;
    readonly sourceUrl: string;
    readonly sourceVariantKey: string | null;
  };
  /** Further columns to refresh in the same statement, e.g. the new content. */
  readonly set?: ProductMoveColumns;
  readonly changedFields: string[];
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
}

export interface ProductMoveResult {
  readonly previousSourceKey: string;
  readonly slug: string;
}

/**
 * Re-point an existing product row at a new source key.
 *
 * The one place a move is written, shared by the sync and by `catalog:link`,
 * so an automatic and a manual move cannot drift apart. The row is addressed
 * by id; its id, slug, description overrides and retail prices are not in the
 * statement at all, which is what keeps storefront URLs, hand-written copy,
 * mirrored images and order history attached to it.
 *
 * The audit record notes what was preserved, so `catalog:verify` can later
 * prove that it still is.
 */
export async function applyProductMove(
  db: Pick<Database, "transaction">,
  input: ProductMoveInput,
): Promise<ProductMoveResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        sourceKey: products.sourceKey,
        slug: products.slug,
        descriptionTextOverride: products.descriptionTextOverride,
        descriptionHtmlOverride: products.descriptionHtmlOverride,
      })
      .from(products)
      .where(eq(products.id, input.productId))
      .for("update");
    if (!current) throw new Error(`Cannot move product ${input.productId}: no such row`);

    await tx
      .update(products)
      .set({
        ...input.set,
        sourceKey: input.to.sourceKey,
        sourcePath: input.to.sourcePath,
        sourceUrl: input.to.sourceUrl,
        sourceVariantKey: input.to.sourceVariantKey,
        // A URL the source renames back and forth is still listed only once.
        previousSourceKeys: sql`case
          when ${current.sourceKey}::text = any(${products.previousSourceKeys}) then ${products.previousSourceKeys}
          else array_append(${products.previousSourceKeys}, ${current.sourceKey}::text)
        end`,
      })
      .where(eq(products.id, input.productId));

    await tx.insert(syncChanges).values({
      syncRunId: input.syncRunId,
      productId: input.productId,
      sourceKey: input.to.sourceKey,
      changeType: "moved",
      changedFields: input.changedFields,
      before: { ...input.before, sourceKey: current.sourceKey },
      after: {
        ...input.after,
        sourceKey: input.to.sourceKey,
        preserved: {
          slug: current.slug,
          descriptionTextOverride: current.descriptionTextOverride !== null,
          descriptionHtmlOverride: current.descriptionHtmlOverride !== null,
        },
      },
    });

    return { previousSourceKey: current.sourceKey, slug: current.slug };
  });
}

// --- Enrichment ---------------------------------------------------------------

/** One product whose page is to be read. */
export interface EnrichmentTarget {
  readonly productId: string;
  readonly sourceKey: string;
  readonly sourceUrl: string;
  /** Another product shares this URL, so the page's code names neither. */
  readonly hasUrlCollision: boolean;
  /** The code already stored, to notice when the page now states another. */
  readonly sku: string | null;
}

const enrichmentTargetColumns = {
  productId: products.id,
  sourceKey: products.sourceKey,
  sourceUrl: products.sourceUrl,
  hasUrlCollision: products.hasUrlCollision,
  sku: products.sku,
};

export async function loadEnrichmentTargets(
  db: Database,
  productIds: readonly string[],
): Promise<Map<string, EnrichmentTarget>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select(enrichmentTargetColumns)
    .from(products)
    .where(inArray(products.id, [...productIds]));
  return new Map(rows.map((row) => [row.productId, row]));
}

/**
 * Active products whose page has never been read successfully, oldest attempt
 * first. A page that failed is not offered again until `retryAfterHours` have
 * passed, so one dead URL costs the source one request a day, not one a run,
 * and cannot crowd the products behind it out of a small per-run budget.
 */
export async function loadEnrichmentBacklog(
  db: Database,
  sourceSiteId: string,
  options: { limit: number; excludeIds?: readonly string[]; retryAfterHours: number },
): Promise<EnrichmentTarget[]> {
  if (options.limit <= 0) return [];
  const exclude = options.excludeIds ?? [];
  return db
    .select(enrichmentTargetColumns)
    .from(products)
    .where(
      and(
        eq(products.sourceSiteId, sourceSiteId),
        eq(products.status, "active"),
        isNull(products.enrichedAt),
        sql`(${products.enrichAttemptedAt} is null or ${products.enrichAttemptedAt} < now() - make_interval(hours => ${options.retryAfterHours}))`,
        ...(exclude.length > 0 ? [notInArray(products.id, [...exclude])] : []),
      ),
    )
    .orderBy(
      sql`${products.enrichAttemptedAt} asc nulls first`,
      asc(products.firstSeenAt),
      asc(products.id),
    )
    .limit(options.limit);
}

/** Active products with no product code: what `catalog:enrich` reads. */
export async function loadProductsWithoutCode(
  db: Database,
  sourceSiteId: string,
  limit?: number,
): Promise<Array<EnrichmentTarget & { slug: string; name: string }>> {
  const query = db
    .select({ ...enrichmentTargetColumns, slug: products.slug, name: products.name })
    .from(products)
    .where(
      and(
        eq(products.sourceSiteId, sourceSiteId),
        eq(products.status, "active"),
        isNull(products.sku),
      ),
    )
    .orderBy(asc(products.firstSeenAt), asc(products.id));
  return limit !== undefined ? query.limit(limit) : query;
}

export async function countProductCodes(
  db: Database,
  sourceSiteId: string,
): Promise<{ active: number; withCode: number; withoutCode: number }> {
  const [row] = await db
    .select({
      active: sql<number>`count(*)::int`,
      withCode: sql<number>`count(${products.sku})::int`,
    })
    .from(products)
    .where(and(eq(products.sourceSiteId, sourceSiteId), eq(products.status, "active")));
  const active = row?.active ?? 0;
  const withCode = row?.withCode ?? 0;
  return { active, withCode, withoutCode: active - withCode };
}

/** Codes held by more than one active product. Expected to be empty. */
export async function loadSharedProductCodes(
  db: Database,
  sourceSiteId: string,
): Promise<Array<{ sku: string; slugs: string[] }>> {
  const rows = await db
    .select({
      sku: products.sku,
      slugs: sql<string[]>`array_agg(${products.slug} order by ${products.slug})`,
    })
    .from(products)
    .where(
      and(
        eq(products.sourceSiteId, sourceSiteId),
        eq(products.status, "active"),
        sql`${products.sku} is not null`,
      ),
    )
    .groupBy(products.sku)
    .having(sql`count(*) > 1`)
    .orderBy(products.sku);
  return rows.map((row) => ({ sku: row.sku as string, slugs: row.slugs }));
}

/** What one successful read of a product page stores. */
export interface EnrichmentValues {
  /** Null leaves the stored code alone: a page that stops printing it proves nothing. */
  readonly sku: string | null;
  readonly arabicaPercent: number | null;
  readonly origin: string | null;
  readonly roast: string | null;
  readonly characteristics: ReadonlyArray<{ label: string; value: string }>;
}

/**
 * The one statement that writes enrichment's columns — and writes nothing
 * else: not `semantic_hash`, not `last_changed_at`, not `status`. That is what
 * keeps a sync after an enrichment a no-op.
 */
export async function storeEnrichment(
  db: Database,
  productId: string,
  values: EnrichmentValues,
): Promise<void> {
  await db
    .update(products)
    .set({
      ...(values.sku !== null ? { sku: values.sku } : {}),
      arabicaPercent: values.arabicaPercent,
      origin: values.origin,
      roast: values.roast,
      characteristics: [...values.characteristics],
      enrichedAt: sql`now()`,
      enrichAttemptedAt: sql`now()`,
    })
    .where(eq(products.id, productId));
}

/** A failed read: what was stored stays, and the page is due again later. */
export async function markEnrichmentFailed(db: Database, productId: string): Promise<void> {
  await db
    .update(products)
    .set({ enrichedAt: null, enrichAttemptedAt: sql`now()` })
    .where(eq(products.id, productId));
}

/** Put products at the front of the backlog without touching what they hold. */
export async function markEnrichmentDue(
  db: Database,
  productIds: readonly string[],
): Promise<void> {
  if (productIds.length === 0) return;
  await db
    .update(products)
    .set({ enrichedAt: null, enrichAttemptedAt: null })
    .where(inArray(products.id, [...productIds]));
}

export { brands, categories, productCategories, productImages, products, syncRuns };
