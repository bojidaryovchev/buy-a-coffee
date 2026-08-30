import path from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  crawlRuns,
  discoveredPages,
  observedFeatures,
  observedFilters,
  observedForms,
  observedRoutePatterns,
  pageLinks,
  productImages,
  products,
} from "@catalog/db/schema";
import {
  buildFeatureInventory,
  buildFilterInventory,
  buildFormInventory,
  buildRoutePatterns,
  discoverCatalog,
  ensureSourceSite,
  exportReferenceArtifacts,
  recordScrapeError,
  runCatalogSync,
  runDiscoveryCrawl,
  type CatalogDiscoveryResult,
  type DiscoveryCrawlResult,
} from "@catalog/scraper-core";
import type { Runtime } from "./runtime.ts";

/**
 * Command implementations.
 *
 * Each returns a plain result object so the CLI can print it and the Lambda
 * can log it, without either of them owning business logic.
 */

export interface DiscoveryCommandOptions {
  readonly maxPages?: number;
  readonly maxDepth?: number;
  readonly output?: string;
  readonly skipExport?: boolean;
  readonly dryRun?: boolean;
}

export interface DiscoveryCommandResult {
  readonly crawlRunId: string | null;
  readonly crawl: DiscoveryCrawlResult;
  readonly catalog: CatalogDiscoveryResult;
  readonly artifactDir: string | null;
}

/**
 * Full public-surface discovery.
 *
 * The catalog is discovered *first* so its slugs can be fed to the page
 * classifier: knowing that `/lavazza/` is a brand and `/lavazza-super-crema/`
 * is a product turns guesswork into fact on a site whose URLs are flat.
 */
