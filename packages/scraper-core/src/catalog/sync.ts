import { eq, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { brands, categories, productImages, products, syncRuns } from "@catalog/db/schema";
import {
  type Logger,
  type ProductNameInput,
  packServings,
  productName,
  productSearchName,
  silentLogger,
} from "@catalog/shared";
import { RESERVED_PRODUCT_SLUGS } from "@catalog/shared/storefront-data";
import type { ScraperConfig } from "../config.ts";
import type { Fetcher } from "../fetch/fetcher.ts";
import { ImageMirror } from "../storage/images.ts";
import type { StorageDriver } from "../storage/driver.ts";
import {
  type BreakerDecision,
  evaluateCircuitBreaker,
  suppressRemovals,
} from "./circuitBreaker.ts";
import { type DiffResult, diffCatalog } from "./diff.ts";
import { type CatalogDiscoveryResult, discoverCatalog } from "./discover.ts";
import {
  ENRICH_RETRY_AFTER_HOURS,
  type EnrichmentSummary,
  ProductPageReader,
  type SkuLookupResult,
  enrichProducts,
  lookupDiscoveredSkus,
  recordReadFailures,
} from "./enrich.ts";
import { assignProductSlug } from "./identity.ts";
import type { NormalizedProduct } from "./normalize.ts";
import type { TaxonomyChanges } from "./taxonomy.ts";
import {
  type EnrichmentTarget,
  type ProductMoveColumns,
  applyProductMove,
  countActiveProducts,
  countAllProducts,
  ensureSourceSite,
  insertSyncChange,
  loadEnrichmentBacklog,
  loadEnrichmentTargets,
  loadExistingProducts,
  loadLatestBaseline,
  loadProductImages,
  loadTakenProductSlugs,
  markEnrichmentDue,
  recordBaseline,
  recordScrapeError,
  replaceProductCategories,
  upsertBrands,
  upsertCategories,
} from "./repository.ts";

/**
 * The recurring catalog synchronisation.
 *
 * The same code path serves the CLI and the Lambda: there is exactly one
 * implementation of this business logic.
 *
 * Order of operations matters and is deliberate:
 *
 *   1. discover  — read the source, never touching our data
 *   2. diff      — compute intent, still touching nothing
 *   3. judge     — let the circuit breaker veto destructive intent
 *   4. apply     — write, with removals already stripped if vetoed
 *   5. enrich    — read a few product pages and store what only they state
 *
 * Nothing destructive can happen before step 3 has run.
 *
 * Step 5 is deliberately last and deliberately weak. It runs after the run's
 * outcome is settled, it cannot alter that outcome, and a product page that
 * will not load is counted and recorded, never raised. Two writers touch a
 * product row — the listing-driven upsert of step 4 and the enrichment of step
 * 5 — and they own disjoint columns (`productColumns` below; `ENRICHMENT_COLUMNS`
 * in `repository.ts`), so neither can undo the other.
 */

export interface SyncOptions {
  readonly config: ScraperConfig;
  readonly db: Database;
  readonly fetcher: Fetcher;
  readonly storage: StorageDriver;
  readonly logger?: Logger;
  /** Compute and report the diff without writing product state. */
  readonly dryRun?: boolean;
  readonly skipImages?: boolean;
  readonly productLimit?: number;
  readonly crawlRunId?: string | null;
}

export interface SyncResult {
  readonly syncRunId: string | null;
  readonly status: "succeeded" | "partial" | "failed";
  readonly dryRun: boolean;
  readonly discovery: CatalogDiscoveryResult;
  readonly diff: DiffResult;
  readonly appliedDiff: DiffResult;
  readonly breaker: BreakerDecision;
  /** Brand and category rows created, renamed in place, hidden or brought back. */
  readonly taxonomy: { readonly brands: TaxonomyChanges; readonly categories: TaxonomyChanges };
  readonly productsBefore: number;
  readonly productsAfter: number;
  readonly images: { mirrored: number; skipped: number; failed: number };
  readonly enrichment: SyncEnrichment;
  readonly durationMs: number;
}

/** What the run did with product pages. None of it affects `status`. */
export interface SyncEnrichment {
  /** Requests for product pages, lookup and enrichment together. */
  readonly requests: number;
  /** The most this run was allowed to make. */
  readonly budget: number;
  /** Products whose page was read and stored. */
  readonly enriched: number;
  /** Product pages that could not be read. */
  readonly failed: number;
  /** Products left for a later run because the budget was spent. */
  readonly deferred: number;
  /** The pre-diff product-code lookup that feeds move detection. */
  readonly lookup: Omit<SkuLookupResult, "skus">;
  readonly skuChanges: EnrichmentSummary["skuChanges"];
  /** True when the run stopped asking after repeated failures. */
  readonly halted: boolean;
}

/** Changes after which a product's page is read again. */
const ENRICH_AFTER: ReadonlySet<string> = new Set(["created", "moved", "updated", "restored"]);

export async function runCatalogSync(options: SyncOptions): Promise<SyncResult> {
  const { config, db, fetcher, storage } = options;
  const logger = (options.logger ?? silentLogger).child({ job: "catalog-sync" });
  const startedAt = Date.now();
  const dryRun = options.dryRun ?? false;

  const site = await ensureSourceSite(db, {
    key: config.sourceKey,
    name: config.sourceName,
    baseUrl: config.baseUrl,
    canonicalHost: config.canonicalHost,
  });

  const [run] = await db
    .insert(syncRuns)
    .values({
      sourceSiteId: site.id,
      crawlRunId: options.crawlRunId ?? null,
      status: "running",
      dryRun,
      metadata: { userAgent: config.userAgent, concurrency: config.concurrency },
    })
    .returning({ id: syncRuns.id });
  if (!run) throw new Error("Failed to create sync run");
  const syncRunId = run.id;
  const runLogger = logger.child({ syncRunId });

  runLogger.info("sync.started", { dryRun, baseUrl: config.baseUrl });

  try {
    // 1. Discover -----------------------------------------------------------
    await fetcher.calibrateSoft404();
    const discovery = await discoverCatalog({
      config,
      fetcher,
      logger: runLogger,
      ...(options.productLimit !== undefined ? { productLimit: options.productLimit } : {}),
    });

    for (const error of discovery.errors) {
      await recordScrapeError(db, {
        sourceSiteId: site.id,
        syncRunId,
        url: error.url,
        stage: error.stage,
        errorClass: "DiscoveryError",
        errorMessage: error.message,
      });
    }
    for (const invalid of discovery.invalidRecords) {
      await recordScrapeError(db, {
        sourceSiteId: site.id,
        syncRunId,
        url: invalid.path,
        stage: "normalize",
        errorClass: "ValidationError",
        errorMessage: invalid.issues.join("; "),
      });
    }

    // 2. Diff ---------------------------------------------------------------
    const existing = await loadExistingProducts(db, site.id);
    const productsBefore = await countAllProducts(db, site.id);
    const activeBefore = await countActiveProducts(db, site.id);

    /*
     * The listing carries no product code, so a product that matches no stored
     * key cannot be recognised as a renamed one whose name also changed. The
     * code for those few is read from their pages here, before the diff, and
     * handed to it as data; the diff itself stays pure. A dry run does this
     * too — it reads, it does not write — so that it reports the diff the real
     * run would apply.
     */
    const reader = new ProductPageReader({
      fetcher,
      config,
      logger: runLogger,
      budget: config.enrichMaxPerRun,
    });
    let lookup: SkuLookupResult = {
      skus: new Map(),
      candidateCount: 0,
      looked: 0,
      found: 0,
      skipped: "disabled",
    };
    try {
      lookup = await lookupDiscoveredSkus({
        discovered: discovery.products,
        existing,
        reader,
        maxCandidates: config.enrichLookupMax,
        logger: runLogger,
      });
    } catch (error) {
      // Without the lookup the diff is what it always was. Never worth a run.
      runLogger.warn("enrich.lookup_failed", { error });
    }

    const diff = diffCatalog(discovery.products, existing, {
      missingThreshold: config.missingThreshold,
      discoveredSkus: lookup.skus,
    });

    if (diff.unresolvedMoves.length > 0) {
      // Each of these becomes a duplicate unless someone pairs it by hand
      // (`catalog:link`), so it must not pass silently.
      runLogger.warn("sync.moves_unresolved", {
        count: diff.unresolvedMoves.length,
        unresolved: diff.unresolvedMoves,
      });
    }

    // 3. Judge --------------------------------------------------------------
    const baseline = await loadLatestBaseline(db, site.id);
    const breaker = evaluateCircuitBreaker(
      {
        discoveredCount: discovery.products.length,
        activeCount: activeBefore,
        baselineDiscoveredCount: baseline?.discoveredProductCount ?? null,
        // Counted after move pairing: a renamed product is in `diff.moved`,
        // not here, so a mass rename is not judged a mass removal.
        disappearingCount: diff.missing.length + diff.removed.length,
        parserConfidence: discovery.confidence,
        failedEntryPages: discovery.errors.filter((e) => e.stage.includes("fetch")).length,
        catalogSource: discovery.source,
      },
      {
        maxDisappearedRatio: config.breakerMaxDisappearedRatio,
        minDiscoveredRatio: config.breakerMinDiscoveredRatio,
        minAbsoluteProducts: config.breakerMinAbsoluteProducts,
        minParserConfidence: config.breakerMinParserConfidence,
      },
    );

    if (breaker.tripped) {
      runLogger.error("sync.circuit_breaker_open", {
        reasons: breaker.reasons,
        summary: breaker.summary,
        detail: breaker.detail,
      });
    }

    const appliedDiff = breaker.tripped ? suppressRemovals(diff) : diff;

    // 4. Apply --------------------------------------------------------------
    let images = { mirrored: 0, skipped: 0, failed: 0 };
    let enrichmentSummary: EnrichmentSummary = {
      enriched: 0,
      failed: 0,
      deferred: 0,
      skuChanges: [],
    };
    let enrichmentError: string | null = null;

    /*
     * A brand or category missing from the listing is hidden, with the same
     * caution as a product: never on a run the breaker refused, and never
     * from the HTML fallback, which sees only part of the taxonomy. There is
     * no counter here as there is for products — hiding is the whole effect,
     * the row and its slug are kept, and the next listing that includes it
     * brings it straight back.
     */
    const taxonomyOptions = {
      markAbsent: !breaker.tripped && discovery.source === "filter_init",
      dryRun,
    };
    const brandResult = await upsertBrands(db, site.id, discovery.brands, taxonomyOptions);
    const categoryResult = await upsertCategories(
      db,
      site.id,
      discovery.categories,
      taxonomyOptions,
    );
    const taxonomy = { brands: brandResult.changes, categories: categoryResult.changes };
    const taxonomyConflicts = [...taxonomy.brands.conflicts, ...taxonomy.categories.conflicts];
    if (taxonomyConflicts.length > 0) {
      runLogger.warn("sync.taxonomy_key_conflict", { conflicts: taxonomyConflicts });
    }

    if (!dryRun) {
      const brandMap = brandResult.ids;
      const categoryMap = categoryResult.ids;
      const existingSlugs = await loadTakenProductSlugs(db, site.id);
      const takenSlugs = await loadSpokenForSlugs(db, site.id, existingSlugs.values());
      // The brand's name as the catalog stores it, read back rather than
      // taken from the listing: it is what `catalog:reslug` reads, and a new
      // product's slug must come out the same whichever of the two computes it.
      const brandNames = new Map(
        (
          await db
            .select({ sourceKey: brands.sourceKey, name: brands.name })
            .from(brands)
            .where(eq(brands.sourceSiteId, site.id))
        ).map((brand) => [brand.sourceKey, brand.name]),
      );

      const productIdByKey = new Map<string, string>();

      for (const change of appliedDiff.changes) {
        if (change.changeType === "marked_missing" || change.changeType === "removed") {
          await db
            .update(products)
            .set({
              status: change.nextStatus,
              consecutiveMissingCount: change.nextMissingCount,
              latestSyncRunId: syncRunId,
              ...(change.nextStatus === "removed" ? { removedAt: sql`now()` } : {}),
            })
            .where(eq(products.id, change.productId as string));
          await insertSyncChange(db, {
            syncRunId,
            productId: change.productId,
            sourceKey: change.sourceKey,
            changeType: change.changeType,
            changedFields: change.changedFields,
            before: change.before,
            after: change.after,
          });
          continue;
        }

        const product = change.product;
        if (!product) continue;

        /*
         * What the shop's own name for this product is built from: exactly
         * what the row will be linked to. A brand or a category the listing
         * names but the catalog does not hold leaves the product without one,
         * and its name, its slug and `catalog:reslug` must all agree on that.
         */
        const naming: ProductNameInput = {
          sourceName: product.name,
          sourceKey: product.sourceKey,
          brand:
            product.brandKey && brandMap.has(product.brandKey)
              ? {
                  sourceKey: product.brandKey,
                  name: brandNames.get(product.brandKey) ?? product.brandKey,
                }
              : null,
          categoryKeys: product.categoryKeys.filter((key) => categoryMap.has(key)),
          packValue: product.weight?.value ?? null,
          packUnit: product.weight?.unit ?? null,
        };
        const searchName = productSearchName(productName(naming));

        if (change.changeType === "moved") {
          // The existing row is re-pointed by id. It is never upserted — the
          // new key matches no row, so an upsert would insert the twin this
          // change type exists to prevent — and no slug is allocated.
          const productId = change.productId as string;
          const contentChanged = change.changedFields.includes("semanticHash");
          await applyProductMove(db, {
            syncRunId,
            productId,
            to: {
              sourceKey: product.sourceKey,
              sourcePath: product.sourcePath,
              sourceUrl: product.sourceUrl,
              sourceVariantKey: product.sourceVariantKey,
            },
            set: {
              ...productColumns({
                product,
                syncRunId,
                searchName,
                brandId: product.brandKey ? (brandMap.get(product.brandKey) ?? null) : null,
              }),
              removedAt: null,
              lastSeenAt: sql`now()`,
              // A bare rename is not a content change.
              ...(contentChanged ? { lastChangedAt: sql`now()` } : {}),
            },
            changedFields: change.changedFields,
            before: change.before ?? {},
            after: change.after ?? {},
          });
          productIdByKey.set(product.sourceKey, productId);

          const movedCategoryIds = product.categoryKeys
            .map((key) => categoryMap.get(key))
            .filter((id): id is string => typeof id === "string");
          await replaceProductCategories(
            db,
            productId,
            movedCategoryIds,
            movedCategoryIds[0] ?? null,
          );
          continue;
        }

        // Slug is allocated once and then never changed, so storefront URLs
        // and any external links to them stay stable across syncs.
        const slug = existingSlugs.get(product.sourceKey) ?? assignProductSlug(naming, takenSlugs);

        const productId = await upsertProduct(db, {
          sourceSiteId: site.id,
          syncRunId,
          product,
          slug,
          searchName,
          brandId: product.brandKey ? (brandMap.get(product.brandKey) ?? null) : null,
          isUnchanged: change.changeType === "unchanged",
        });
        productIdByKey.set(product.sourceKey, productId);

        const categoryIds = product.categoryKeys
          .map((key) => categoryMap.get(key))
          .filter((id): id is string => typeof id === "string");
        await replaceProductCategories(db, productId, categoryIds, categoryIds[0] ?? null);

        if (change.changeType !== "unchanged") {
          await insertSyncChange(db, {
            syncRunId,
            productId,
            sourceKey: change.sourceKey,
            changeType: change.changeType,
            changedFields: change.changedFields,
            before: change.before,
            after: change.after,
          });
        }
      }

      if (config.imagesEnabled && !options.skipImages) {
        images = await mirrorProductImages({
          db,
          config,
          storage,
          logger: runLogger,
          fetchImpl: fetcher.getFetchImpl(),
          products: discovery.products,
          productIdByKey,
        });
      }

      // A baseline is only recorded for a run we actually trust, so a bad run
      // can never lower the bar that the next run is judged against.
      if (!breaker.tripped && discovery.products.length > 0) {
        await recordBaseline(db, {
          sourceSiteId: site.id,
          syncRunId,
          activeProductCount: await countActiveProducts(db, site.id),
          discoveredProductCount: discovery.products.length,
          categoryCount: discovery.categories.length,
          brandCount: discovery.brands.length,
        });
      }

      // 5. Enrich -----------------------------------------------------------
      try {
        const changed = appliedDiff.changes
          .filter((change) => ENRICH_AFTER.has(change.changeType))
          .map((change) => productIdByKey.get(change.sourceKey))
          .filter((id): id is string => typeof id === "string");

        if (breaker.tripped) {
          // Not on a run the breaker refused: something is structurally wrong
          // with what the source served, and that is no time to ask it for
          // more. What changed is remembered as due, for a run that is trusted.
          await markEnrichmentDue(db, changed);
          enrichmentSummary = { ...enrichmentSummary, deferred: changed.length };
        } else {
          const changedTargets = await loadEnrichmentTargets(db, changed);
          const first = changed
            .map((id) => changedTargets.get(id))
            .filter((target): target is EnrichmentTarget => target !== undefined);
          // Then the backlog, with whatever the changed products leave over,
          // so a catalog that was never enriched drains over a few runs.
          const backlog = await loadEnrichmentBacklog(db, site.id, {
            limit: Math.max(
              0,
              reader.remaining - first.filter((t) => !reader.hasRead(t.sourceUrl)).length,
            ),
            excludeIds: changed,
            retryAfterHours: ENRICH_RETRY_AFTER_HOURS,
          });
          enrichmentSummary = await enrichProducts({
            db,
            reader,
            targets: [...first, ...backlog],
            logger: runLogger,
          });
        }
      } catch (error) {
        // The catalog is already applied and correct. Whatever went wrong
        // here costs some characteristics until the next run, not this run.
        enrichmentError = error instanceof Error ? error.message : String(error);
        runLogger.error("enrich.failed", { error });
      }
    }

    const readFailures = reader.failures;
    try {
      await recordReadFailures(db, readFailures, {
        sourceSiteId: site.id,
        syncRunId,
        kind: "sync_enrichment",
      });
      if (enrichmentError !== null) {
        await recordScrapeError(db, {
          sourceSiteId: site.id,
          syncRunId,
          stage: "enrich",
          errorClass: "EnrichmentError",
          errorMessage: enrichmentError,
        });
      }
    } catch (error) {
      runLogger.error("enrich.record_failed", { error });
    }
    const { skus: _skus, ...lookupSummary } = lookup;
    const enrichment: SyncEnrichment = {
      requests: reader.requests,
      budget: config.enrichMaxPerRun,
      enriched: enrichmentSummary.enriched,
      failed: readFailures.length,
      deferred: enrichmentSummary.deferred,
      lookup: lookupSummary,
      skuChanges: enrichmentSummary.skuChanges,
      halted: reader.halted,
    };

    const productsAfter = dryRun ? productsBefore : await countAllProducts(db, site.id);
    const durationMs = Date.now() - startedAt;
    const status: SyncResult["status"] = breaker.tripped
      ? "partial"
      : discovery.errors.length > 0
        ? "partial"
        : "succeeded";

    await db
      .update(syncRuns)
      .set({
        status,
        completedAt: sql`now()`,
        durationMs,
        discoveredCount: discovery.products.length,
        discoveredRawCount: discovery.rawRecordCount,
        productsBefore,
        productsAfter,
        createdCount: appliedDiff.counts.created,
        updatedCount: appliedDiff.counts.updated,
        unchangedCount: appliedDiff.counts.unchanged,
        missingCount: appliedDiff.counts.marked_missing,
        removedCount: appliedDiff.counts.removed,
        restoredCount: appliedDiff.counts.restored,
        movedCount: appliedDiff.counts.moved,
        failedCount: discovery.errors.length + discovery.invalidRecords.length,
        imagesMirrored: images.mirrored,
        imagesSkipped: images.skipped,
        imagesFailed: images.failed,
        enrichedCount: enrichment.enriched,
        enrichFailedCount: enrichment.failed,
        circuitBreakerTripped: breaker.tripped,
        circuitBreakerReason: breaker.tripped ? breaker.summary : null,
        circuitBreakerDetail: breaker.detail,
        catalogSource: discovery.source,
        parserConfidence: discovery.confidence.toFixed(3),
        metadata: sql`${syncRuns.metadata} || ${JSON.stringify({ unresolvedMoves: diff.unresolvedMoves, taxonomy, enrichment })}::jsonb`,
      })
      .where(eq(syncRuns.id, syncRunId));

    runLogger.info("sync.completed", {
      status,
      durationMs,
      discovered: discovery.products.length,
      ...appliedDiff.counts,
      unresolvedMoves: diff.unresolvedMoves.length,
      taxonomy,
      images,
      enrichment,
      circuitBreakerTripped: breaker.tripped,
      catalogSource: discovery.source,
      parserConfidence: discovery.confidence,
    });

    return {
      syncRunId,
      status,
      dryRun,
      discovery,
      diff,
      appliedDiff,
      breaker,
      taxonomy,
      productsBefore,
      productsAfter,
      images,
      enrichment,
      durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runLogger.error("sync.failed", { error });
    await db
      .update(syncRuns)
      .set({
        status: "failed",
        completedAt: sql`now()`,
        durationMs: Date.now() - startedAt,
        errorSummary: message.slice(0, 4000),
      })
      .where(eq(syncRuns.id, syncRunId));
    await recordScrapeError(db, {
      sourceSiteId: site.id,
      syncRunId,
      stage: "sync",
      errorClass: error instanceof Error ? error.name : "Error",
      errorMessage: message,
    });
    throw error;
  }
}

/**
 * Every first-level address a new product may not take.
 *
 * Products share the first level of the storefront with its categories and
 * its routes (`/bg/<slug>`), so "taken" is more than the other products'
 * slugs: it is also every slug a product used to have, which still redirects
 * to it; every category's stored slug; and every route and curated landing
 * slug in every language, read from the storefront's own tables. Until this
 * existed a colliding product slug was only tested for, never refused.
 */
async function loadSpokenForSlugs(
  db: Database,
  sourceSiteId: string,
  productSlugs: Iterable<string>,
): Promise<Set<string>> {
  const [former, categoryRows] = await Promise.all([
    db
      .select({ previousSlugs: products.previousSlugs })
      .from(products)
      .where(eq(products.sourceSiteId, sourceSiteId)),
    db
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.sourceSiteId, sourceSiteId)),
  ]);
  return new Set([
    ...RESERVED_PRODUCT_SLUGS,
    ...categoryRows.map((row) => row.slug),
    ...former.flatMap((row) => row.previousSlugs),
    ...productSlugs,
  ]);
}

