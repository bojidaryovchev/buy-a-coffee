import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@catalog/db";
import { products, syncChanges, syncRuns } from "@catalog/db/schema";
import { silentLogger } from "@catalog/shared";
import { loadConfig } from "../src/config.ts";
import { Fetcher } from "../src/fetch/fetcher.ts";
import { runCatalogSync } from "../src/catalog/sync.ts";
import { LocalStorageDriver } from "../src/storage/driver.ts";
import { type FakeProduct, baseCatalog, createFakeFetch } from "./helpers/fakeSource.ts";
import { isDatabaseAvailable, resetTestDatabase, setupTestDatabase } from "./helpers/testDb.ts";
import { mkdtemp, rm } from "node:fs/promises";
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

  /** Run one sync against a synthetic catalog. */
  async function sync(
    catalog: readonly FakeProduct[],
    options: {
      missingThreshold?: number;
      dryRun?: boolean;
      skipImages?: boolean;
      searchStatus?: number;
      listingProducts?: readonly FakeProduct[];
      breakerRatio?: number;
      minAbsolute?: number;
    } = {},
  ) {
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
        storageDriver: "local",
        storageLocalDir: storageDir,
      },
      {},
    );

    const { fetchImpl } = createFakeFetch({
      products: catalog,
      ...(options.searchStatus !== undefined ? { searchStatus: options.searchStatus } : {}),
      ...(options.listingProducts !== undefined ? { listingProducts: options.listingProducts } : {}),
    });

    return runCatalogSync({
      config,
      db,
      fetcher: new Fetcher({ config, fetchImpl, logger: silentLogger }),
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

    const audit = await db
      .select()
      .from(syncChanges)
      .where(eq(syncChanges.changeType, "updated"));
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
      { h1: "Borbone Crema Classica 0.500кг.", url: "/borbone/", price: "€10.70", weight: "0.500кг." },
      { h1: "Borbone Crema Classica 1кг.", url: "/borbone/", price: "€20.50", weight: "1 кг." },
    ]);

    expect(result.appliedDiff.counts.created).toBe(2);
    const rows = await db
      .select({ sourceKey: products.sourceKey, price: products.currentPrice, collision: products.hasUrlCollision })
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

    await sync([{ h1: "Completely different name 1кг.", url: "/stable/", price: "€10.00", weight: "1 кг." }]);
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
});
