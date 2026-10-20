import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@catalog/db";
import { products, syncChanges, syncRuns } from "@catalog/db/schema";
import { silentLogger } from "@catalog/shared";
import type { KeyCollision } from "../src/catalog/collisions.ts";
import { runCatalogSync } from "../src/catalog/sync.ts";
import { verifyCatalog } from "../src/catalog/verify.ts";
import { loadConfig } from "../src/config.ts";
import { Fetcher } from "../src/fetch/fetcher.ts";
import { LocalStorageDriver } from "../src/storage/driver.ts";
import {
  type FakeProduct,
  type FakeSiteOptions,
  buildProductPage,
  createFakeFetch,
} from "./helpers/fakeSource.ts";
/*
 * Its own database: the sync integration suite truncates every catalog table,
 * and Vitest runs test files in parallel. The helper reads the name when it is
 * first imported, so it is set before that import.
 */
process.env.TEST_DATABASE_NAME =
  `${process.env.TEST_DATABASE_NAME ?? "catalog_test"}_key_collisions`.slice(0, 60);
const { isDatabaseAvailable, resetTestDatabase, setupTestDatabase } =
  await import("./helpers/testDb.ts");

/**
 * Two products at one source address, through the real sync and a real
 * database (research 08 §1.4). Only the network is faked.
 *
 * The catalog starts as production is today: the Espresso Bar stored under
 * `/moreno-super-bar-1/#1000g`, the Super Bar never kept. Then the source
 * lists both, in one order and then the other, run after run.
 */

const available = await isDatabaseAvailable();
const describeIntegration = available ? describe : describe.skip;

const ADDRESS = "/moreno-super-bar-1/";
const PLAIN = "/moreno-super-bar-1/#1000g";
const SUPER_KEY = `${PLAIN}~name:kafenazarnamorenosuperbar1kg`;
const ESPRESSO_KEY = `${PLAIN}~name:kafenazarnamorenoespressobar1kg`;

const SITE: Pick<FakeSiteOptions, "brands" | "categories"> = {
  brands: [{ id: "7", h1: "MORENO", slug: "cafe-moreno", count: 4 }],
  categories: [{ id: "20", h1: "Кафе на зърна", slug: "kafe-na-zyrna", count: 4, children: [] }],
};

const moreno = (h1: string, url: string, price: string, image: number): FakeProduct => ({
  h1,
  url,
  price,
  weight: "1 кг.",
  brandSlug: "cafe-moreno",
  categorySlug: "kafe-na-zyrna",
  imageUrl: `/img/product-img-${image}.jpg-800w.jpg`,
});

const ESPRESSO = moreno("Кафе на зърна Moreno Espresso Bar 1кг.", ADDRESS, "€20.00", 1577);
const SUPER = moreno("Кафе на зърна Moreno Super Bar 1кг.", ADDRESS, "€25.00", 1578);
/** Neighbours whose keys must not move. */
const OTHERS = [
  moreno("Кафе на зърна Moreno Extra Bar 1кг.", "/moreno-extra-bar/", "€22.00", 1579),
  moreno("Кафе на зърна Moreno Vending 1кг.", "/moreno-vending/", "€18.00", 1580),
];

/** The page at the shared address: the Espresso Bar's, as on the source. */
const SHARED_PAGE = buildProductPage(ESPRESSO, {
  code: "00072",
  characteristics: [
    ["Състав", "80% арабика, 20% робуста"],
    ["Изпичане", "средно тъмно"],
  ],
});

/** The shared page as the source might switch it: the Super Bar's. */
const SUPER_PAGE = buildProductPage(SUPER, {
  code: "00073",
  characteristics: [["Състав", "100% арабика"]],
});