async function upsertProduct(
  db: Database,
  input: {
    sourceSiteId: string;
    syncRunId: string;
    product: NormalizedProduct;
    slug: string;
    searchName: string;
    brandId: string | null;
    isUnchanged: boolean;
  },
): Promise<string> {
  const { product } = input;

  const values = {
    ...productColumns(input),
    sourceSiteId: input.sourceSiteId,
    sourceKey: product.sourceKey,
    sourceUrl: product.sourceUrl,
    sourcePath: product.sourcePath,
    sourceVariantKey: product.sourceVariantKey,
    slug: input.slug,
  };

  const [row] = await db
    .insert(products)
    .values(values)
    .onConflictDoUpdate({
      target: [products.sourceSiteId, products.sourceKey],
      set: {
        ...values,
        // `slug` is intentionally omitted: it is allocated once and frozen.
        slug: sql`${products.slug}`,
        removedAt: null,
        lastSeenAt: sql`now()`,
        // `lastChangedAt` only moves when the content actually changed.
        ...(input.isUnchanged ? {} : { lastChangedAt: sql`now()` }),
      },
    })
    .returning({ id: products.id });

  if (!row) throw new Error(`Failed to upsert product ${product.sourceKey}`);
  return row.id;
}

/**
 * The columns the listing-driven sync owns, apart from identity and slug.
 *
 * Shared by the upsert and by a move, so a product that is renamed and edited
 * in the same run is refreshed exactly as an ordinary update would refresh it.
 *
 * These are written on every run, for unchanged products too — so nothing the
 * listing does not carry may appear here. The product code and the facts from
 * the product page belong to enrichment (`ENRICHMENT_COLUMNS`), and the type
 * this object must satisfy excludes them: adding `sku` here is a compile error, because
 * with the listing's empty value it would erase the stored code on the next
 * run, and on every run after. `semanticHash` is likewise the listing's hash
 * and nothing else, which is why enriching a product never makes it "changed".
 */
