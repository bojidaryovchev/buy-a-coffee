import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@catalog/db";
import {
  brands,
  categories,
  productCategories,
  productImages,
  products,
  scrapeErrors,
  syncChanges,
  syncRuns,
} from "@catalog/db/schema";
import {
  packServings,
  parseWeight,
  pricePerServing,
  semanticHash,
  silentLogger,
} from "@catalog/shared";
import { loadConfig } from "../src/config.ts";
import { Fetcher } from "../src/fetch/fetcher.ts";
import {
  applyProductLink,
  formatLinkPlan,
  parsePathSourceKey,
  planProductLink,
} from "../src/catalog/link.ts";
import { runCatalogEnrich } from "../src/catalog/enrich.ts";
import { type NormalizedProduct, buildSemanticFields } from "../src/catalog/normalize.ts";
import { runCatalogSync } from "../src/catalog/sync.ts";
import { formatCatalogVerifyReport, verifyCatalog } from "../src/catalog/verify.ts";
import { LocalStorageDriver } from "../src/storage/driver.ts";
import {
  type FakeProduct,
  type FakeSiteOptions,
  baseCatalog,
  createFakeFetch,
} from "./helpers/fakeSource.ts";
import { isDatabaseAvailable, resetTestDatabase, setupTestDatabase } from "./helpers/testDb.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * End-to-end synchronisation behaviour against a real PostgreSQL database.
 *
 * Only the network is faked. The diff engine, circuit breaker, repository and
 * image mirror all run their production code paths.
 */

const available = await isDatabaseAvailable();
const describeIntegration = available ? describe : describe.skip;

if (!available) {
  console.warn(
    "\n[integration] PostgreSQL is not reachable; skipping. Run `docker compose up -d` to enable these tests.\n",
  );
}