describeIntegration("two products at one source address (integration)", () => {
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

  /** Paths the most recent `sync()` requested. */
  let lastRequests: string[] = [];

  async function sync(
    catalog: readonly FakeProduct[],
    options: { enrichMax?: number; dryRun?: boolean; page?: string } = {},
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
        missingThreshold: 3,
        breakerMinAbsoluteProducts: 0,
        // A catalog of two, one of which leaves: the breaker would rightly
        // call that a mass disappearance. These tests are about keys, so it
        // lets absences through; its own suite is `sync.integration.test.ts`.
        breakerMaxDisappearedRatio: 1,
        breakerMinDiscoveredRatio: 0,
        enrichMaxPerRun: options.enrichMax ?? 0,
        enrichLookupMax: 10,
        storageDriver: "local",
        storageLocalDir: storageDir,
      },
      {},
    );
    const { fetchImpl, requests } = createFakeFetch({
      products: catalog,
      ...SITE,
      productPages: { [ADDRESS]: { html: options.page ?? SHARED_PAGE } },
    });
    lastRequests = requests;
    return runCatalogSync({
      config,
      db,
      fetcher: new Fetcher({ config, fetchImpl, logger: silentLogger }),
      storage: new LocalStorageDriver(storageDir),
      logger: silentLogger,
      dryRun: options.dryRun ?? false,
      skipImages: true,
    });
  }

  const rows = () =>
    db
      .select({
        id: products.id,
        sourceKey: products.sourceKey,
        slug: products.slug,
        name: products.name,
        price: products.currentPrice,
        status: products.status,
        collision: products.hasUrlCollision,
        characteristics: products.characteristics,
        sku: products.sku,
        enrichedAt: products.enrichedAt,
        enrichAttemptedAt: products.enrichAttemptedAt,
      })
      .from(products)
      .orderBy(asc(products.sourceKey));

  const byKey = async (sourceKey: string) =>
    (await rows()).find((row) => row.sourceKey === sourceKey);

  const runMetadata = async (syncRunId: string | null) => {
    const [run] = await db
      .select({ metadata: syncRuns.metadata })
      .from(syncRuns)
      .where(eq(syncRuns.id, syncRunId as string));
    return run?.metadata as { keyCollisions?: KeyCollision[] } | undefined;
  };

  it("keeps the Espresso Bar's row and adds the Super Bar, whichever way round, run after run", async () => {
    // Production today: the Espresso Bar alone under the plain key.
    await sync([...OTHERS, ESPRESSO]);
    const before = await rows();
    const espresso = before.find((row) => row.sourceKey === PLAIN);
    expect(espresso).toMatchObject({
      slug: "moreno-espresso-bar-kafe-na-zarna-1-kg",
      name: "Кафе на зърна Moreno Espresso Bar 1кг.",
      price: "20.00",
    });

    const orders = [
      [...OTHERS, ESPRESSO, SUPER],
      [SUPER, ...OTHERS, ESPRESSO],
      [ESPRESSO, SUPER, ...OTHERS],
      [SUPER, ESPRESSO, ...OTHERS],
    ];
    let superRow: Awaited<ReturnType<typeof byKey>>;
    for (const [index, catalog] of orders.entries()) {
      const result = await sync(catalog);
      expect(result.status).toBe("succeeded");
      expect(result.discovery.products).toHaveLength(4);
      expect(result.appliedDiff.counts).toMatchObject({
        created: index === 0 ? 1 : 0,
        updated: 0,
        unchanged: index === 0 ? 3 : 4,
        marked_missing: 0,
        removed: 0,
        moved: 0,
        restored: 0,
      });

      // The Espresso Bar: the same row, key, slug, name and price.
      expect(await byKey(PLAIN)).toMatchObject({
        id: espresso?.id,
        slug: "moreno-espresso-bar-kafe-na-zarna-1-kg",
        name: "Кафе на зърна Moreno Espresso Bar 1кг.",
        price: "20.00",
        status: "active",
        collision: true,
      });

      // The Super Bar: kept, under a key and a slug of its own, stable.
      const current = await byKey(SUPER_KEY);
      expect(current).toMatchObject({
        slug: "moreno-super-bar-kafe-na-zarna-1-kg",
        name: "Кафе на зърна Moreno Super Bar 1кг.",
        price: "25.00",
        status: "active",
        collision: true,
      });
      if (superRow) expect(current?.id).toBe(superRow.id);
      superRow = current;

      // The neighbours: untouched.
      for (const other of before.filter((row) => row.sourceKey !== PLAIN)) {
        expect(await byKey(other.sourceKey)).toMatchObject({ id: other.id, slug: other.slug });
      }

      const metadata = await runMetadata(result.syncRunId);
      expect(metadata?.keyCollisions).toEqual([
        {
          sourceKey: PLAIN,
          tiebreaker: "name",
          products: [
            { sourceKey: PLAIN, name: "Кафе на зърна Moreno Espresso Bar 1кг.", price: "20.00" },
            { sourceKey: SUPER_KEY, name: "Кафе на зърна Moreno Super Bar 1кг.", price: "25.00" },
          ],
          dropped: [],
          unresolved: [],
        },
      ]);
    }

    expect(await rows()).toHaveLength(4);
    // Nothing was ever recorded against the Espresso Bar but its creation.
    const audit = await db
      .select({ changeType: syncChanges.changeType })
      .from(syncChanges)
      .where(eq(syncChanges.productId, espresso?.id as string));
    expect(audit.map((change) => change.changeType)).toEqual(["created"]);

    // And the catalog's own invariants hold: two names, so not a duplicate.
    const report = await verifyCatalog(db);
    expect(report.violations.duplicates).toEqual([]);
  });

  it("creates both under keys of their own on a first sync", async () => {
    const result = await sync([SUPER, ESPRESSO]);
    expect(result.appliedDiff.counts.created).toBe(2);
    expect((await rows()).map((row) => row.slug).sort()).toEqual([
      "moreno-espresso-bar-kafe-na-zarna-1-kg",
      "moreno-super-bar-kafe-na-zarna-1-kg",
    ]);
  });

  it("keeps the first of two records nothing tells apart, as before, and records it on the run", async () => {
    await sync([ESPRESSO]);
    const result = await sync([ESPRESSO, { ...ESPRESSO, price: "€21.00" }]);

    // Exactly the old behaviour for these two, and not a failed run.
    expect(result.status).toBe("succeeded");
    expect(result.appliedDiff.counts).toMatchObject({ unchanged: 1, created: 0, updated: 0 });
    expect(await byKey(PLAIN)).toMatchObject({ price: "20.00" });

    const metadata = await runMetadata(result.syncRunId);
    expect(metadata?.keyCollisions).toMatchObject([
      {
        sourceKey: PLAIN,
        tiebreaker: null,
        unresolved: ["indistinguishable"],
        dropped: [{ price: "21.00", keptAs: PLAIN }],
      },
    ]);
  });

  it("does not read the Espresso Bar's page into the Super Bar", async () => {
    await sync([ESPRESSO], { enrichMax: 10 });
    expect((await byKey(PLAIN))?.characteristics).toContainEqual({
      label: "Състав",
      value: "80% арабика, 20% робуста",
    });

    await sync([ESPRESSO, SUPER], { enrichMax: 10 });
    // Read once, for the Super Bar, and found to be the Espresso Bar's page.
    expect(lastRequests.filter((request) => request === ADDRESS)).toHaveLength(1);
    const superBar = await byKey(SUPER_KEY);
    expect(superBar?.characteristics).toEqual([]);
    expect(superBar?.enrichedAt).toBeNull();
    // Waiting a day, like a page that failed, rather than heading the backlog.
    expect(superBar?.enrichAttemptedAt).toBeInstanceOf(Date);
    // The Espresso Bar keeps what its own page said.
    expect((await byKey(PLAIN))?.characteristics).toHaveLength(2);

    await sync([SUPER, ESPRESSO], { enrichMax: 10 });
    expect(lastRequests.filter((request) => request === ADDRESS)).toEqual([]);
  });

  it("enriches the Espresso Bar from its own page on a catalog synced from scratch (L7)", async () => {
    // Nothing stored: both products leave the first sync under split keys.
    await sync([SUPER, ESPRESSO], { enrichMax: 10 });
    expect((await rows()).map((row) => row.sourceKey)).toEqual([ESPRESSO_KEY, SUPER_KEY]);

    // The page names the Espresso Bar, so it is the Espresso Bar's to keep.
    const espresso = await byKey(ESPRESSO_KEY);
    expect(espresso?.characteristics).toHaveLength(2);
    expect(espresso?.enrichedAt).toBeInstanceOf(Date);
    // But not its code: the page is shared, and its one code names neither row.
    expect(espresso?.sku).toBeNull();

    const superBar = await byKey(SUPER_KEY);
    expect(superBar?.characteristics).toEqual([]);
    expect(superBar?.enrichedAt).toBeNull();
  });

  it("does not enrich the Espresso Bar from the shared page once it shows the Super Bar", async () => {
    await sync([ESPRESSO]);
    await sync([ESPRESSO, SUPER], { enrichMax: 10, page: SUPER_PAGE });

    // The Espresso Bar, under the plain key, is not the product the page names.
    const espresso = await byKey(PLAIN);
    expect(espresso?.characteristics).toEqual([]);
    expect(espresso?.enrichedAt).toBeNull();
    expect(espresso?.enrichAttemptedAt).toBeInstanceOf(Date);
    // The Super Bar is, and takes what it says — but not its one code.
    const superBar = await byKey(SUPER_KEY);
    expect(superBar?.characteristics).toContainEqual({ label: "Състав", value: "100% арабика" });
    expect(superBar?.sku).toBeNull();
  });

  it("still enriches the Espresso Bar from the shared page while the page is its own", async () => {
    await sync([ESPRESSO]);
    await sync([ESPRESSO, SUPER], { enrichMax: 10 });
    const espresso = await byKey(PLAIN);
    expect(espresso?.characteristics).toHaveLength(2);
    expect(espresso?.sku).toBeNull();
    expect((await byKey(SUPER_KEY))?.characteristics).toEqual([]);
  });

  it("S1 in the database: a re-punctuated name keeps both rows where they are", async () => {
    await sync([ESPRESSO]);
    await sync([ESPRESSO, SUPER]);
    const before = await rows();

    const result = await sync([
      { ...ESPRESSO, h1: "Кафе на зърна Moreno Espresso Bar 1 кг" },
      SUPER,
    ]);
    expect(result.appliedDiff.counts).toMatchObject({
      created: 0,
      updated: 1,
      unchanged: 1,
      marked_missing: 0,
    });
    const after = await rows();
    expect(after.map((row) => [row.id, row.sourceKey, row.slug, row.price])).toEqual(
      before.map((row) => [row.id, row.sourceKey, row.slug, row.price]),
    );
    expect((await runMetadata(result.syncRunId))?.keyCollisions?.[0]?.unresolved).toEqual([]);
  });

  it("S2 in the database: the removed Espresso Bar row is never restored as another product", async () => {
    await sync([ESPRESSO]);
    await sync([ESPRESSO, SUPER]);
    for (let run = 0; run < 3; run += 1) await sync([SUPER]);
    expect(await byKey(PLAIN)).toMatchObject({ status: "removed" });

    const crema = { ...SUPER, h1: "Кафе на зърна Moreno Super Bar Crema 1кг." };
    const result = await sync([crema]);
    expect(result.appliedDiff.counts).toMatchObject({
      created: 1,
      restored: 0,
      updated: 0,
      marked_missing: 1,
    });
    expect(await byKey(PLAIN)).toMatchObject({
      status: "removed",
      name: "Кафе на зърна Moreno Espresso Bar 1кг.",
      price: "20.00",
    });
    expect(await byKey(`${PLAIN}~name:kafenazarnamorenosuperbarcrema1kg`)).toMatchObject({
      status: "active",
      price: "25.00",
    });
    // Recorded on the run, for the storefront's check to raise.
    expect((await runMetadata(result.syncRunId))?.keyCollisions).toMatchObject([
      { sourceKey: PLAIN, unresolved: ["unmatched"] },
    ]);
  });

  it("reports the split on a dry run, and writes no product", async () => {
    await sync([ESPRESSO]);
    const result = await sync([SUPER, ESPRESSO], { dryRun: true });

    expect(result.appliedDiff.counts).toMatchObject({ created: 1, unchanged: 1, updated: 0 });
    expect(result.appliedDiff.created[0]?.sourceKey).toBe(SUPER_KEY);
    expect((await rows()).map((row) => row.sourceKey)).toEqual([PLAIN]);
    const metadata = await runMetadata(result.syncRunId);
    expect(metadata?.keyCollisions?.[0]?.products.map((product) => product.sourceKey)).toEqual([
      PLAIN,
      SUPER_KEY,
    ]);
  });
});
