import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@catalog/db";
import { silentLogger } from "@catalog/shared";
import {
  Fetcher,
  LocalStorageDriver,
  type ScraperConfig,
  discoverCatalog,
  loadConfig,
  runCatalogSync,
} from "@catalog/scraper-core";
import { commandDiscovery } from "../src/commands.ts";
import type { Runtime } from "../src/runtime.ts";
import {
  type FakeProduct,
  createFakeFetch,
} from "../../../packages/scraper-core/test/helpers/fakeSource.ts";
/*
 * Its own database: the sync integration suite truncates every catalog table,
 * and Vitest runs test files in parallel. The helper reads the name when it is
 * first imported, so it is set before that import.
 */
process.env.TEST_DATABASE_NAME =
  `${process.env.TEST_DATABASE_NAME ?? "catalog_test"}_reference_export`.slice(0, 60);
const { isDatabaseAvailable, resetTestDatabase, setupTestDatabase } =
  await import("../../../packages/scraper-core/test/helpers/testDb.ts");

/**
 * The reference export when the source lists two products at one address
 * (research 08 §1.4; review M3). The export reads the catalog from the source
 * and each product's slug from our database by source key. Discovery alone
 * puts the Espresso Bar under a split key, which no stored row has, so it was
 * exported with `slug: null` — and the reference seed refuses a product
 * without one. The export settles keys against the stored catalog first, as
 * the sync does.
 */

const available = await isDatabaseAvailable();
const describeIntegration = available ? describe : describe.skip;

const ADDRESS = "/moreno-super-bar-1/";
const PLAIN = "/moreno-super-bar-1/#1000g";
const SUPER_KEY = `${PLAIN}~name:kafenazarnamorenosuperbar1kg`;

const moreno = (h1: string, price: string, image: number): FakeProduct => ({
  h1,
  url: ADDRESS,
  price,
  weight: "1 кг.",
  brandSlug: "cafe-moreno",
  categorySlug: "kafe-na-zyrna",
  imageUrl: `/img/product-img-${image}.jpg-800w.jpg`,
});
const ESPRESSO = moreno("Кафе на зърна Moreno Espresso Bar 1кг.", "€20.00", 1577);
const SUPER = moreno("Кафе на зърна Moreno Super Bar 1кг.", "€25.00", 1578);
const SITE = {
  brands: [{ id: "7", h1: "MORENO", slug: "cafe-moreno", count: 2 }],
  categories: [{ id: "20", h1: "Кафе на зърна", slug: "kafe-na-zyrna", count: 2, children: [] }],
};

interface ExportedProduct {
  readonly sourceKey: string;
  readonly slug: string | null;
  readonly name: string;
}

describeIntegration("reference export of two products at one address", () => {
  let db: Database;
  let closeDb: () => Promise<void>;
  let root: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    closeDb = setup.close;
    root = await mkdtemp(path.join(tmpdir(), "reference-export-"));
  }, 120_000);

  afterAll(async () => {
    await closeDb?.();
    if (root) await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTestDatabase(db);
  });

  function configFor(): ScraperConfig {
    return loadConfig(
      {
        baseUrl: "https://fake.test/",
        canonicalHost: "fake.test",
        hostAliases: [],
        minDelayMs: 0,
        imageMinDelayMs: 0,
        maxRetries: 0,
        respectRobotsTxt: false,
        maxPages: 5,
        breakerMinAbsoluteProducts: 0,
        enrichMaxPerRun: 0,
        storageDriver: "local",
        storageLocalDir: path.join(root, "storage"),
      },
      {},
    );
  }

  function runtimeFor(catalog: readonly FakeProduct[]): Runtime {
    const config = configFor();
    const { fetchImpl } = createFakeFetch({ products: catalog, ...SITE });
    return {
      config,
      db,
      logger: silentLogger,
      fetcher: new Fetcher({ config, fetchImpl, logger: silentLogger }),
      storage: new LocalStorageDriver(path.join(root, "storage")),
      close: async () => undefined,
    };
  }

  async function syncWith(catalog: readonly FakeProduct[]) {
    const runtime = runtimeFor(catalog);
    return runCatalogSync({
      config: runtime.config,
      db,
      fetcher: runtime.fetcher,
      storage: runtime.storage,
      logger: silentLogger,
      skipImages: true,
    });
  }

  it("exports the stored Espresso Bar under its own key and slug, and every product with one", async () => {
    // Production as it will be: the Espresso Bar stored first, then the split.
    await syncWith([ESPRESSO]);
    await syncWith([ESPRESSO, SUPER]);

    // What the export used to do: raw discovery, no stored row for the Espresso Bar's key.
    const raw = await discoverCatalog({
      config: configFor(),
      fetcher: runtimeFor([ESPRESSO, SUPER]).fetcher,
      logger: silentLogger,
    });
    expect(raw.products.map((product) => product.sourceKey)).not.toContain(PLAIN);

    const output = path.join(root, "latest");
    await commandDiscovery(runtimeFor([ESPRESSO, SUPER]), { output, dryRun: true });
    const exported = JSON.parse(await readFile(path.join(output, "products.json"), "utf8")) as {
      products: ExportedProduct[];
      duplicateKeys: string[];
    };

    expect(
      exported.products
        .map(({ sourceKey, slug }) => ({ sourceKey, slug }))
        .sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1)),
    ).toEqual([
      { sourceKey: PLAIN, slug: "moreno-espresso-bar-kafe-na-zarna-1-kg" },
      { sourceKey: SUPER_KEY, slug: "moreno-super-bar-kafe-na-zarna-1-kg" },
    ]);
    // What the reference seed requires of every product.
    expect(exported.products.every((product) => typeof product.slug === "string")).toBe(true);
    expect(exported.duplicateKeys).toEqual([PLAIN]);
  });
});
