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
const SUPER_KEY = `${PLAIN}~name:kafe-na-zarna-moreno-super-bar-1kg`;

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
    options: { enrichMax?: number; dryRun?: boolean } = {},
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
      productPages: { [ADDRESS]: { html: SHARED_PAGE } },
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
    expect(lastRequests.filter((request) => request === ADDRESS)).toEqual([]);
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