function productColumns(input: {
  product: NormalizedProduct;
  syncRunId: string;
  /** The shop's own name, for search; see `products.search_name`. */
  searchName: string;
  brandId: string | null;
}) {
  const { product } = input;
  // Stored so a listing can sort by price per cup; see the column comment.
  const servings = packServings(product.weight?.value ?? null, product.weight?.unit ?? null);
  return {
    hasUrlCollision: product.hasUrlCollision,
    name: product.name,
    searchName: input.searchName,
    currentPrice: product.currentPrice?.amount ?? null,
    oldPrice: product.oldPrice?.amount ?? null,
    currency: product.currency,
    availability: product.availability,
    brandId: input.brandId,
    descriptionHtml: product.descriptionHtml,
    descriptionText: product.descriptionText,
    weight: product.weightText,
    weightValue: product.weight?.value ?? null,
    weightUnit: product.weight?.unit ?? null,
    servings: servings?.exact ?? null,
    servingsEstimated: servings?.estimated ?? null,
    gtin: product.gtin,
    attributes: product.attributes,
    sourceData: {
      ...product.sourceData,
      brandKey: product.brandKey,
      categoryKeys: product.categoryKeys,
      weightCanonical: product.weight?.canonical ?? null,
      /*
       * The source's own pack field, verbatim, and — when its name states
       * another size — both sizes. Written on every run, null when there is
       * nothing to say, so a conflict the source corrects clears itself. The
       * admin's sync page lists the conflicts; `catalog:pack-size` reads the
       * field to redo the decision without a crawl.
       */
      packField: product.packFieldText ?? null,
      packSizeConflict: product.packSizeConflict ?? null,
      imageUrls: product.sourceImageUrls,
      identityStrategy: product.identityStrategy,
    },
    semanticHash: product.semanticHash,
    status: "active" as const,
    consecutiveMissingCount: 0,
    latestSyncRunId: input.syncRunId,
  } satisfies ProductMoveColumns;
}