export async function commandDiscovery(
  runtime: Runtime,
  options: DiscoveryCommandOptions = {},
): Promise<DiscoveryCommandResult> {
  const { config, db, fetcher, logger } = runtime;

  const site = await ensureSourceSite(db, {
    key: config.sourceKey,
    name: config.sourceName,
    baseUrl: config.baseUrl,
    canonicalHost: config.canonicalHost,
  });

  const [run] = await db
    .insert(crawlRuns)
    .values({
      sourceSiteId: site.id,
      type: "discovery",
      status: "running",
      metadata: {
        maxPages: options.maxPages ?? config.maxPages,
        maxDepth: options.maxDepth ?? config.maxDepth,
        userAgent: config.userAgent,
      },
    })
    .returning({ id: crawlRuns.id });
  if (!run) throw new Error("Failed to create crawl run");
  const crawlRunId = run.id;
  const runLogger = logger.child({ crawlRunId });

  try {
    await fetcher.calibrateSoft404();

    const catalog = await discoverCatalog({ config, fetcher, logger: runLogger });

    const crawl = await runDiscoveryCrawl({
      config,
      fetcher,
      logger: runLogger,
      ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
      ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
      catalogHints: {
        productPaths: new Set(catalog.products.map((product) => product.sourcePath)),
        categorySlugs: new Set(
          catalog.categories.filter((c) => c.parentKey === null).map((c) => c.sourceKey),
        ),
        subcategorySlugs: new Set(
          catalog.categories.filter((c) => c.parentKey !== null).map((c) => c.sourceKey),
        ),
        brandSlugs: new Set(catalog.brands.map((brand) => brand.sourceKey)),
      },
    });

    if (!options.dryRun) {
      await persistCrawl(runtime, site.id, crawlRunId, crawl, catalog);
    }

    await db
      .update(crawlRuns)
      .set({
        status: crawl.errors.length > 0 ? "partial" : "succeeded",
        completedAt: sql`now()`,
        durationMs: crawl.stats.durationMs,
        pagesAttempted: crawl.stats.attempted,
        pagesSucceeded: crawl.stats.succeeded,
        pagesFailed: crawl.stats.failed,
        pagesSoft404: crawl.stats.soft404,
        metadata: {
          maxPages: options.maxPages ?? config.maxPages,
          maxDepth: options.maxDepth ?? config.maxDepth,
          catalogSource: catalog.source,
          parserConfidence: catalog.confidence,
        },
      })
      .where(eq(crawlRuns.id, crawlRunId));

    let artifactDir: string | null = null;
    if (!options.skipExport) {
      const outputDir = options.output ?? path.join(config.referenceDir, "latest");
      const exported = await exportReferenceArtifacts({
        config,
        crawl,
        catalog,
        outputDir,
        crawlRunId,
        logger: runLogger,
      });
      artifactDir = exported.outputDir;
    }

    return { crawlRunId, crawl, catalog, artifactDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(crawlRuns)
      .set({ status: "failed", completedAt: sql`now()`, errorSummary: message.slice(0, 4000) })
      .where(eq(crawlRuns.id, crawlRunId));
    throw error;
  }
}

async function persistCrawl(
  runtime: Runtime,
  sourceSiteId: string,
  crawlRunId: string,
  crawl: DiscoveryCrawlResult,
  catalog: CatalogDiscoveryResult,
): Promise<void> {
  const { db } = runtime;
  const pageIdByUrl = new Map<string, string>();

  for (const page of crawl.pages) {
    const [row] = await db
      .insert(discoveredPages)
      .values({
        sourceSiteId,
        canonicalUrl: page.canonicalUrl,
        discoveredUrl: page.discoveredUrl,
        finalUrl: page.finalUrl,
        path: page.path,
        statusCode: page.statusCode,
        contentType: page.contentType,
        isSoft404: page.isSoft404,
        title: page.title,
        metaDescription: page.metaDescription,
        canonicalTag: page.canonicalTag,
        robotsMeta: page.robotsMeta,
        pageType: page.classification.pageType,
        pageTypeConfidence: page.classification.confidence,
        pageTypeEvidence: page.classification.evidence,
        headings: page.headings,
        forms: page.forms,
        structuredData: page.structuredData,
        externalLinks: page.externalLinks,
        signals: page.signals,
        contentHash: page.contentHash,
        byteSize: page.byteSize,
        latestCrawlRunId: crawlRunId,
      })
      .onConflictDoUpdate({
        target: [discoveredPages.sourceSiteId, discoveredPages.canonicalUrl],
        set: {
          finalUrl: page.finalUrl,
          statusCode: page.statusCode,
          contentType: page.contentType,
          isSoft404: page.isSoft404,
          title: page.title,
          metaDescription: page.metaDescription,
          canonicalTag: page.canonicalTag,
          robotsMeta: page.robotsMeta,
          pageType: page.classification.pageType,
          pageTypeConfidence: page.classification.confidence,
          pageTypeEvidence: page.classification.evidence,
          headings: page.headings,
          forms: page.forms,
          structuredData: page.structuredData,
          externalLinks: page.externalLinks,
          signals: page.signals,
          contentHash: page.contentHash,
          byteSize: page.byteSize,
          latestCrawlRunId: crawlRunId,
          lastSeenAt: sql`now()`,
          // Only move `lastChangedAt` when the normalised content really moved.
          lastChangedAt: sql`case when ${discoveredPages.contentHash} is distinct from ${page.contentHash} then now() else ${discoveredPages.lastChangedAt} end`,
        },
      })
      .returning({ id: discoveredPages.id });
    if (row) pageIdByUrl.set(page.canonicalUrl, row.id);
  }

  for (const link of crawl.links) {
    const fromId = pageIdByUrl.get(link.fromCanonicalUrl);
    if (!fromId) continue;
    await db
      .insert(pageLinks)
      .values({
        crawlRunId,
        fromPageId: fromId,
        toCanonicalUrl: link.toCanonicalUrl,
        toPageId: pageIdByUrl.get(link.toCanonicalUrl) ?? null,
        anchorText: link.anchorText,
        rel: link.rel,
        ordinal: link.ordinal,
      })
      .onConflictDoNothing();
  }

  for (const error of crawl.errors) {
    await recordScrapeError(db, {
      sourceSiteId,
      crawlRunId,
      url: error.url,
      stage: error.stage,
      errorClass: error.errorClass,
      errorMessage: error.message,
      statusCode: error.statusCode,
    });
  }

  // Observation tables mirror the artifacts, so `reference:export` can rebuild
  // the handoff directory from the database without re-crawling.
  for (const feature of buildFeatureInventory(crawl, catalog)) {
    await db
      .insert(observedFeatures)
      .values({
        sourceSiteId,
        crawlRunId,
        featureKey: feature.id,
        name: feature.name,
        description: feature.description,
        evidenceUrls: feature.evidenceUrls,
        pageTypes: feature.pageTypes,
        inputs: feature.inputs ?? [],
        outputs: feature.outputs ?? [],
        implementationNotes: feature.implementationNotes ?? [],
      })
      .onConflictDoUpdate({
        target: [observedFeatures.sourceSiteId, observedFeatures.featureKey],
        set: {
          name: feature.name,
          description: feature.description,
          evidenceUrls: feature.evidenceUrls,
          pageTypes: feature.pageTypes,
          inputs: feature.inputs ?? [],
          outputs: feature.outputs ?? [],
          implementationNotes: feature.implementationNotes ?? [],
          crawlRunId,
          lastSeenAt: sql`now()`,
        },
      });
  }

  for (const filter of buildFilterInventory(crawl, catalog)) {
    await db
      .insert(observedFilters)
      .values({
        sourceSiteId,
        crawlRunId,
        filterKey: filter.id,
        name: filter.name,
        urlParam: filter.urlParam,
        multiValue: filter.multiValue,
        values: filter.values,
        pageUrls: filter.pageUrls,
        appliesToPageTypes: filter.appliesToPageTypes,
        notes: filter.notes,
      })
      .onConflictDoUpdate({
        target: [observedFilters.sourceSiteId, observedFilters.filterKey],
        set: {
          name: filter.name,
          urlParam: filter.urlParam,
          multiValue: filter.multiValue,
          values: filter.values,
          pageUrls: filter.pageUrls,
          appliesToPageTypes: filter.appliesToPageTypes,
          notes: filter.notes,
          crawlRunId,
          lastSeenAt: sql`now()`,
        },
      });
  }

  for (const form of buildFormInventory(crawl)) {
    await db
      .insert(observedForms)
      .values({
        sourceSiteId,
        crawlRunId,
        formKey: form.id,
        name: form.name,
        purpose: form.purpose,
        pageUrls: form.pageUrls,
        action: form.action,
        method: form.method,
        externalEndpoint: form.externalEndpoint,
        fields: form.fields,
        submitted: false,
        sideEffectWarning: form.sideEffectWarning,
      })
      .onConflictDoUpdate({
        target: [observedForms.sourceSiteId, observedForms.formKey],
        set: {
          name: form.name,
          purpose: form.purpose,
          pageUrls: form.pageUrls,
          action: form.action,
          method: form.method,
          externalEndpoint: form.externalEndpoint,
          fields: form.fields,
          sideEffectWarning: form.sideEffectWarning,
          crawlRunId,
          lastSeenAt: sql`now()`,
        },
      });
  }

  for (const pattern of buildRoutePatterns(crawl)) {
    await db
      .insert(observedRoutePatterns)
      .values({
        sourceSiteId,
        crawlRunId,
        pattern: pattern.pattern,
        pageType: pattern.pageType,
        exampleUrls: pattern.exampleUrls,
        matchCount: pattern.matchCount,
        notes: pattern.notes,
      })
      .onConflictDoUpdate({
        target: [
          observedRoutePatterns.sourceSiteId,
          observedRoutePatterns.pattern,
          observedRoutePatterns.pageType,
        ],
        set: {
          exampleUrls: pattern.exampleUrls,
          matchCount: pattern.matchCount,
          notes: pattern.notes,
          crawlRunId,
          lastSeenAt: sql`now()`,
        },
      });
  }
}

export interface SyncCommandOptions {
  readonly dryRun?: boolean;
  readonly skipImages?: boolean;
  readonly productLimit?: number;
}

export async function commandSync(runtime: Runtime, options: SyncCommandOptions = {}) {
  return runCatalogSync({
    config: runtime.config,
    db: runtime.db,
    fetcher: runtime.fetcher,
    storage: runtime.storage,
    logger: runtime.logger,
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    ...(options.skipImages !== undefined ? { skipImages: options.skipImages } : {}),
    ...(options.productLimit !== undefined ? { productLimit: options.productLimit } : {}),
  });
}

/**
 * Re-export the reference artifacts from current state.
 *
 * Runs a fresh catalog read plus a bounded crawl rather than reconstructing
 * from the database, so the exported contract always reflects a real,
 * verifiable observation rather than a possibly-stale table.
 */
export async function commandReferenceExport(
  runtime: Runtime,
  options: { output?: string; maxPages?: number } = {},
): Promise<{ artifactDir: string; counts: Record<string, number> }> {
  const result = await commandDiscovery(runtime, {
    ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
    ...(options.output !== undefined ? { output: options.output } : {}),
  });
  return {
    artifactDir: result.artifactDir ?? "",
    counts: {
      pages: result.crawl.pages.length,
      products: result.catalog.products.length,
      categories: result.catalog.categories.length,
      brands: result.catalog.brands.length,
    },
  };
}

/**
 * Report mirrored image objects that no product references any more.
 *
 * Deletion is opt-in: content-addressed objects are cheap, and an accidental
 * purge is expensive, so the default is to list what *would* go.
 */
export async function commandImagesGc(
  runtime: Runtime,
  options: { apply?: boolean } = {},
): Promise<{ orphaned: string[]; deleted: number }> {
  const { db, storage, logger } = runtime;

  const rows = await db
    .select({ objectKey: productImages.objectKey, status: productImages.status })
    .from(productImages);

  const referenced = new Set(
    rows.filter((row) => row.status === "active" && row.objectKey).map((row) => row.objectKey as string),
  );
  const orphanRows = await db
    .select({ objectKey: productImages.objectKey })
    .from(productImages)
    .where(eq(productImages.status, "orphaned"));

  const orphaned = [
    ...new Set(
      orphanRows
        .map((row) => row.objectKey)
        .filter((key): key is string => typeof key === "string" && !referenced.has(key)),
    ),
  ].sort();

  let deleted = 0;
  if (options.apply) {
    for (const key of orphaned) {
      await storage.delete(key);
      deleted += 1;
    }
    logger.info("images.gc_applied", { deleted });
  } else {
    logger.info("images.gc_dry_run", { orphaned: orphaned.length });
  }

  return { orphaned, deleted };
}

/** Compact catalog summary used by the CLI's `status` command. */
export async function commandStatus(runtime: Runtime): Promise<Record<string, unknown>> {
  const { db } = runtime;
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${products.status} = 'active')::int`,
      missing: sql<number>`count(*) filter (where ${products.status} = 'missing')::int`,
      removed: sql<number>`count(*) filter (where ${products.status} = 'removed')::int`,
      withoutPrice: sql<number>`count(*) filter (where ${products.currentPrice} is null)::int`,
      onPromotion: sql<number>`count(*) filter (where ${products.oldPrice} is not null)::int`,
    })
    .from(products);
  return counts ?? {};
}
