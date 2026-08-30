import { eq, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { productImages, products, syncRuns } from "@catalog/db/schema";
import { type Logger, silentLogger } from "@catalog/shared";
import type { ScraperConfig } from "../config.ts";
import type { Fetcher } from "../fetch/fetcher.ts";
import { ImageMirror } from "../storage/images.ts";
import type { StorageDriver } from "../storage/driver.ts";
import { type BreakerDecision, evaluateCircuitBreaker, suppressRemovals } from "./circuitBreaker.ts";
import { type DiffResult, diffCatalog } from "./diff.ts";
import { type CatalogDiscoveryResult, discoverCatalog } from "./discover.ts";
import { assignUniqueSlug } from "./identity.ts";
import type { NormalizedProduct } from "./normalize.ts";
import {
  countActiveProducts,
  countAllProducts,
  ensureSourceSite,
  insertSyncChange,
  loadExistingProducts,
  loadLatestBaseline,
  loadProductImages,
  loadTakenProductSlugs,
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
 *
 * Nothing destructive can happen before step 3 has run.
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
  readonly productsBefore: number;
  readonly productsAfter: number;
  readonly images: { mirrored: number; skipped: number; failed: number };
  readonly durationMs: number;
}

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

    const diff = diffCatalog(discovery.products, existing, {
      missingThreshold: config.missingThreshold,
    });

    // 3. Judge --------------------------------------------------------------
    const baseline = await loadLatestBaseline(db, site.id);
    const breaker = evaluateCircuitBreaker(
      {
        discoveredCount: discovery.products.length,
        activeCount: activeBefore,
        baselineDiscoveredCount: baseline?.discoveredProductCount ?? null,
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

    if (!dryRun) {
      const brandMap = await upsertBrands(db, site.id, discovery.brands);
      const categoryMap = await upsertCategories(db, site.id, discovery.categories);
      const existingSlugs = await loadTakenProductSlugs(db, site.id);
      const takenSlugs = new Set(existingSlugs.values());

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

        // Slug is allocated once and then never changed, so storefront URLs
        // and any external links to them stay stable across syncs.
        const slug =
          existingSlugs.get(product.sourceKey) ??
          assignUniqueSlug(product.name, takenSlugs, {
            variantKey: product.sourceVariantKey,
            fallback: product.sourcePath,
          });

        const productId = await upsertProduct(db, {
          sourceSiteId: site.id,
          syncRunId,
          product,
          slug,
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
    }

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
        failedCount: discovery.errors.length + discovery.invalidRecords.length,
        imagesMirrored: images.mirrored,
        imagesSkipped: images.skipped,
        imagesFailed: images.failed,
        circuitBreakerTripped: breaker.tripped,
        circuitBreakerReason: breaker.tripped ? breaker.summary : null,
        circuitBreakerDetail: breaker.detail,
        catalogSource: discovery.source,
        parserConfidence: discovery.confidence.toFixed(3),
      })
      .where(eq(syncRuns.id, syncRunId));

    runLogger.info("sync.completed", {
      status,
      durationMs,
      discovered: discovery.products.length,
      ...appliedDiff.counts,
      images,
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
      productsBefore,
      productsAfter,
      images,
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

async function upsertProduct(
  db: Database,
  input: {
    sourceSiteId: string;
    syncRunId: string;
    product: NormalizedProduct;
    slug: string;
    brandId: string | null;
    isUnchanged: boolean;
  },
): Promise<string> {
  const { product } = input;

  const values = {
    sourceSiteId: input.sourceSiteId,
    sourceKey: product.sourceKey,
    sourceUrl: product.sourceUrl,
    sourcePath: product.sourcePath,
    sourceVariantKey: product.sourceVariantKey,
    hasUrlCollision: product.hasUrlCollision,
    name: product.name,
    slug: input.slug,
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
    sku: product.sku,
    gtin: product.gtin,
    attributes: product.attributes,
    sourceData: {
      ...product.sourceData,
      brandKey: product.brandKey,
      categoryKeys: product.categoryKeys,
      weightCanonical: product.weight?.canonical ?? null,
      imageUrls: product.sourceImageUrls,
      identityStrategy: product.identityStrategy,
    },
    semanticHash: product.semanticHash,
    status: "active" as const,
    consecutiveMissingCount: 0,
    latestSyncRunId: input.syncRunId,
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
          set: { status: "failed", lastError: (result.error ?? "unknown").slice(0, 1000), lastSeenAt: sql`now()` },
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
          mimeType: result.mimeType,
          byteSize: result.byteSize,
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