async function mirrorProductImages(input: {
  db: Database;
  config: ScraperConfig;
  storage: StorageDriver;
  logger: Logger;
  fetchImpl: typeof fetch;
  products: readonly NormalizedProduct[];
  productIdByKey: Map<string, string>;
}): Promise<{ mirrored: number; skipped: number; failed: number }> {
  const { db, config, storage, logger, productIdByKey } = input;

  const productIds = [...productIdByKey.values()];
  const existingImages = await loadProductImages(db, productIds);

  const requests = input.products.flatMap((product) => {
    const productId = productIdByKey.get(product.sourceKey);
    if (!productId) return [];
    const known = existingImages.get(productId) ?? [];
    return product.sourceImageUrls.map((sourceUrl, ordinal) => {
      const match = known.find((image) => image.sourceUrl === sourceUrl);
      return {
        productKey: product.sourceKey,
        sourceUrl,
        ordinal,
        alt: product.name,
        knownContentHash: match?.contentHash ?? null,
        knownObjectKey: match?.objectKey ?? null,
      };
    });
  });

  if (requests.length === 0) return { mirrored: 0, skipped: 0, failed: 0 };

  const mirror = new ImageMirror({ config, storage, logger, fetchImpl: input.fetchImpl });
  const results = await mirror.mirrorAll(requests);

  let mirrored = 0;
  let skipped = 0;
  let failed = 0;

  for (const result of results) {
    const productId = productIdByKey.get(result.request.productKey);
    if (!productId) continue;

    if (result.outcome === "failed") {
      failed += 1;
      logger.warn("image.failed", {
        sourceUrl: result.request.sourceUrl,
        error: result.error,
      });
      await db
        .insert(productImages)
        .values({
          productId,
          sourceUrl: result.request.sourceUrl,
          ordinal: result.request.ordinal,
          isPrimary: result.request.ordinal === 0,
          alt: result.request.alt,
          status: "failed",
          lastError: (result.error ?? "unknown").slice(0, 1000),
        })
        .onConflictDoUpdate({
          target: [productImages.productId, productImages.sourceUrl],
          set: {
            status: "failed",
            lastError: (result.error ?? "unknown").slice(0, 1000),
            lastSeenAt: sql`now()`,
          },
        });
      continue;
    }

    if (result.outcome === "mirrored") mirrored += 1;
    else skipped += 1;

    await db
      .insert(productImages)
      .values({
        productId,
        sourceUrl: result.request.sourceUrl,
        sourceContentHash: result.contentHash,
        objectKey: result.objectKey,
        publicUrl: result.publicUrl,
        mimeType: result.mimeType,
        byteSize: result.byteSize,
        ordinal: result.request.ordinal,
        isPrimary: result.request.ordinal === 0,
        alt: result.request.alt,
        status: "active",
        lastError: null,
        mirroredAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [productImages.productId, productImages.sourceUrl],
        set: {
          sourceContentHash: result.contentHash,
          objectKey: result.objectKey,
          publicUrl: result.publicUrl,
          // A skipped image was not downloaded, so the mirror has nothing to
          // say about its type or size. What an earlier run stored stands.
          ...(result.mimeType !== null ? { mimeType: result.mimeType } : {}),
          ...(result.byteSize !== null ? { byteSize: result.byteSize } : {}),
          ordinal: result.request.ordinal,
          isPrimary: result.request.ordinal === 0,
          alt: result.request.alt,
          status: "active",
          lastError: null,
          lastSeenAt: sql`now()`,
          mirroredAt: sql`now()`,
        },
      });
  }

  return { mirrored, skipped, failed };
}