describeIntegration("catalog sync (integration)", () => {
  let db: Database;
  let closeDb: () => Promise<void>;
  let storageDir: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    closeDb = setup.close;
    storageDir = await mkdtemp(path.join(tmpdir(), "catalog-storage-"));
  }, 120_000);

  afterAll(async () => {
    await closeDb?.();
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTestDatabase(db);
  });

  interface WorldOptions {
    missingThreshold?: number;
    searchStatus?: number;
    listingProducts?: readonly FakeProduct[];
    breakerRatio?: number;
    minAbsolute?: number;
    /** The brands and categories the fake source publishes. */
    site?: Pick<FakeSiteOptions, "brands" | "categories">;
    /**
     * Product pages a sync may read. Off unless a test asks: most tests here
     * are about the listing, and must not depend on what product pages say.
     */
    enrichMax?: number;
    lookupMax?: number;
    productPages?: FakeSiteOptions["productPages"];
  }

  /** Paths requested by the most recent `sync()`. */
  let lastRequests: string[] = [];

  /** A fake source, and the config and fetcher pointed at it. */
  function world(catalog: readonly FakeProduct[], options: WorldOptions = {}) {
    const config = loadConfig(
      {
        baseUrl: "https://fake.test/",
        canonicalHost: "fake.test",
        hostAliases: [],
        minDelayMs: 0,
        imageMinDelayMs: 0,
        maxRetries: 0,
        respectRobotsTxt: false,
        missingThreshold: options.missingThreshold ?? 3,
        breakerMaxDisappearedRatio: options.breakerRatio ?? 0.2,
        breakerMinAbsoluteProducts: options.minAbsolute ?? 5,
        enrichMaxPerRun: options.enrichMax ?? 0,
        enrichLookupMax: options.lookupMax ?? 10,
        storageDriver: "local",
        storageLocalDir: storageDir,
      },
      {},
    );

    const { fetchImpl, requests } = createFakeFetch({
      products: catalog,
      ...options.site,
      ...(options.searchStatus !== undefined ? { searchStatus: options.searchStatus } : {}),
      ...(options.listingProducts !== undefined
        ? { listingProducts: options.listingProducts }
        : {}),
      ...(options.productPages !== undefined ? { productPages: options.productPages } : {}),
    });

    return { config, requests, fetcher: new Fetcher({ config, fetchImpl, logger: silentLogger }) };
  }

  /** Run one sync against a synthetic catalog. */
  async function sync(
    catalog: readonly FakeProduct[],
    options: WorldOptions & { dryRun?: boolean; skipImages?: boolean } = {},
  ) {
    const { config, fetcher, requests } = world(catalog, options);
    lastRequests = requests;

    return runCatalogSync({
      config,
      db,
      fetcher,
      storage: new LocalStorageDriver(storageDir),
      logger: silentLogger,
      dryRun: options.dryRun ?? false,
      skipImages: options.skipImages ?? true,
    });
  }

  const countProducts = async (status?: "active" | "missing" | "removed") => {
    const rows = await db.select({ id: products.id, status: products.status }).from(products);
    return status ? rows.filter((row) => row.status === status).length : rows.length;
  };

  it("creates every product on the first sync", async () => {
    const result = await sync(baseCatalog());
    expect(result.appliedDiff.counts.created).toBe(12);
    expect(await countProducts()).toBe(12);
    expect(await countProducts("active")).toBe(12);
  });

  it("is idempotent: a second identical sync produces zero updates", async () => {
    await sync(baseCatalog());
    const second = await sync(baseCatalog());
    expect(second.appliedDiff.counts).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 12,
      removed: 0,
      marked_missing: 0,
    });
    expect(await countProducts()).toBe(12);
  });

  it("records a price change as exactly one audited update", async () => {
    await sync(baseCatalog());

    const changed = baseCatalog().map((product, index) =>
      index === 0 ? { ...product, price: "€99.99" } : product,
    );
    const result = await sync(changed);

    expect(result.appliedDiff.counts.updated).toBe(1);
    expect(result.appliedDiff.counts.unchanged).toBe(11);

    const audit = await db.select().from(syncChanges).where(eq(syncChanges.changeType, "updated"));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.changedFields).toContain("currentPrice");
    expect(audit[0]?.before).toMatchObject({ currentPrice: "10.00" });
    expect(audit[0]?.after).toMatchObject({ currentPrice: "99.99" });

    const [row] = await db
      .select({ price: products.currentPrice })
      .from(products)
      .where(eq(products.sourceKey, "/coffee-1/#1000g"));
    expect(row?.price).toBe("99.99");
  });

  it("adds a new product without touching the others", async () => {
    await sync(baseCatalog());
    const withNew = [
      ...baseCatalog(),
      { h1: "Brand new coffee 1кг.", url: "/coffee-new/", price: "€44.00", weight: "1 кг." },
    ];
    const result = await sync(withNew);
    expect(result.appliedDiff.counts.created).toBe(1);
    expect(result.appliedDiff.counts.unchanged).toBe(12);
    expect(await countProducts()).toBe(13);
  });

  it("does not remove a product after a single absence", async () => {
    await sync(baseCatalog());
    const withoutOne = baseCatalog().slice(0, 11);
    const result = await sync(withoutOne);

    expect(result.appliedDiff.counts.marked_missing).toBe(1);
    expect(result.appliedDiff.counts.removed).toBe(0);
    expect(await countProducts("missing")).toBe(1);
    expect(await countProducts("removed")).toBe(0);
    // The row itself must still exist, with its data intact.
    expect(await countProducts()).toBe(12);
  });

  it("removes a product only after the configured number of absences", async () => {
    await sync(baseCatalog());
    const withoutOne = baseCatalog().slice(0, 11);

    await sync(withoutOne); // 1
    expect(await countProducts("removed")).toBe(0);
    await sync(withoutOne); // 2
    expect(await countProducts("removed")).toBe(0);
    const third = await sync(withoutOne); // 3 -> threshold reached

    expect(third.appliedDiff.counts.removed).toBe(1);
    expect(await countProducts("removed")).toBe(1);
    expect(await countProducts("active")).toBe(11);
  });

  it("honours a lower removal threshold", async () => {
    await sync(baseCatalog(), { missingThreshold: 1 });
    const result = await sync(baseCatalog().slice(0, 11), { missingThreshold: 1 });
    expect(result.appliedDiff.counts.removed).toBe(1);
  });

  it("restores a product that reappears, resetting its counter", async () => {
    await sync(baseCatalog());
    await sync(baseCatalog().slice(0, 11));
    expect(await countProducts("missing")).toBe(1);

    const restored = await sync(baseCatalog());
    expect(restored.appliedDiff.counts.restored).toBe(1);
    expect(await countProducts("active")).toBe(12);
    expect(await countProducts("missing")).toBe(0);

    const [row] = await db
      .select({ count: products.consecutiveMissingCount })
      .from(products)
      .where(eq(products.sourceKey, "/coffee-12/#1000g"));
    expect(row?.count).toBe(0);
  });

  it("restores a product that had already been removed", async () => {
    await sync(baseCatalog(), { missingThreshold: 1 });
    await sync(baseCatalog().slice(0, 11), { missingThreshold: 1 });
    expect(await countProducts("removed")).toBe(1);

    const restored = await sync(baseCatalog(), { missingThreshold: 1 });
    expect(restored.appliedDiff.counts.restored).toBe(1);
    expect(await countProducts("active")).toBe(12);
    expect(await countProducts("removed")).toBe(0);
  });

  it("opens the circuit breaker on a mass disappearance and preserves the catalog", async () => {
    await sync(baseCatalog());
    expect(await countProducts("active")).toBe(12);

    // Only two of twelve products come back.
    const result = await sync(baseCatalog().slice(0, 2));

    expect(result.breaker.tripped).toBe(true);
    expect(result.breaker.reasons).toContain("mass_disappearance");
    // Nothing was marked missing or removed.
    expect(result.appliedDiff.counts.marked_missing).toBe(0);
    expect(result.appliedDiff.counts.removed).toBe(0);
    expect(await countProducts("active")).toBe(12);
    expect(await countProducts("missing")).toBe(0);

    const [run] = await db
      .select({
        tripped: syncRuns.circuitBreakerTripped,
        reason: syncRuns.circuitBreakerReason,
        status: syncRuns.status,
      })
      .from(syncRuns)
      .where(eq(syncRuns.circuitBreakerTripped, true));
    expect(run?.tripped).toBe(true);
    expect(run?.status).toBe("partial");
    expect(run?.reason).toContain("circuit breaker open");
  });

  it("still applies additive changes while the breaker is open", async () => {
    await sync(baseCatalog());
    // Two survivors plus one genuinely new product.
    const result = await sync([
      ...baseCatalog().slice(0, 2),
      { h1: "New arrival 1кг.", url: "/coffee-new/", price: "€50.00", weight: "1 кг." },
    ]);

    expect(result.breaker.tripped).toBe(true);
    expect(result.appliedDiff.counts.created).toBe(1);
    expect(result.appliedDiff.counts.removed).toBe(0);
    // 12 originals preserved plus the new one.
    expect(await countProducts()).toBe(13);
  });

  it("does not record a baseline from a run the breaker refused", async () => {
    await sync(baseCatalog());
    await sync(baseCatalog().slice(0, 2)); // tripped

    // A later healthy-looking small catalog must still be judged against the
    // original baseline of 12, not against the bad run.
    const result = await sync(baseCatalog().slice(0, 3));
    expect(result.breaker.tripped).toBe(true);
    expect(await countProducts("active")).toBe(12);
  });

  it("opens the breaker when discovery returns nothing at all", async () => {
    await sync(baseCatalog());
    const result = await sync([], { searchStatus: 503 });
    expect(result.breaker.tripped).toBe(true);
    expect(result.breaker.reasons).toContain("empty_discovery");
    expect(await countProducts("active")).toBe(12);
  });

  it("falls back to HTML listings when the structured blob is unavailable", async () => {
    const catalog = baseCatalog().slice(0, 6);
    const result = await sync([], { searchStatus: 500, listingProducts: catalog });

    expect(result.discovery.source).toBe("listing_html");
    // The HTML path recovers less, so confidence is capped below 1.
    expect(result.discovery.confidence).toBeLessThan(1);
    expect(result.discovery.confidence).toBeGreaterThan(0);
    expect(result.appliedDiff.counts.created).toBe(6);
  });

  it("keeps two products that share a URL but differ in pack size", async () => {
    const result = await sync([
      {
        h1: "Borbone Crema Classica 0.500кг.",
        url: "/borbone/",
        price: "€10.70",
        weight: "0.500кг.",
      },
      { h1: "Borbone Crema Classica 1кг.", url: "/borbone/", price: "€20.50", weight: "1 кг." },
    ]);

    expect(result.appliedDiff.counts.created).toBe(2);
    const rows = await db
      .select({
        sourceKey: products.sourceKey,
        price: products.currentPrice,
        collision: products.hasUrlCollision,
      })
      .from(products);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.collision)).toBe(true);
    expect(rows.map((row) => row.price).sort()).toEqual(["10.70", "20.50"]);
  });

  it("collapses a duplicated record that is genuinely the same product", async () => {
    const duplicate = {
      h1: "Eurocaf Piacere d'Oro 1кг.",
      url: "/eurocaf/",
      price: "€14.85",
      weight: "1 кг.",
    };
    const result = await sync([duplicate, { ...duplicate }]);
    expect(result.discovery.rawRecordCount).toBe(2);
    expect(result.appliedDiff.counts.created).toBe(1);
    expect(await countProducts()).toBe(1);
  });

  it("stores a missing price as null rather than zero", async () => {
    await sync([{ h1: "Priceless 1кг.", url: "/priceless/", price: "", weight: "1 кг." }]);
    const [row] = await db.select({ price: products.currentPrice }).from(products);
    expect(row?.price).toBeNull();
  });

  it("writes nothing during a dry run", async () => {
    const result = await sync(baseCatalog(), { dryRun: true });
    expect(result.appliedDiff.counts.created).toBe(12);
    expect(result.dryRun).toBe(true);
    expect(await countProducts()).toBe(0);

    const [run] = await db.select({ dryRun: syncRuns.dryRun }).from(syncRuns);
    expect(run?.dryRun).toBe(true);
  });

  it("mirrors images once and skips them on the next run", async () => {
    const catalog = baseCatalog().slice(0, 3);
    const first = await sync(catalog, { skipImages: false });
    expect(first.images.mirrored).toBe(3);
    expect(first.images.failed).toBe(0);

    const second = await sync(catalog, { skipImages: false });
    expect(second.images.mirrored).toBe(0);
    expect(second.images.skipped).toBe(3);
  });

  it("never lets an unchanged run move lastChangedAt", async () => {
    await sync(baseCatalog());
    const [before] = await db
      .select({ changed: products.lastChangedAt, seen: products.lastSeenAt })
      .from(products)
      .where(eq(products.sourceKey, "/coffee-1/#1000g"));

    await new Promise((resolve) => setTimeout(resolve, 25));
    await sync(baseCatalog());

    const [after] = await db
      .select({ changed: products.lastChangedAt, seen: products.lastSeenAt })
      .from(products)
      .where(eq(products.sourceKey, "/coffee-1/#1000g"));

    expect(after?.changed?.getTime()).toBe(before?.changed?.getTime());
    // ...but the product was still seen.
    expect(after?.seen?.getTime()).toBeGreaterThanOrEqual(before?.seen?.getTime() ?? 0);
  });

  it("keeps a product's slug stable when its name changes", async () => {
    await sync([{ h1: "Original name 1кг.", url: "/stable/", price: "€10.00", weight: "1 кг." }]);
    const [before] = await db.select({ slug: products.slug }).from(products);

    await sync([
      { h1: "Completely different name 1кг.", url: "/stable/", price: "€10.00", weight: "1 кг." },
    ]);
    const [after] = await db.select({ slug: products.slug, name: products.name }).from(products);

    // Slugs are storefront URLs: renaming a product must not break links.
    expect(after?.slug).toBe(before?.slug);
    expect(after?.name).toBe("Completely different name 1кг.");
  });

  it("links products to brands and categories", async () => {
    await sync(baseCatalog());
    const rows = await db
      .select({ id: products.id, brandId: products.brandId })
      .from(products)
      .where(and(eq(products.status, "active")));
    expect(rows.every((row) => row.brandId !== null)).toBe(true);
  });

  // --- Renamed product URLs --------------------------------------------------

  /** The source's own habit: append to the path, leave everything else alone. */
  const renamed = (catalog: readonly FakeProduct[]): FakeProduct[] =>
    catalog.map((product) => ({ ...product, url: product.url.replace(/\/$/, "-1/") }));

  /** Explicit image URLs, so that a renamed path keeps its photo. */
  const withPhotos = (): FakeProduct[] =>
    baseCatalog().map((product, index) => ({
      ...product,
      imageUrl: `/img/product-img-${index + 1}.jpg-800w.jpg`,
    }));

  const productRows = async () =>
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        status: products.status,
        sourceKey: products.sourceKey,
        sourcePath: products.sourcePath,
        sourceUrl: products.sourceUrl,
        sourceVariantKey: products.sourceVariantKey,
        previousSourceKeys: products.previousSourceKeys,
        textOverride: products.descriptionTextOverride,
        htmlOverride: products.descriptionHtmlOverride,
        retailOverride: products.retailPriceOverride,
        price: products.currentPrice,
        brandId: products.brandId,
      })
      .from(products)
      .orderBy(products.name);

  const latestRun = async () => {
    const [run] = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1);
    return run;
  };

  it("re-points renamed products, keeping id, slug, overrides and images", async () => {
    await sync(withPhotos(), { skipImages: false });
    await db.update(products).set({
      descriptionTextOverride: "Our own summary.",
      descriptionHtmlOverride: "<p>Our own body copy.</p>",
      retailPriceOverride: "12.34",
    });
    const before = await productRows();
    const imagesBefore = await db.select().from(productImages).orderBy(productImages.sourceUrl);
    expect(imagesBefore).toHaveLength(12);

    // Every product URL changes at once.
    const result = await sync(renamed(withPhotos()), { skipImages: false });

    expect(result.appliedDiff.counts).toMatchObject({
      moved: 12,
      created: 0,
      updated: 0,
      marked_missing: 0,
      removed: 0,
    });
    expect(result.diff.unresolvedMoves).toEqual([]);
    expect(await countProducts()).toBe(12);
    expect(await countProducts("active")).toBe(12);

    const after = await productRows();
    for (const [index, row] of after.entries()) {
      const was = before[index];
      expect(row.id).toBe(was?.id);
      expect(row.slug).toBe(was?.slug);
      expect(row.textOverride).toBe("Our own summary.");
      expect(row.htmlOverride).toBe("<p>Our own body copy.</p>");
      expect(row.retailOverride).toBe("12.34");
      expect(row.sourceKey).toBe(was?.sourceKey.replace("/#", "-1/#"));
      expect(row.sourcePath).toBe(was?.sourcePath.replace(/\/$/, "-1/"));
      expect(row.sourceUrl).toBe(`https://fake.test${row.sourcePath}`);
      expect(row.sourceVariantKey).toBe("1000g");
      expect(row.previousSourceKeys).toEqual([was?.sourceKey]);
    }

    // The mirrored images are the same rows, on the same products, untouched.
    const imagesAfter = await db.select().from(productImages).orderBy(productImages.sourceUrl);
    expect(imagesAfter.map((image) => [image.id, image.productId, image.objectKey])).toEqual(
      imagesBefore.map((image) => [image.id, image.productId, image.objectKey]),
    );
    expect(result.images).toMatchObject({ mirrored: 0, failed: 0 });
  });

  it("does not trip the breaker on a mass rename", async () => {
    await sync(baseCatalog());
    const result = await sync(renamed(baseCatalog()));

    // All twelve keys vanished. Judged before pairing, that is a 100% removal.
    expect(result.breaker.tripped).toBe(false);
    expect(result.breaker.detail.disappearingCount).toBe(0);
    expect(result.status).toBe("succeeded");

    const run = await latestRun();
    expect(run?.circuitBreakerTripped).toBe(false);
    expect(run?.movedCount).toBe(12);
    expect(run?.createdCount).toBe(0);
    expect(run?.missingCount).toBe(0);
    expect(run?.productsBefore).toBe(12);
    expect(run?.productsAfter).toBe(12);
  });

  it("audits each move with the key it left and the key it took", async () => {
    await sync(withPhotos());
    await sync(renamed(withPhotos()));

    const audit = await db.select().from(syncChanges).where(eq(syncChanges.changeType, "moved"));
    expect(audit).toHaveLength(12);
    const first = audit.find((change) => change.sourceKey === "/coffee-1-1/#1000g");
    expect(first?.changedFields).toEqual(["sourceKey"]);
    expect(first?.before).toMatchObject({ sourceKey: "/coffee-1/#1000g" });
    expect(first?.after).toMatchObject({
      sourceKey: "/coffee-1-1/#1000g",
      move: { matchedBy: "fingerprint", decidedBy: null },
      preserved: { slug: "test-brand-coffee-number-1-1-kg", descriptionTextOverride: false },
    });
    const [row] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.sourceKey, "/coffee-1-1/#1000g"));
    expect(first?.productId).toBe(row?.id);
  });

  it("is a no-op on the sync after a move", async () => {
    await sync(baseCatalog());
    await sync(renamed(baseCatalog()));
    const settled = await productRows();

    const again = await sync(renamed(baseCatalog()));

    expect(again.appliedDiff.counts).toMatchObject({
      moved: 0,
      created: 0,
      updated: 0,
      unchanged: 12,
      marked_missing: 0,
    });
    expect(await productRows()).toEqual(settled);
    expect((await latestRun())?.movedCount).toBe(0);
    const audit = await db.select().from(syncChanges).where(eq(syncChanges.changeType, "moved"));
    expect(audit).toHaveLength(12);
  });

  it("applies a price change that arrives together with a rename", async () => {
    await sync(withPhotos());
    const [before] = await db
      .select({ id: products.id, slug: products.slug, changed: products.lastChangedAt })
      .from(products)
      .where(eq(products.sourceKey, "/coffee-1/#1000g"));

    const result = await sync(
      renamed(withPhotos()).map((product, index) =>
        index === 0 ? { ...product, price: "€99.99" } : product,
      ),
    );
    expect(result.appliedDiff.counts).toMatchObject({ moved: 12, updated: 0, created: 0 });

    const [after] = await db
      .select({
        id: products.id,
        slug: products.slug,
        price: products.currentPrice,
        changed: products.lastChangedAt,
      })
      .from(products)
      .where(eq(products.sourceKey, "/coffee-1-1/#1000g"));
    expect(after?.id).toBe(before?.id);
    expect(after?.slug).toBe(before?.slug);
    expect(after?.price).toBe("99.99");
    expect(after?.changed?.getTime()).toBeGreaterThan(before?.changed?.getTime() ?? 0);

    const [audit] = await db
      .select()
      .from(syncChanges)
      .where(eq(syncChanges.sourceKey, "/coffee-1-1/#1000g"));
    expect(audit?.changeType).toBe("moved");
    expect(audit?.changedFields).toEqual(["currentPrice", "semanticHash", "sourceKey"]);
    expect(audit?.before).toMatchObject({ currentPrice: "10.00" });
    expect(audit?.after).toMatchObject({ currentPrice: "99.99" });
  });

  it("does not move lastChangedAt for a bare rename", async () => {
    await sync(withPhotos());
    const changedAt = async () =>
      (await db.select({ id: products.id, changed: products.lastChangedAt }).from(products))
        .map((row) => `${row.id} ${row.changed?.getTime()}`)
        .sort();
    const before = await changedAt();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await sync(renamed(withPhotos()));
    expect(await changedAt()).toEqual(before);
  });

  it("leaves an unbreakable tie unpaired and records it on the run", async () => {
    const twin = {
      h1: "Twin blend 1кг.",
      price: "€20.00",
      imageUrl: "/img/twin.jpg",
      description: "Same.",
    };
    await sync([...baseCatalog(), { ...twin, url: "/twin-a/" }, { ...twin, url: "/twin-b/" }]);

    const result = await sync([
      ...baseCatalog(),
      { ...twin, url: "/elsewhere-x/" },
      { ...twin, url: "/elsewhere-y/" },
    ]);

    expect(result.appliedDiff.counts).toMatchObject({ moved: 0, created: 2, marked_missing: 2 });
    expect(result.diff.unresolvedMoves).toEqual([
      {
        matchedBy: "fingerprint",
        reason: "tie",
        fingerprint: "testbrand | twin blend 1кг. | 1000g",
        existingKeys: ["/twin-a/#1000g", "/twin-b/#1000g"],
        discoveredKeys: ["/elsewhere-x/#1000g", "/elsewhere-y/#1000g"],
      },
    ]);
    expect((await latestRun())?.metadata.unresolvedMoves).toEqual(result.diff.unresolvedMoves);
  });

  it("reports moves on a dry run without writing them", async () => {
    await sync(baseCatalog());
    const before = await productRows();
    const result = await sync(renamed(baseCatalog()), { dryRun: true });

    expect(result.appliedDiff.counts.moved).toBe(12);
    expect(result.appliedDiff.moved[0]?.movedFrom).toMatchObject({ matchedBy: "fingerprint" });
    expect(await productRows()).toEqual(before);
    expect(before.every((row) => row.previousSourceKeys.length === 0)).toBe(true);
    expect(await db.select().from(syncChanges).where(eq(syncChanges.changeType, "moved"))).toEqual(
      [],
    );
  });

  it("remembers every key once when the source renames back and forth", async () => {
    await sync(baseCatalog());
    await sync(renamed(baseCatalog()));
    await sync(baseCatalog());
    await sync(renamed(baseCatalog()));

    const [row] = await db
      .select({ keys: products.previousSourceKeys })
      .from(products)
      .where(eq(products.sourceKey, "/coffee-1-1/#1000g"));
    expect(row?.keys).toEqual(["/coffee-1/#1000g", "/coffee-1-1/#1000g"]);
    expect(await countProducts()).toBe(12);
  });

  // --- Image rows --------------------------------------------------------------

  it("keeps the stored type and size of an image it skips", async () => {
    const catalog = baseCatalog().slice(0, 3);
    await sync(catalog, { skipImages: false });
    const first = await db.select().from(productImages);
    expect(
      first.every((image) => image.mimeType === "image/png" && (image.byteSize ?? 0) > 0),
    ).toBe(true);

    const second = await sync(catalog, { skipImages: false });
    expect(second.images.skipped).toBe(3);

    const after = await db.select().from(productImages);
    expect(after.map((image) => [image.mimeType, image.byteSize])).toEqual(
      first.map((image) => [image.mimeType, image.byteSize]),
    );
    expect(after.every((image) => image.status === "active")).toBe(true);
  });

  it("mirrors an image again when its object is missing from the store", async () => {
    const storage = new LocalStorageDriver(storageDir);
    const catalog = baseCatalog().slice(0, 1);
    await sync(catalog, { skipImages: false });
    const [image] = await db.select().from(productImages);
    const objectKey = image?.objectKey as string;
    expect(await storage.exists(objectKey)).toBe(true);

    // A change of image host looks exactly like this: the row says mirrored,
    // the configured store has nothing under that key.
    await storage.delete(objectKey);
    expect(await storage.exists(objectKey)).toBe(false);

    const result = await sync(catalog, { skipImages: false });

    expect(result.images).toEqual({ mirrored: 1, skipped: 0, failed: 0 });
    expect(await storage.exists(objectKey)).toBe(true);
    const [after] = await db.select().from(productImages);
    expect(after).toMatchObject({
      id: image?.id,
      objectKey,
      status: "active",
      mimeType: "image/png",
    });
  });

  // --- Renamed brands and categories ----------------------------------------------

  /** The real ids and slugs, as the source published them in August. */
  const AUGUST = {
    brands: [
      { id: "634", h1: "BIANCAFFE", slug: "biancafe", count: 5 },
      { id: "605", h1: "LAVAZZA", slug: "lavazza", count: 1 },
    ],
    categories: [
      {
        id: "611",
        h1: "Капсули",
        slug: "kapsuli",
        count: 5,
        children: [
          { id: "614", h1: "Nespresso", slug: "nespresso", count: 3 },
          { id: "615", h1: "Dolce Gusto", slug: "dolce-gusto", count: 2 },
        ],
      },
      { id: "608", h1: "Кафе на зърна", slug: "kafe-na-zyrna", count: 1, children: [] },
    ],
  };
  /** ...and in October: the brand respelled, the capsule parent renamed. */
  const OCTOBER = {
    brands: [{ ...AUGUST.brands[0], slug: "biancaffe" }, AUGUST.brands[1]],
    categories: [
      { ...AUGUST.categories[0], h1: "Кафе капсули", slug: "kafe-kapsuli" },
      AUGUST.categories[1],
    ],
  } as typeof AUGUST;

  const taxonomyCatalog = (brandSlug: string): FakeProduct[] => [
    ...["nespresso", "nespresso", "nespresso", "dolce-gusto", "dolce-gusto"].map(
      (categorySlug, index) => ({
        h1: `Capsule ${index + 1} 10 бр.`,
        url: `/capsule-${index + 1}/`,
        weight: "10 бр.",
        brandSlug,
        categorySlug,
      }),
    ),
    { h1: "Beans 1кг.", url: "/beans/", brandSlug: "lavazza", categorySlug: "kafe-na-zyrna" },
  ];

  const taxonomyRows = async () => ({
    brands: await db.select().from(brands).orderBy(brands.sourceId),
    categories: await db.select().from(categories).orderBy(categories.sourceId),
  });

  it("renames the capsule category in place and keeps its children attached", async () => {
    await sync(taxonomyCatalog("biancafe"), { site: AUGUST });
    const before = await taxonomyRows();
    expect(before.categories.map((row) => row.sourceKey)).toEqual([
      "kafe-na-zyrna",
      "kapsuli",
      "nespresso",
      "dolce-gusto",
    ]);
    const parentBefore = before.categories.find((row) => row.sourceId === "611");

    const result = await sync(taxonomyCatalog("biancaffe"), { site: OCTOBER });

    const after = await taxonomyRows();
    expect(after.categories).toHaveLength(4);
    expect(after.categories.every((row) => row.status === "active")).toBe(true);

    const parent = after.categories.find((row) => row.sourceId === "611");
    expect(parent).toMatchObject({
      id: parentBefore?.id,
      slug: parentBefore?.slug,
      sourceKey: "kafe-kapsuli",
      name: "Кафе капсули",
      sourceUrl: "https://fake.test/kafe-kapsuli/",
      previousSourceKeys: ["kapsuli"],
      parentId: null,
    });
    expect(parent?.slug).toBe("kapsuli");

    const children = after.categories.filter((row) => row.parentId === parent?.id);
    expect(children.map((row) => row.sourceKey).sort()).toEqual(["dolce-gusto", "nespresso"]);
    // The children are the rows they were, and so still hold their products.
    expect(children.map((row) => row.id).sort()).toEqual(
      before.categories
        .filter((row) => row.parentId === parentBefore?.id)
        .map((row) => row.id)
        .sort(),
    );
    const links = await db.select().from(productCategories);
    expect(
      links.filter((link) => children.some((child) => child.id === link.categoryId)),
    ).toHaveLength(5);

    expect(result.taxonomy.categories).toEqual({
      created: [],
      renamed: [{ from: "kapsuli", to: "kafe-kapsuli", slug: "kapsuli" }],
      markedMissing: [],
      restored: [],
      conflicts: [],
    });
    expect((await latestRun())?.metadata.taxonomy).toEqual(result.taxonomy);
  });

  it("renames the respelled brand in place and keeps its products on it", async () => {
    await sync(taxonomyCatalog("biancafe"), { site: AUGUST });
    const before = await taxonomyRows();
    const brandBefore = before.brands.find((row) => row.sourceId === "634");
    expect(brandBefore?.sourceKey).toBe("biancafe");

    const result = await sync(taxonomyCatalog("biancaffe"), { site: OCTOBER });

    const after = await taxonomyRows();
    expect(after.brands).toHaveLength(2);
    const brand = after.brands.find((row) => row.sourceId === "634");
    expect(brand).toMatchObject({
      id: brandBefore?.id,
      slug: brandBefore?.slug,
      sourceKey: "biancaffe",
      name: "BIANCAFFE",
      status: "active",
      previousSourceKeys: ["biancafe"],
    });
    expect(result.taxonomy.brands.renamed).toEqual([
      { from: "biancafe", to: "biancaffe", slug: brandBefore?.slug },
    ]);

    const rows = await productRows();
    expect(rows.filter((row) => row.brandId === brand?.id)).toHaveLength(5);
    expect(await countProducts()).toBe(6);

    // And nothing further happens on the next run.
    const again = await sync(taxonomyCatalog("biancaffe"), { site: OCTOBER });
    expect(again.taxonomy.brands.renamed).toEqual([]);
    expect(again.taxonomy.categories.renamed).toEqual([]);
    expect(await taxonomyRows()).toMatchObject({
      brands: [{ previousSourceKeys: [] }, { previousSourceKeys: ["biancafe"] }],
    });
  });

  it("reports a taxonomy rename on a dry run without writing it", async () => {
    await sync(taxonomyCatalog("biancafe"), { site: AUGUST });
    const result = await sync(taxonomyCatalog("biancaffe"), { site: OCTOBER, dryRun: true });

    expect(result.taxonomy.brands.renamed).toHaveLength(1);
    expect(result.taxonomy.categories.renamed).toHaveLength(1);
    const rows = await taxonomyRows();
    expect(rows.brands.map((row) => row.sourceKey).sort()).toEqual(["biancafe", "lavazza"]);
    expect(rows.categories.some((row) => row.sourceKey === "kapsuli")).toBe(true);
  });

  it("hides a brand and a category the source stops listing, and brings them back", async () => {
    await sync(taxonomyCatalog("biancafe"), { site: AUGUST });

    // Lavazza, its one product and its category are gone from a healthy run.
    const withoutLavazza = {
      brands: [AUGUST.brands[0]],
      categories: [AUGUST.categories[0]],
    } as typeof AUGUST;
    const result = await sync(taxonomyCatalog("biancafe").slice(0, 5), { site: withoutLavazza });

    expect(result.breaker.tripped).toBe(false);
    expect(result.taxonomy.brands.markedMissing).toEqual(["lavazza"]);
    expect(result.taxonomy.categories.markedMissing).toEqual(["kafe-na-zarna"]);
    let rows = await taxonomyRows();
    expect(rows.brands.find((row) => row.sourceKey === "lavazza")?.status).toBe("missing");
    expect(rows.categories.find((row) => row.sourceKey === "kafe-na-zyrna")?.status).toBe(
      "missing",
    );
    expect(rows.brands.find((row) => row.sourceKey === "biancafe")?.status).toBe("active");

    const back = await sync(taxonomyCatalog("biancafe"), { site: AUGUST });
    expect(back.taxonomy.brands.restored).toEqual(["lavazza"]);
    rows = await taxonomyRows();
    expect(rows.brands.every((row) => row.status === "active")).toBe(true);
    expect(rows.categories.every((row) => row.status === "active")).toBe(true);
    expect(rows.brands).toHaveLength(2);
  });

  it("hides no brand or category on a run the breaker refused", async () => {
    await sync(taxonomyCatalog("biancafe"), { site: AUGUST });

    // Five of six products vanish, and most of the taxonomy with them.
    const result = await sync(taxonomyCatalog("biancafe").slice(5), {
      site: { brands: [AUGUST.brands[1]], categories: [AUGUST.categories[1]] } as typeof AUGUST,
    });

    expect(result.breaker.tripped).toBe(true);
    expect(result.taxonomy.brands.markedMissing).toEqual([]);
    expect(result.taxonomy.categories.markedMissing).toEqual([]);
    const rows = await taxonomyRows();
    expect(rows.brands.every((row) => row.status === "active")).toBe(true);
    expect(rows.categories.every((row) => row.status === "active")).toBe(true);
  });

  it("hides nothing, and forgets no source id, when it falls back to HTML listings", async () => {
    await sync(baseCatalog(), {
      site: {
        brands: [
          { id: "1", h1: "Test Brand", slug: "testbrand", count: 6 },
          { id: "2", h1: "Other Brand", slug: "otherbrand", count: 6 },
        ],
      },
    });

    const result = await sync([], { searchStatus: 500, listingProducts: baseCatalog() });

    expect(result.discovery.source).toBe("listing_html");
    const rows = await taxonomyRows();
    // `testcategory` is not one of the listing pages the fallback reads.
    expect(rows.categories.find((row) => row.sourceKey === "testcategory")?.status).toBe("active");
    expect(rows.brands.map((row) => [row.sourceKey, row.sourceId, row.status])).toEqual([
      ["testbrand", "1", "active"],
      ["otherbrand", "2", "active"],
    ]);
  });

  // --- catalog:verify -----------------------------------------------------------

  it("verifies a healthy catalog, renamed or not", async () => {
    await sync(withPhotos(), { skipImages: false });
    await db.update(products).set({ descriptionTextOverride: "Our own summary." });
    expect((await verifyCatalog(db)).ok).toBe(true);

    await sync(renamed(withPhotos()), { skipImages: false });
    const report = await verifyCatalog(db);

    expect(report).toMatchObject({
      ok: true,
      violationCount: 0,
      activeProducts: 12,
      movedProducts: 12,
      activeBrands: 2,
      activeCategories: 1,
    });
    expect(formatCatalogVerifyReport(report)).toContain("catalog:verify passed");
  });

  it("reports a product listed twice", async () => {
    await sync(withPhotos(), { skipImages: false });
    // What a rename looked like before move detection: the old row stays, and
    // a twin is inserted under the new key.
    const [original] = await db
      .select()
      .from(products)
      .where(eq(products.sourceKey, "/coffee-1/#1000g"));
    const { id: _id, ...copy } = original as typeof products.$inferSelect;
    const [twin] = await db
      .insert(products)
      .values({
        ...copy,
        sourceKey: "/coffee-1-1/#1000g",
        slug: "coffee-number-1-1kg-2",
        latestSyncRunId: null,
      })
      .returning({ id: products.id });
    await db.insert(productImages).values({
      productId: twin?.id as string,
      sourceUrl: "https://fake.test/img/twin.jpg",
      status: "active",
    });

    const report = await verifyCatalog(db);

    expect(report.ok).toBe(false);
    expect(report.violations.duplicates).toHaveLength(1);
    expect(report.violations.duplicates[0]).toMatchObject({
      brand: "Test Brand",
      name: "Coffee number 1 1кг.",
      pack: "1000g",
    });
    expect(report.violations.duplicates[0]?.products.map((product) => product.slug)).toEqual([
      "coffee-number-1-1kg-2",
      "test-brand-coffee-number-1-1-kg",
    ]);
    const text = formatCatalogVerifyReport(report);
    expect(text).toContain("catalog:verify FAILED: 1 violation(s)");
    expect(text).toContain("coffee-number-1-1kg-2");

    // A missing row beside its active twin is the same failure, one run later.
    await db
      .update(products)
      .set({ status: "missing" })
      .where(eq(products.id, original?.id as string));
    expect((await verifyCatalog(db)).violations.duplicates).toHaveLength(1);
    // Once removed it is history.
    await db
      .update(products)
      .set({ status: "removed" })
      .where(eq(products.id, original?.id as string));
    expect((await verifyCatalog(db)).violations.duplicates).toHaveLength(0);
  });

  it("does not call two products a duplicate when the source lists both", async () => {
    // The real case: two Lavazza products share brand, name and pack size.
    const twin = { h1: "Lavazza Crema E Aroma 1кг.", imageUrl: "/img/product-img-1174.jpg" };
    await sync(
      [
        ...withPhotos(),
        { ...twin, url: "/lavazza-crema-aroma/" },
        { ...twin, url: "/lavazza-crema-aroma-expert/" },
      ],
      { skipImages: false },
    );

    const report = await verifyCatalog(db);

    expect(report.ok).toBe(true);
    expect(report.notices.sourceListedTwins).toHaveLength(1);
    expect(
      report.notices.sourceListedTwins[0]?.products.map((product) => product.sourceKey),
    ).toEqual(["/lavazza-crema-aroma/#1000g", "/lavazza-crema-aroma-expert/#1000g"]);
    expect(formatCatalogVerifyReport(report)).toContain("listed separately by the source");
  });

  it("reports a moved product that lost its slug or its overrides", async () => {
    await sync(withPhotos(), { skipImages: false });
    await db.update(products).set({
      descriptionTextOverride: "Our own summary.",
      descriptionHtmlOverride: "<p>Our own body copy.</p>",
    });
    await sync(renamed(withPhotos()), { skipImages: false });
    expect((await verifyCatalog(db)).ok).toBe(true);

    await db
      .update(products)
      .set({ slug: "a-new-slug" })
      .where(eq(products.sourceKey, "/coffee-1-1/#1000g"));
    await db
      .update(products)
      .set({ descriptionTextOverride: null, descriptionHtmlOverride: "  " })
      .where(eq(products.sourceKey, "/coffee-2-1/#1000g"));
    await db.delete(products).where(eq(products.sourceKey, "/coffee-3-1/#1000g"));

    const report = await verifyCatalog(db);

    expect(report.ok).toBe(false);
    expect(
      report.violations.moved.map((violation) => [violation.sourceKey, violation.problem]).sort(),
    ).toEqual([
      ["/coffee-1-1/#1000g", "slug_changed"],
      ["/coffee-2-1/#1000g", "html_override_lost"],
      ["/coffee-2-1/#1000g", "text_override_lost"],
      ["/coffee-3-1/#1000g", "row_deleted"],
    ]);
    expect(report.violations.moved.find((v) => v.problem === "slug_changed")).toMatchObject({
      expectedSlug: "test-brand-coffee-number-1-1-kg",
      actualSlug: "a-new-slug",
    });
    expect(formatCatalogVerifyReport(report)).toContain(
      "was test-brand-coffee-number-1-1-kg, is a-new-slug",
    );
  });

  it("counts price-on-request products and fails a price of zero", async () => {
    await sync(
      [
        ...withPhotos(),
        { h1: "Priceless 1кг.", url: "/priceless/", price: "", imageUrl: "/img/p.jpg" },
      ],
      { skipImages: false },
    );
    let report = await verifyCatalog(db);
    expect(report.ok).toBe(true);
    expect(report.notices.priceOnRequest.map((product) => product.slug)).toEqual([
      "test-brand-priceless-1-kg",
    ]);
    expect(formatCatalogVerifyReport(report)).toContain("1 active product(s) are price-on-request");

    await db
      .update(products)
      .set({ currentPrice: "0.00" })
      .where(eq(products.sourceKey, "/coffee-1/#1000g"));
    await db
      .update(products)
      .set({ retailPriceOverride: "-1.00" })
      .where(eq(products.sourceKey, "/coffee-2/#1000g"));
    report = await verifyCatalog(db);
    expect(report.ok).toBe(false);
    expect(report.violations.invalidPrices.map((product) => [product.slug, product.price])).toEqual(
      [
        ["otherbrand-coffee-number-2-1-kg", "-1.00"],
        ["test-brand-coffee-number-1-1-kg", "0.00"],
      ],
    );
  });

  it("reports active products without an active image", async () => {
    await sync(withPhotos(), { skipImages: false });
    const [row] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.sourceKey, "/coffee-1/#1000g"));
    await db
      .update(productImages)
      .set({ status: "failed" })
      .where(eq(productImages.productId, row?.id as string));

    const report = await verifyCatalog(db);
    expect(report.violations.withoutActiveImage.map((product) => product.slug)).toEqual([
      "test-brand-coffee-number-1-1-kg",
    ]);

    // A product that is not listed is not held to this.
    await db
      .update(products)
      .set({ status: "missing" })
      .where(eq(products.id, row?.id as string));
    expect((await verifyCatalog(db)).ok).toBe(true);
  });

  it("reports one brand or category on two rows", async () => {
    await sync(taxonomyCatalog("biancafe"), { site: AUGUST, skipImages: false });
    expect((await verifyCatalog(db)).ok).toBe(true);
    const [site] = await db.select({ id: products.sourceSiteId }).from(products).limit(1);
    const sourceSiteId = site?.id as string;

    // What the rename did before brands and categories were matched on id.
    await db.insert(brands).values({
      sourceSiteId,
      sourceKey: "biancaffe",
      sourceId: "634",
      name: "BIANCAFFE",
      slug: "biancaffe-2",
    });
    await db.insert(categories).values({
      sourceSiteId,
      sourceKey: "kafe-kapsuli",
      sourceId: "611",
      name: "Кафе капсули",
      slug: "kafe-kapsuli",
    });

    const report = await verifyCatalog(db);
    expect(report.ok).toBe(false);
    expect(
      report.violations.sharedSourceIds.map((group) => [
        group.kind,
        group.sourceId,
        group.rows.length,
      ]),
    ).toEqual([
      ["brand", "634", 2],
      ["category", "611", 2],
    ]);
    expect(formatCatalogVerifyReport(report)).toContain("category source id 611");

    // Hidden rows are not live duplicates.
    await db.update(brands).set({ status: "missing" }).where(eq(brands.slug, "biancaffe-2"));
    await db
      .update(categories)
      .set({ status: "missing" })
      .where(eq(categories.slug, "kafe-kapsuli"));
    expect((await verifyCatalog(db)).ok).toBe(true);
  });

  it("reports a renamed brand or category that was left empty", async () => {
    await sync(taxonomyCatalog("biancafe"), { site: AUGUST, skipImages: false });
    await sync(taxonomyCatalog("biancaffe"), { site: OCTOBER, skipImages: false });
    // Renamed in place, and still full — the parent through its children.
    expect((await verifyCatalog(db)).violations.renamedAndEmpty).toEqual([]);

    await db.update(products).set({ brandId: null });
    await db.delete(productCategories);

    const report = await verifyCatalog(db);
    expect(
      report.violations.renamedAndEmpty.map((row) => [row.kind, row.slug, row.previousSourceKeys]),
    ).toEqual([
      ["brand", "biancaffe", ["biancafe"]],
      ["category", "kapsuli", ["kapsuli"]],
    ]);
  });

  // --- catalog:link -------------------------------------------------------------

  const linkInput = (slug: string, sourceKey: string, absorbTwin = false) => ({
    siteKey: "kafezona",
    baseUrl: "https://fake.test/",
    canonicalHost: "fake.test",
    hostAliases: [],
    slug,
    sourceKey,
    absorbTwin,
  });

  /** A rename that also changes the name: nothing for a fingerprint to hold on to. */
  const OLD_LISTING = { h1: "Julius Meinl Clasico 1кг.", url: "/julius-meinl-clasico/" };
  const NEW_LISTING = {
    h1: "Julius Meinl Espresso Classico 1кг.",
    url: "/julius-meinl-classico-1/",
  };
  const OLD_SLUG = "test-brand-julius-meinl-clasico-1-kg";
  const NEW_KEY = "/julius-meinl-classico-1/#1000g";

  it("plans a link without writing anything", async () => {
    await sync([...baseCatalog(), OLD_LISTING]);
    const before = await productRows();
    const runsBefore = (await db.select().from(syncRuns)).length;

    const plan = await planProductLink(db, linkInput(OLD_SLUG, NEW_KEY));

    expect(plan).toMatchObject({
      outcome: "ready",
      twin: null,
      blockers: [],
      product: { slug: OLD_SLUG, sourceKey: "/julius-meinl-clasico/#1000g" },
      to: {
        sourceKey: NEW_KEY,
        sourcePath: "/julius-meinl-classico-1/",
        sourceUrl: "https://fake.test/julius-meinl-classico-1/",
        sourceVariantKey: "1000g",
      },
    });
    expect(formatLinkPlan(plan, { applied: false })).toContain("Plan only; nothing was written.");
    expect(await productRows()).toEqual(before);
    expect(await db.select().from(syncRuns)).toHaveLength(runsBefore);
  });

  it("links a product by hand exactly as the sync would have moved it", async () => {
    await sync([...baseCatalog(), OLD_LISTING]);
    await db
      .update(products)
      .set({ descriptionTextOverride: "Our own summary." })
      .where(eq(products.slug, OLD_SLUG));
    const [before] = await db.select().from(products).where(eq(products.slug, OLD_SLUG));

    const plan = await planProductLink(db, linkInput(OLD_SLUG, NEW_KEY));
    const linked = await applyProductLink(db, plan);

    expect(linked).toMatchObject({
      previousSourceKey: "/julius-meinl-clasico/#1000g",
      slug: OLD_SLUG,
    });
    const [after] = await db
      .select()
      .from(products)
      .where(eq(products.id, before?.id as string));
    expect(after).toMatchObject({
      slug: OLD_SLUG,
      sourceKey: NEW_KEY,
      sourcePath: "/julius-meinl-classico-1/",
      sourceUrl: "https://fake.test/julius-meinl-classico-1/",
      sourceVariantKey: "1000g",
      previousSourceKeys: ["/julius-meinl-clasico/#1000g"],
      descriptionTextOverride: "Our own summary.",
      // Content is the sync's to refresh, not the link's.
      name: "Julius Meinl Clasico 1кг.",
      latestSyncRunId: before?.latestSyncRunId,
    });

    const [audit] = await db.select().from(syncChanges).where(eq(syncChanges.changeType, "moved"));
    expect(audit).toMatchObject({
      syncRunId: linked.syncRunId,
      productId: before?.id,
      sourceKey: NEW_KEY,
      changedFields: ["sourceKey"],
      before: { sourceKey: "/julius-meinl-clasico/#1000g" },
      after: {
        sourceKey: NEW_KEY,
        move: { matchedBy: "manual", decidedBy: null },
        preserved: {
          slug: OLD_SLUG,
          descriptionTextOverride: true,
          descriptionHtmlOverride: false,
        },
      },
    });
    const run = await latestRun();
    expect(run).toMatchObject({
      id: linked.syncRunId,
      status: "succeeded",
      movedCount: 1,
      dryRun: false,
    });
    expect(run?.metadata).toMatchObject({ kind: "manual_link", slug: OLD_SLUG, to: NEW_KEY });

    // The next sync finds the row under its new key: an update, not a twin.
    const result = await sync([...baseCatalog(), NEW_LISTING]);
    expect(result.appliedDiff.counts).toMatchObject({
      created: 0,
      updated: 1,
      moved: 0,
      marked_missing: 0,
    });
    const [synced] = await db
      .select()
      .from(products)
      .where(eq(products.id, before?.id as string));
    expect(synced).toMatchObject({
      slug: OLD_SLUG,
      name: "Julius Meinl Espresso Classico 1кг.",
      descriptionTextOverride: "Our own summary.",
      status: "active",
    });
    expect(await countProducts()).toBe(13);
    expect((await verifyCatalog(db)).violations.moved).toEqual([]);

    // Linking again is a no-op.
    const again = await planProductLink(db, linkInput(OLD_SLUG, NEW_KEY));
    expect(again.outcome).toBe("noop");
    await expect(applyProductLink(db, again)).rejects.toThrow("noop");
  });

  it("re-links a product that has already gone missing, before it is removed", async () => {
    await sync([...baseCatalog(), OLD_LISTING]);
    // The sync that ran before anyone linked: old row missing, twin created.
    const first = await sync([...baseCatalog(), NEW_LISTING]);
    expect(first.appliedDiff.counts).toMatchObject({ created: 1, marked_missing: 1, moved: 0 });
    const [old] = await db.select().from(products).where(eq(products.slug, OLD_SLUG));
    expect(old?.status).toBe("missing");

    // The twin holds the key, so a plain link is refused, and says why.
    const refused = await planProductLink(db, linkInput(OLD_SLUG, NEW_KEY));
    expect(refused.outcome).toBe("blocked");
    expect(refused.twin?.slug).toBe("test-brand-julius-meinl-espresso-classico-1-kg");
    expect(refused.blockers[0]).toContain("--absorb-twin");
    await expect(applyProductLink(db, refused)).rejects.toThrow("blocked");

    const plan = await planProductLink(db, linkInput(OLD_SLUG, NEW_KEY, true));
    expect(plan).toMatchObject({ outcome: "ready", absorbTwin: true });
    const linked = await applyProductLink(db, plan);
    expect(linked.absorbedTwinSlug).toBe("test-brand-julius-meinl-espresso-classico-1-kg");

    expect(await countProducts()).toBe(13);
    const rows = await productRows();
    expect(rows.filter((row) => row.sourceKey === NEW_KEY).map((row) => row.id)).toEqual([old?.id]);
    expect(rows.some((row) => row.slug === "test-brand-julius-meinl-espresso-classico-1-kg")).toBe(
      false,
    );
    expect((await latestRun())?.productsAfter).toBe(13);

    const result = await sync([...baseCatalog(), NEW_LISTING]);
    expect(result.appliedDiff.counts).toMatchObject({ created: 0, restored: 1, marked_missing: 0 });
    const [restored] = await db
      .select()
      .from(products)
      .where(eq(products.id, old?.id as string));
    expect(restored).toMatchObject({
      slug: OLD_SLUG,
      status: "active",
      consecutiveMissingCount: 0,
    });
  });

  it("refuses to absorb a twin that holds something a person put there", async () => {
    await sync([...baseCatalog(), OLD_LISTING]);
    await sync([...baseCatalog(), NEW_LISTING]);
    await db
      .update(products)
      .set({ descriptionTextOverride: "Copy written for the twin." })
      .where(eq(products.sourceKey, NEW_KEY));

    const plan = await planProductLink(db, linkInput(OLD_SLUG, NEW_KEY, true));

    expect(plan.outcome).toBe("blocked");
    expect(plan.blockers[0]).toContain("hand-written description overrides");
    expect(await countProducts()).toBe(14);
  });

  it("refuses a link it cannot make, and says why", async () => {
    await sync(baseCatalog());

    const unknownSlug = await planProductLink(db, linkInput("no-such-product", NEW_KEY));
    expect(unknownSlug).toMatchObject({
      outcome: "blocked",
      blockers: ['No product with slug "no-such-product".'],
    });

    for (const key of ["sku:123", "julius", "/", "/a b/#1000 g", "/x/#"]) {
      const plan = await planProductLink(db, linkInput("test-brand-coffee-number-1-1-kg", key));
      expect(plan.outcome).toBe("blocked");
      expect(plan.blockers[0]).toContain("not a path-shaped source key");
    }

    // Linking a product the last sync saw is allowed, but not silently.
    const live = await planProductLink(
      db,
      linkInput("test-brand-coffee-number-1-1-kg", "/coffee-one/#1000g"),
    );
    expect(live.outcome).toBe("ready");
    expect(live.warnings[0]).toContain("was present at /coffee-1/#1000g in the last sync");
  });

  it("normalises the key it is given", () => {
    expect(parsePathSourceKey("/lavazza-oro-1#1000g")).toEqual({
      sourceKey: "/lavazza-oro-1/#1000g",
      sourcePath: "/lavazza-oro-1/",
      sourceVariantKey: "1000g",
    });
    expect(parsePathSourceKey(" /rema-caffe-intenso/ ")).toEqual({
      sourceKey: "/rema-caffe-intenso/",
      sourcePath: "/rema-caffe-intenso/",
      sourceVariantKey: null,
    });
  });

  // --- Product-page enrichment ------------------------------------------------------

  /** What every generated product page states. */
  const STATED = [
    ["Състав", "100% арабика"],
    ["Произход", "Бразилия"],
  ] as const;

  /** `Coffee number 7 1кг.` -> `00007`: a code that survives a renamed URL. */
  const codeOf = (product: FakeProduct): string =>
    (/number (\d+)/.exec(product.h1)?.[1] ?? "999").padStart(5, "0");

  const withPages = (product: FakeProduct) => ({ code: codeOf(product), characteristics: STATED });

  /** Requests for product pages in the last sync, as opposed to the listing. */
  const pageRequests = () =>
    lastRequests.filter(
      (pathname) =>
        pathname !== "/search/" &&
        pathname !== "/robots.txt" &&
        !pathname.startsWith("/__") &&
        !pathname.startsWith("/img/"),
    );

  const enrichedRows = async () =>
    db
      .select({
        id: products.id,
        sourceKey: products.sourceKey,
        slug: products.slug,
        name: products.name,
        status: products.status,
        sku: products.sku,
        arabicaPercent: products.arabicaPercent,
        origin: products.origin,
        roast: products.roast,
        characteristics: products.characteristics,
        attributes: products.attributes,
        semanticHash: products.semanticHash,
        enrichedAt: products.enrichedAt,
        enrichAttemptedAt: products.enrichAttemptedAt,
        lastChangedAt: products.lastChangedAt,
        sourceData: products.sourceData,
      })
      .from(products)
      .orderBy(products.sourceKey);

  it("stores the product code and the stated facts from the product page", async () => {
    const fixtures = path.resolve(import.meta.dirname, "../../../fixtures/kafezona");
    const amann = await readFile(path.join(fixtures, "product-amann-cascada.html"), "utf8");
    const rosso = await readFile(path.join(fixtures, "product-eurocaf-rosso-fuoco.html"), "utf8");
    const foodness = await readFile(path.join(fixtures, "product-foodness.html"), "utf8");

    const result = await sync(
      [
        { h1: "Amann Cascada 0.500кг.", url: "/amann-cascada-500/", weight: "0.500кг." },
        { h1: "Eurocaf Rosso Fuoco 1кг.", url: "/eurocaf-rosso-fuoco-1/" },
        {
          h1: "Foodness Mermaid Latte 10 бр.",
          url: "/dg-foodness-marmaid-latte-10/",
          weight: "10 бр.",
        },
      ],
      {
        enrichMax: 20,
        minAbsolute: 0,
        productPages: {
          "/amann-cascada-500/": { html: amann },
          "/eurocaf-rosso-fuoco-1/": { html: rosso },
          "/dg-foodness-marmaid-latte-10/": { html: foodness },
        },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.enrichment).toMatchObject({ requests: 3, enriched: 3, failed: 0, deferred: 0 });

    const rows = await enrichedRows();
    expect(rows.find((row) => row.sourceKey === "/amann-cascada-500/#500g")).toMatchObject({
      sku: "00072",
      arabicaPercent: 100,
      origin: "Finca Flor del Rosario, San Cristóbal Verapaz, Гватемала",
      roast: null,
    });
    expect(rows.find((row) => row.sourceKey === "/eurocaf-rosso-fuoco-1/#1000g")).toMatchObject({
      sku: "00001",
      arabicaPercent: null,
      origin: "Уганда и Индия",
      roast: "средно тъмно",
    });
    // Absent stays null: this page states no composition, origin or roast.
    expect(rows.find((row) => row.sku === "00182")).toMatchObject({
      arabicaPercent: null,
      origin: null,
      roast: null,
    });

    for (const row of rows) {
      expect(row.enrichedAt).toBeInstanceOf(Date);
      // The whole labelled list, readable without parsing anything again.
      expect(row.characteristics.length).toBeGreaterThan(0);
      expect(row.characteristics[0]).toEqual({
        label: expect.any(String),
        value: expect.any(String),
      });
      // The listing's own attributes are untouched by it.
      expect(Object.keys(row.attributes).sort()).toEqual([
        "aromas",
        "decaf",
        "intensity",
        "strength",
      ]);
      // And the product is still keyed by path and pack size.
      expect(row.sourceKey.startsWith("/")).toBe(true);
      expect(row.sourceData.identityStrategy).toBe("path_and_size");
    }
    expect(rows.find((row) => row.sku === "00072")?.characteristics).toContainEqual({
      label: "Състав",
      value: expect.stringContaining("100%"),
    });

    const run = await latestRun();
    expect(run).toMatchObject({ enrichedCount: 3, enrichFailedCount: 0, status: "succeeded" });
    expect(run?.metadata.enrichment).toMatchObject({ requests: 3, enriched: 3 });
  });

  it("is a no-op on the sync after an enrichment", async () => {
    const first = await sync(baseCatalog(), { enrichMax: 20, productPages: withPages });
    expect(first.enrichment).toMatchObject({ enriched: 12, failed: 0 });
    expect(pageRequests()).toHaveLength(12);
    const settled = await enrichedRows();
    expect(settled.every((row) => row.sku !== null && row.arabicaPercent === 100)).toBe(true);
    const changesBefore = (await db.select().from(syncChanges)).length;

    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await sync(baseCatalog(), { enrichMax: 20, productPages: withPages });

    expect(second.appliedDiff.counts).toMatchObject({
      created: 0,
      updated: 0,
      moved: 0,
      restored: 0,
      unchanged: 12,
      marked_missing: 0,
      removed: 0,
    });
    // Nothing was asked of the source beyond the listing...
    expect(pageRequests()).toEqual([]);
    expect(second.enrichment).toMatchObject({ requests: 0, enriched: 0, failed: 0, deferred: 0 });
    // ...and no row differs in any column: not the code the listing lacks, not
    // the hash, not either clock.
    expect(await enrichedRows()).toEqual(settled);
    expect(await db.select().from(syncChanges)).toHaveLength(changesBefore);
    expect(await latestRun()).toMatchObject({
      unchangedCount: 12,
      updatedCount: 0,
      enrichedCount: 0,
      enrichFailedCount: 0,
    });

    // A third, for good measure: the two writers have stopped disagreeing.
    const third = await sync(baseCatalog(), { enrichMax: 20, productPages: withPages });
    expect(third.appliedDiff.counts.unchanged).toBe(12);
    expect(await enrichedRows()).toEqual(settled);
  });

  it("reports a real change without naming the product code as changed", async () => {
    await sync(baseCatalog(), { enrichMax: 20, productPages: withPages });
    const changed = baseCatalog().map((product, index) =>
      index === 0 ? { ...product, price: "€99.99" } : product,
    );

    const result = await sync(changed, { enrichMax: 20, productPages: withPages });

    expect(result.appliedDiff.counts).toMatchObject({ updated: 1, unchanged: 11 });
    const [audit] = await db
      .select()
      .from(syncChanges)
      .where(eq(syncChanges.changeType, "updated"));
    expect(audit?.changedFields).toEqual(["currentPrice", "semanticHash"]);
    // The changed product's page is read again; nobody else's is.
    expect(pageRequests()).toEqual(["/coffee-1/"]);
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.sourceKey, "/coffee-1/#1000g"));
    expect(row).toMatchObject({ sku: "00001", currentPrice: "99.99", arabicaPercent: 100 });
  });

  it("counts and records a failed product page without failing the sync", async () => {
    const pages = (product: FakeProduct) => {
      if (product.url === "/coffee-2/") return { status: 404 };
      if (product.url === "/coffee-5/") return { status: 500 };
      // Unserved: the source answers with its home page, HTTP 200.
      if (product.url === "/coffee-9/") return null;
      return withPages(product);
    };

    const result = await sync(baseCatalog(), { enrichMax: 20, productPages: pages });

    expect(result.status).toBe("succeeded");
    expect(result.breaker.tripped).toBe(false);
    expect(result.appliedDiff.counts.created).toBe(12);
    expect(result.enrichment).toMatchObject({
      requests: 12,
      enriched: 9,
      failed: 3,
      halted: false,
    });
    expect(await countProducts("active")).toBe(12);

    const run = await latestRun();
    expect(run).toMatchObject({
      status: "succeeded",
      circuitBreakerTripped: false,
      enrichedCount: 9,
      enrichFailedCount: 3,
      // Enrichment failures are not sync failures.
      failedCount: 0,
      errorSummary: null,
    });

    const errors = await db.select().from(scrapeErrors).orderBy(scrapeErrors.url);
    expect(
      errors.map((error) => [error.url, error.stage, error.errorClass, error.statusCode]),
    ).toEqual([
      ["https://fake.test/coffee-2/", "enrich_fetch", "http_error", 404],
      ["https://fake.test/coffee-5/", "enrich_fetch", "http_error", 500],
      ["https://fake.test/coffee-9/", "enrich_fetch", "soft_404", 200],
    ]);
    expect(errors.every((error) => error.syncRunId === run?.id)).toBe(true);

    const rows = await enrichedRows();
    const failed = rows.filter((row) => row.enrichedAt === null);
    expect(failed.map((row) => row.sourceKey)).toEqual([
      "/coffee-2/#1000g",
      "/coffee-5/#1000g",
      "/coffee-9/#1000g",
    ]);
    expect(failed.every((row) => row.status === "active" && row.sku === null)).toBe(true);
    expect(failed.every((row) => row.enrichAttemptedAt instanceof Date)).toBe(true);

    // The next run does not ask for them again: a dead page costs one request
    // a day, not one a run.
    const next = await sync(baseCatalog(), { enrichMax: 20, productPages: pages });
    expect(pageRequests()).toEqual([]);
    expect(next.status).toBe("succeeded");

    // A day later they are tried once more, and one has come back.
    await db
      .update(products)
      .set({ enrichAttemptedAt: sql`now() - interval '25 hours'` })
      .where(isNull(products.enrichedAt));
    const later = await sync(baseCatalog(), {
      enrichMax: 20,
      productPages: (product) =>
        product.url === "/coffee-9/" ? withPages(product) : pages(product),
    });
    expect(pageRequests().sort()).toEqual(["/coffee-2/", "/coffee-5/", "/coffee-9/"]);
    expect(later.enrichment).toMatchObject({ enriched: 1, failed: 2 });
    expect(later.appliedDiff.counts.unchanged).toBe(12);
  });

  it("stops asking when every product page fails, and still succeeds", async () => {
    // No product pages served at all: each one answers with the shell.
    const result = await sync(baseCatalog(), { enrichMax: 20 });

    expect(result.status).toBe("succeeded");
    expect(result.enrichment).toMatchObject({
      requests: 5,
      enriched: 0,
      failed: 5,
      deferred: 7,
      halted: true,
    });
    expect(pageRequests()).toHaveLength(5);
    expect(await countProducts("active")).toBe(12);
    expect(await latestRun()).toMatchObject({ status: "succeeded", enrichFailedCount: 5 });
  });

  it("never reads more product pages in one run than the cap allows", async () => {
    const first = await sync(baseCatalog(), { enrichMax: 5, productPages: withPages });
    expect(pageRequests()).toHaveLength(5);
    expect(first.enrichment).toMatchObject({ requests: 5, budget: 5, enriched: 5, deferred: 7 });
    expect((await enrichedRows()).filter((row) => row.sku !== null)).toHaveLength(5);

    // The backlog drains over the following runs, five at a time, although
    // nothing in the listing changes.
    const second = await sync(baseCatalog(), { enrichMax: 5, productPages: withPages });
    expect(second.appliedDiff.counts.unchanged).toBe(12);
    expect(pageRequests()).toHaveLength(5);
    expect((await enrichedRows()).filter((row) => row.sku !== null)).toHaveLength(10);

    await sync(baseCatalog(), { enrichMax: 5, productPages: withPages });
    expect(pageRequests()).toHaveLength(2);
    expect((await enrichedRows()).every((row) => row.sku !== null && row.enrichedAt !== null)).toBe(
      true,
    );

    await sync(baseCatalog(), { enrichMax: 5, productPages: withPages });
    expect(pageRequests()).toEqual([]);
  });

  it("reads a changed product ahead of the backlog", async () => {
    await sync(baseCatalog(), { enrichMax: 2, productPages: withPages });
    expect(pageRequests()).toEqual(["/coffee-1/", "/coffee-2/"]);

    const changed = baseCatalog().map((product, index) =>
      index === 11 ? { ...product, price: "€77.00" } : product,
    );
    await sync(changed, { enrichMax: 2, productPages: withPages });

    // The edited product first, then the oldest of the backlog.
    expect(pageRequests()).toEqual(["/coffee-12/", "/coffee-3/"]);
  });

  it("reads no product page when enrichment is switched off", async () => {
    const result = await sync(baseCatalog(), { enrichMax: 0, productPages: withPages });
    expect(pageRequests()).toEqual([]);
    expect(result.enrichment).toMatchObject({ requests: 0, enriched: 0, budget: 0 });
    expect((await enrichedRows()).every((row) => row.sku === null)).toBe(true);
  });

  it("spends the request budget the configuration documents", async () => {
    // This helper switches robots.txt off, so every count here is one below
    // production's: the probe and /search/ here, robots.txt as well there.
    await sync(baseCatalog(), { enrichMax: 20, productPages: withPages });

    // Steady state: nothing changed, nothing in the backlog.
    await sync(baseCatalog(), { enrichMax: 20, productPages: withPages });
    expect(lastRequests.filter((pathname) => pathname === "/search/")).toHaveLength(1);
    expect(lastRequests).toHaveLength(2);

    // A day with five new products: one page each, and nothing else.
    const five = [1, 2, 3, 4, 5].map((n) => ({
      h1: `Coffee number ${100 + n} 1кг.`,
      url: `/coffee-${100 + n}/`,
    }));
    const result = await sync([...baseCatalog(), ...five], {
      enrichMax: 20,
      productPages: withPages,
    });
    expect(result.appliedDiff.counts).toMatchObject({ created: 5, unchanged: 12 });
    expect(pageRequests()).toEqual(five.map((product) => product.url));
    expect(lastRequests).toHaveLength(2 + 5);
  });

  it("stores nothing from product pages on a run the breaker refused", async () => {
    await sync(baseCatalog(), { enrichMax: 20, productPages: withPages });
    const before = await enrichedRows();

    // Ten of twelve vanish, and one new product appears.
    const result = await sync(
      [
        ...baseCatalog().slice(0, 2),
        { h1: "New arrival 1кг.", url: "/coffee-new/", price: "€50.00", weight: "1 кг." },
      ],
      { enrichMax: 20, productPages: withPages },
    );

    expect(result.breaker.tripped).toBe(true);
    expect(result.appliedDiff.counts.created).toBe(1);
    // The one request is the pre-diff lookup, which has to happen before the
    // breaker can judge the diff. Nothing is read, or stored, after it.
    expect(pageRequests()).toEqual(["/coffee-new/"]);
    expect(result.enrichment).toMatchObject({ requests: 1, enriched: 0, deferred: 1 });
    const after = await enrichedRows();
    expect(after.find((row) => row.sourceKey === "/coffee-new/#1000g")).toMatchObject({
      sku: null,
      enrichedAt: null,
    });
    expect(after.filter((row) => row.sku !== null)).toEqual(before);
    expect(await latestRun()).toMatchObject({ status: "partial", enrichedCount: 0 });
  });

  it("keeps a moved product's enriched data", async () => {
    await sync(baseCatalog(), { enrichMax: 20, productPages: withPages });
    const before = await enrichedRows();
    expect(before.every((row) => row.sku !== null)).toBe(true);

    // Every URL is renamed, and on this run not one product page will load.
    const result = await sync(renamed(baseCatalog()), {
      enrichMax: 20,
      productPages: () => ({ status: 404 }),
    });

    expect(result.appliedDiff.counts).toMatchObject({ moved: 12, created: 0, marked_missing: 0 });
    // Twelve unmatched products is over the lookup cap: paired by name.
    expect(result.enrichment.lookup).toMatchObject({ skipped: "over_cap", looked: 0 });
    expect(
      result.appliedDiff.moved.every((move) => move.movedFrom?.matchedBy === "fingerprint"),
    ).toBe(true);
    expect(result.status).toBe("succeeded");

    const after = await enrichedRows();
    const byId = new Map(after.map((row) => [row.id, row]));
    for (const was of before) {
      const row = byId.get(was.id);
      expect(row?.sourceKey).toBe(was.sourceKey.replace("/#", "-1/#"));
      expect(row).toMatchObject({
        slug: was.slug,
        sku: was.sku,
        arabicaPercent: 100,
        origin: "Бразилия",
        characteristics: was.characteristics,
      });
      // ...and it is due to be read again, once its page answers.
      expect(row?.enrichedAt).toBeNull();
    }

    // When the pages are back, the moved rows are re-read under their new
    // URLs and nothing else about them changes.
    await db.update(products).set({ enrichAttemptedAt: null });
    const again = await sync(renamed(baseCatalog()), { enrichMax: 20, productPages: withPages });
    expect(again.appliedDiff.counts).toMatchObject({ unchanged: 12, moved: 0 });
    expect(pageRequests().sort()).toEqual(
      renamed(baseCatalog())
        .map((product) => product.url)
        .sort(),
    );
    expect((await enrichedRows()).map((row) => [row.id, row.sku]).sort()).toEqual(
      before.map((row) => [row.id, row.sku]).sort(),
    );
  });

  /** One product whose URL, name and brand all change in the same edit. */
  const CODED_OLD = { h1: "Julius Meinl Clasico 1кг.", url: "/julius-meinl-clasico/" };
  const CODED_NEW = {
    h1: "Julius Meinl Espresso Classico 1кг.",
    url: "/julius-meinl-classico-1/",
    brandSlug: "otherbrand",
  };
  const codedPages = (product: FakeProduct) =>
    product.url === CODED_OLD.url || product.url === CODED_NEW.url
      ? { code: "00500", characteristics: STATED }
      : withPages(product);

  it("pairs a rename that also changed the name and the brand, by product code", async () => {
    await sync([...baseCatalog(), CODED_OLD], { enrichMax: 20, productPages: codedPages });
    await db
      .update(products)
      .set({ descriptionTextOverride: "Our own summary." })
      .where(eq(products.sourceKey, "/julius-meinl-clasico/#1000g"));
    const [before] = await db
      .select()
      .from(products)
      .where(eq(products.sourceKey, "/julius-meinl-clasico/#1000g"));
    expect(before?.sku).toBe("00500");

    const result = await sync([...baseCatalog(), CODED_NEW], {
      enrichMax: 20,
      productPages: codedPages,
    });

    // Not a twin and a missing row: one product, moved.
    expect(result.appliedDiff.counts).toMatchObject({
      moved: 1,
      created: 0,
      marked_missing: 0,
      unchanged: 12,
    });
    expect(result.appliedDiff.moved[0]?.movedFrom).toEqual({
      sourceKey: "/julius-meinl-clasico/#1000g",
      matchedBy: "sku",
      decidedBy: null,
    });
    expect(result.enrichment.lookup).toMatchObject({
      candidateCount: 1,
      looked: 1,
      found: 1,
      skipped: null,
    });
    // The page read for the lookup is the page stored: one request, not two.
    expect(pageRequests()).toEqual(["/julius-meinl-classico-1/"]);
    expect(result.enrichment).toMatchObject({ requests: 1, enriched: 1, failed: 0 });

    expect(await countProducts()).toBe(13);
    const [after] = await db
      .select()
      .from(products)
      .where(eq(products.id, before?.id as string));
    expect(after).toMatchObject({
      slug: before?.slug,
      name: "Julius Meinl Espresso Classico 1кг.",
      descriptionTextOverride: "Our own summary.",
      sku: "00500",
      status: "active",
      // Identity is still the path and the pack size; the code only vouched.
      sourceKey: "/julius-meinl-classico-1/#1000g",
      sourcePath: "/julius-meinl-classico-1/",
      sourceVariantKey: "1000g",
      previousSourceKeys: ["/julius-meinl-clasico/#1000g"],
    });
    expect(after?.sourceData.identityStrategy).toBe("path_and_size");
    expect((await enrichedRows()).some((row) => row.sourceKey.startsWith("sku:"))).toBe(false);

    const [audit] = await db.select().from(syncChanges).where(eq(syncChanges.changeType, "moved"));
    expect(audit?.after).toMatchObject({ move: { matchedBy: "sku", decidedBy: null } });
    expect(audit?.changedFields).toEqual(expect.arrayContaining(["brandKey", "name", "sourceKey"]));
    const verified = await verifyCatalog(db);
    expect(verified.violations.moved).toEqual([]);
    expect(verified.violations.duplicates).toEqual([]);

    // Settled: the run after is a no-op.
    const again = await sync([...baseCatalog(), CODED_NEW], {
      enrichMax: 20,
      productPages: codedPages,
    });
    expect(again.appliedDiff.counts).toMatchObject({ unchanged: 13, moved: 0, created: 0 });
    expect(pageRequests()).toEqual([]);
  });

  it("reports the code-paired move on a dry run and writes nothing", async () => {
    await sync([...baseCatalog(), CODED_OLD], { enrichMax: 20, productPages: codedPages });
    const before = await enrichedRows();

    const result = await sync([...baseCatalog(), CODED_NEW], {
      enrichMax: 20,
      productPages: codedPages,
      dryRun: true,
    });

    expect(result.appliedDiff.counts).toMatchObject({ moved: 1, created: 0 });
    expect(result.appliedDiff.moved[0]?.movedFrom?.matchedBy).toBe("sku");
    expect(pageRequests()).toEqual(["/julius-meinl-classico-1/"]);
    expect(result.enrichment).toMatchObject({ enriched: 0, failed: 0 });
    expect(await enrichedRows()).toEqual(before);
  });

  it("creates the product when its page states another code than the vanished row", async () => {
    await sync([...baseCatalog(), CODED_OLD], { enrichMax: 20, productPages: codedPages });

    // Same name at a new URL would pair by name; the page says it is not it.
    const result = await sync(
      [...baseCatalog(), { ...CODED_OLD, url: "/julius-meinl-clasico-1/" }],
      {
        enrichMax: 20,
        productPages: (product) =>
          product.url === "/julius-meinl-clasico-1/" ? { code: "00777" } : codedPages(product),
      },
    );

    expect(result.appliedDiff.counts).toMatchObject({ moved: 0, created: 1, marked_missing: 1 });
    expect(await countProducts()).toBe(14);
  });

  it("skips the lookup, and pairs by name, when more products are unmatched than the cap", async () => {
    const olds = [1, 2, 3].map((n) => ({ h1: `Blend ${n} 1кг.`, url: `/blend-${n}/` }));
    const pages = (product: FakeProduct) => ({
      code: `0080${/Blend (\d)/.exec(product.h1)?.[1] ?? "0"}`,
    });
    await sync([...baseCatalog(), ...olds], { enrichMax: 20, productPages: pages });

    const news = olds.map((product) => ({ ...product, url: product.url.replace(/\/$/, "-1/") }));
    const result = await sync([...baseCatalog(), ...news], {
      enrichMax: 20,
      lookupMax: 2,
      productPages: pages,
    });

    expect(result.enrichment.lookup).toMatchObject({
      candidateCount: 3,
      looked: 0,
      found: 0,
      skipped: "over_cap",
    });
    expect(result.appliedDiff.counts).toMatchObject({ moved: 3, created: 0 });
    expect(
      result.appliedDiff.moved.every((move) => move.movedFrom?.matchedBy === "fingerprint"),
    ).toBe(true);
  });

  it("gives neither of two products that share a page its code", async () => {
    const shared = [
      {
        h1: "Borbone Crema Classica 0.500кг.",
        url: "/borbone/",
        price: "€10.70",
        weight: "0.500кг.",
      },
      { h1: "Borbone Crema Classica 1кг.", url: "/borbone/", price: "€20.50", weight: "1 кг." },
    ];
    const result = await sync(shared, {
      enrichMax: 20,
      minAbsolute: 0,
      productPages: () => ({ code: "00321", characteristics: STATED }),
    });

    // One page, read once, describes the coffee in both packs...
    expect(pageRequests()).toEqual(["/borbone/"]);
    expect(result.enrichment).toMatchObject({ requests: 1, enriched: 2 });
    const rows = await enrichedRows();
    expect(rows.map((row) => row.origin)).toEqual(["Бразилия", "Бразилия"]);
    // ...but its one code cannot tell them apart, so neither takes it.
    expect(rows.map((row) => row.sku)).toEqual([null, null]);
  });

  // --- catalog:enrich ---------------------------------------------------------------

  it("plans the backfill without contacting the source or writing", async () => {
    await sync(baseCatalog(), { enrichMax: 0 });
    const before = await enrichedRows();
    const { config, fetcher, requests } = world(baseCatalog(), { productPages: withPages });

    const plan = await runCatalogEnrich({ config, db, fetcher, logger: silentLogger });

    expect(plan).toMatchObject({
      applied: false,
      selected: 12,
      requests: 0,
      enriched: 0,
      failed: 0,
      before: { active: 12, withCode: 0, withoutCode: 12 },
      after: { active: 12, withCode: 0, withoutCode: 12 },
    });
    expect(plan.sample[0]).toEqual({
      slug: "test-brand-coffee-number-1-1-kg",
      sourceUrl: "https://fake.test/coffee-1/",
    });
    expect(requests).toEqual([]);
    expect(await enrichedRows()).toEqual(before);

    // `--limit` narrows the plan too.
    const limited = await runCatalogEnrich({ config, db, fetcher, logger: silentLogger, limit: 4 });
    expect(limited).toMatchObject({ applied: false, selected: 4, requests: 0 });
    expect(requests).toEqual([]);
  });

  it("applies the backfill, within its limit, and finishes when run again", async () => {
    await sync(baseCatalog(), { enrichMax: 0 });
    const runsBefore = (await db.select().from(syncRuns)).length;
    const hashes = (await enrichedRows()).map((row) => [
      row.id,
      row.semanticHash,
      row.lastChangedAt,
    ]);
    const { config, fetcher, requests } = world(baseCatalog(), {
      productPages: (product) =>
        product.url === "/coffee-4/" ? { status: 404 } : withPages(product),
    });
    const productPages = () => requests.filter((pathname) => pathname.startsWith("/coffee-"));

    const first = await runCatalogEnrich({
      config,
      db,
      fetcher,
      logger: silentLogger,
      apply: true,
      limit: 5,
    });

    expect(first).toMatchObject({
      applied: true,
      selected: 5,
      requests: 5,
      enriched: 4,
      failed: 1,
      halted: false,
      after: { active: 12, withCode: 4, withoutCode: 8 },
      sharedCodes: [],
    });
    expect(first.failures).toMatchObject([
      { url: "https://fake.test/coffee-4/", outcome: "http_error", statusCode: 404 },
    ]);
    expect(productPages()).toHaveLength(5);
    const errors = await db.select().from(scrapeErrors);
    expect(errors).toMatchObject([
      { url: "https://fake.test/coffee-4/", stage: "enrich_fetch", syncRunId: null },
    ]);

    // The rest, with no limit: every product that still lacks a code.
    const second = await runCatalogEnrich({
      config,
      db,
      fetcher,
      logger: silentLogger,
      apply: true,
    });
    expect(second).toMatchObject({
      selected: 8,
      enriched: 7,
      failed: 1,
      after: { withCode: 11, withoutCode: 1 },
    });

    const rows = await enrichedRows();
    expect(rows.filter((row) => row.sku === null).map((row) => row.sourceKey)).toEqual([
      "/coffee-4/#1000g",
    ]);
    expect(rows.filter((row) => row.sku !== null).every((row) => row.arabicaPercent === 100)).toBe(
      true,
    );
    // It is not a sync: no run recorded, no product "changed", no status moved.
    expect(await db.select().from(syncRuns)).toHaveLength(runsBefore);
    expect(rows.map((row) => [row.id, row.semanticHash, row.lastChangedAt])).toEqual(hashes);
    expect(await countProducts("active")).toBe(12);

    // And the sync that follows has nothing to say about any of it.
    const after = await sync(baseCatalog(), { enrichMax: 0 });
    expect(after.appliedDiff.counts).toMatchObject({ unchanged: 12, updated: 0 });
    expect((await enrichedRows()).filter((row) => row.sku !== null)).toHaveLength(11);
  });

  it("reports product codes that two active products share", async () => {
    await sync(baseCatalog().slice(0, 6), { enrichMax: 0, minAbsolute: 0 });
    const { config, fetcher } = world(baseCatalog().slice(0, 6), {
      productPages: (product) => ({
        code: product.url === "/coffee-2/" ? "00001" : codeOf(product),
      }),
    });

    const result = await runCatalogEnrich({
      config,
      db,
      fetcher,
      logger: silentLogger,
      apply: true,
    });

    expect(result.enriched).toBe(6);
    expect(result.sharedCodes).toEqual([
      {
        sku: "00001",
        slugs: ["otherbrand-coffee-number-2-1-kg", "test-brand-coffee-number-1-1-kg"],
      },
    ]);
  });

  /* --- Pack size ---------------------------------------------------------- */

  /*
   * The one record whose name and pack field disagree, as the source lists it:
   * 18 pods at the price of 18, with a pack field of 100. See `pack-size.ts`
   * in `@catalog/shared` for the rule.
   */
  const TIN: FakeProduct = {
    h1: "Дозети Illy Decaffeinato 18бр.",
    url: "/illy-decaffeinato-18/",
    price: "€9.20",
    weight: "100 бр.",
  };
  const TIN_KEY = "/illy-decaffeinato-18/#100pc";
  const withTin = (tin: FakeProduct = TIN): FakeProduct[] => [...baseCatalog(), tin];

  const tinRow = async () => {
    const [row] = await db
      .select({
        id: products.id,
        slug: products.slug,
        status: products.status,
        sourceKey: products.sourceKey,
        sourceVariantKey: products.sourceVariantKey,
        previousSourceKeys: products.previousSourceKeys,
        weight: products.weight,
        weightValue: products.weightValue,
        weightUnit: products.weightUnit,
        servings: products.servings,
        servingsEstimated: products.servingsEstimated,
        price: products.currentPrice,
        semanticHash: products.semanticHash,
        sourceData: products.sourceData,
        lastChangedAt: products.lastChangedAt,
      })
      .from(products)
      .where(eq(products.sourcePath, "/illy-decaffeinato-18/"));
    if (!row) throw new Error("the tin is not stored");
    return { ...row, sourceData: row.sourceData as Record<string, unknown> };
  };

  /** The hash the sync stored for a product before the rule existed. */
  const hashBeforeTheRule = (discovered: readonly NormalizedProduct[]): string => {
    const product = discovered.find((candidate) => candidate.sourceKey === TIN_KEY);
    if (!product) throw new Error("the tin was not discovered");
    return semanticHash(buildSemanticFields({ ...product, weight: parseWeight("100 бр.") }));
  };

  /**
   * Put the tin's row back to what the sync wrote before the rule existed,
   * which is what production holds: the pack field's size in every column, no
   * record of a conflict, and the hash of the record with that size in it.
   */
  async function storeAsBeforeTheRule(discovered: readonly NormalizedProduct[]): Promise<void> {
    const {
      packField: _field,
      packSizeConflict: _conflict,
      ...sourceData
    } = (await tinRow()).sourceData;
    await db
      .update(products)
      .set({
        weight: "100 бр.",
        weightValue: "100",
        weightUnit: "pc",
        servings: "100",
        servingsEstimated: false,
        sourceData: { ...sourceData, weightCanonical: "100pc" },
        semanticHash: hashBeforeTheRule(discovered),
      })
      .where(eq(products.sourceKey, TIN_KEY));
  }

  const cupPrice = (row: {
    price: string | null;
    weightValue: string | null;
    weightUnit: string | null;
  }) => pricePerServing(row.price, packServings(row.weightValue, row.weightUnit));

  it("stores the size the name states when the pack field states another", async () => {
    const result = await sync(withTin());
    expect(result.appliedDiff.counts.created).toBe(13);

    const row = await tinRow();
    expect(row).toMatchObject({
      // Identity is the source's record, pack field and all.
      sourceKey: TIN_KEY,
      sourceVariantKey: "100pc",
      weight: "18 бр.",
      weightValue: "18.0000",
      weightUnit: "pc",
      servings: "18.0000",
      servingsEstimated: false,
      price: "9.20",
    });
    // 9,20 € over 18 pods, not over 100.
    expect(cupPrice(row)).toBe("0.5111");
    expect(row.slug.endsWith("-18-br")).toBe(true);
    expect(row.sourceData).toMatchObject({
      // What the source said, kept verbatim beside what was decided.
      weight: "100 бр.",
      packField: "100 бр.",
      weightCanonical: "18pc",
      packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." },
    });

    // Every other product: the pack field stands and no conflict is recorded.
    const others = await db
      .select({ weight: products.weight, sourceData: products.sourceData })
      .from(products)
      .where(sql`${products.sourceKey} <> ${TIN_KEY}`);
    expect(others).toHaveLength(12);
    for (const other of others) {
      expect(other.weight).toBe("1 кг.");
      expect(other.sourceData).toMatchObject({ packField: "1 кг.", packSizeConflict: null });
    }
  });

  it("corrects a product stored before the rule on the next ordinary sync, and only once", async () => {
    const first = await sync(withTin());
    await storeAsBeforeTheRule(first.discovery.products);
    const stale = await tinRow();
    expect(stale).toMatchObject({ weightValue: "100.0000", servings: "100.0000" });
    expect(cupPrice(stale)).toBe("0.0920");

    // The next sync, with nothing special about it.
    const second = await sync(withTin());

    expect(second.status).toBe("succeeded");
    expect(second.breaker.tripped).toBe(false);
    expect(second.appliedDiff.counts).toMatchObject({
      created: 0,
      updated: 1,
      unchanged: 12,
      moved: 0,
      marked_missing: 0,
      removed: 0,
    });
    const fixed = await tinRow();
    expect(fixed).toMatchObject({
      // The same row at the same address, under the same key.
      id: stale.id,
      slug: stale.slug,
      sourceKey: TIN_KEY,
      previousSourceKeys: [],
      status: "active",
      weight: "18 бр.",
      weightValue: "18.0000",
      weightUnit: "pc",
      servings: "18.0000",
      servingsEstimated: false,
    });
    expect(cupPrice(fixed)).toBe("0.5111");
    expect(fixed.sourceData).toMatchObject({
      weightCanonical: "18pc",
      packField: "100 бр.",
      packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." },
    });
    expect(fixed.semanticHash).not.toBe(stale.semanticHash);
    expect(fixed.lastChangedAt.getTime()).toBeGreaterThan(stale.lastChangedAt.getTime());

    // Audited as what it is: the pack size changed, and nothing else did.
    const audit = await db.select().from(syncChanges).where(eq(syncChanges.changeType, "updated"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      productId: stale.id,
      sourceKey: TIN_KEY,
      changedFields: ["semanticHash", "weight"],
    });
    expect(audit[0]?.before).toMatchObject({ weight: "100pc" });
    expect(audit[0]?.after).toMatchObject({ weight: "18pc" });

    // And the sync after that has nothing to do.
    const third = await sync(withTin());
    expect(third.appliedDiff.counts).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 13,
      moved: 0,
      marked_missing: 0,
      removed: 0,
    });
    expect(await tinRow()).toEqual(fixed);
    expect(
      await db.select().from(syncChanges).where(eq(syncChanges.changeType, "updated")),
    ).toHaveLength(1);
  });

  it("settles in one run when the stored row was corrected before the sync reached it", async () => {
    // `catalog:pack-size --apply` writes the pack columns and leaves the hash
    // to the sync, which records the product once more and then has nothing
    // left to say.
    const first = await sync(withTin());
    const settled = await tinRow();
    await db
      .update(products)
      .set({ semanticHash: hashBeforeTheRule(first.discovery.products) })
      .where(eq(products.sourceKey, TIN_KEY));

    const second = await sync(withTin());
    expect(second.appliedDiff.counts).toMatchObject({ updated: 1, unchanged: 12 });
    const [audit] = await db
      .select()
      .from(syncChanges)
      .where(eq(syncChanges.changeType, "updated"));
    expect(audit?.changedFields).toEqual(["semanticHash"]);
    expect(await tinRow()).toMatchObject({
      weightValue: "18.0000",
      servings: "18.0000",
      semanticHash: settled.semanticHash,
    });

    const third = await sync(withTin());
    expect(third.appliedDiff.counts).toMatchObject({ updated: 0, unchanged: 13 });
  });

  it("follows the product and drops the conflict when the source corrects its pack field", async () => {
    await sync(withTin());
    const before = await tinRow();

    const result = await sync(withTin({ ...TIN, weight: "18 бр." }));

    expect(result.breaker.tripped).toBe(false);
    expect(result.appliedDiff.counts).toMatchObject({
      moved: 1,
      created: 0,
      updated: 0,
      unchanged: 12,
      marked_missing: 0,
    });
    const after = await tinRow();
    expect(after).toMatchObject({
      id: before.id,
      slug: before.slug,
      sourceKey: "/illy-decaffeinato-18/#18pc",
      sourceVariantKey: "18pc",
      previousSourceKeys: [TIN_KEY],
      weight: "18 бр.",
      weightValue: "18.0000",
      servings: "18.0000",
      // What is published did not change, so neither did the hash.
      semanticHash: before.semanticHash,
    });
    expect(after.sourceData).toMatchObject({ packField: "18 бр.", packSizeConflict: null });
    expect(await countProducts()).toBe(13);
  });
});
