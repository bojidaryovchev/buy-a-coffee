import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@catalog/db";
import {
  brands,
  categories,
  productCategories,
  productImages,
  products,
  sourceSites,
} from "@catalog/db/schema";
import { productCopy } from "../content/product-copy";
import { SOURCE_PATTERNS } from "../e2e/support/source-patterns";
import {
  REFERENCE_SOURCE_KEY,
  type ReferenceSnapshotData,
  loadSnapshot,
  seedReference,
} from "../scripts/reference-seed";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * `seed:reference` against a real PostgreSQL, in a private database.
 *
 * What it must guarantee, and what is checked here:
 *   - it loads the whole committed snapshot through the real schema;
 *   - a second run changes nothing (rows, ids, files, copy);
 *   - it publishes our copy and writes an image file per product;
 *   - it refuses a database that already holds another catalog, and leaves
 *     that catalog exactly as it was;
 *   - nothing it stores points at the source site.
 */

const available = await isDatabaseAvailable();
const describeIntegration = available ? describe : describe.skip;

if (!available) {
  console.warn("\n[integration] PostgreSQL is not reachable; skipping the reference seed test.\n");
}

/**
 * The committed snapshot is the October crawl: 187 products from 20 brands in
 * 8 categories, one photograph each. Stated here so that a re-exported
 * snapshot that changes the catalog's size fails loudly instead of quietly
 * re-baselining every count below.
 */
const SNAPSHOT = { products: 187, brands: 20, categories: 8, imagesPerProduct: 1 } as const;

/** The source's names, joined for a SQL regular expression. */
const sourcePattern = SOURCE_PATTERNS.map((pattern) => pattern.source).join("|");

const SNAPSHOT_DIR = path.resolve(import.meta.dirname, "../../../reference/latest");

describeIntegration("seed:reference (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let storage: string;
  let snapshot: ReferenceSnapshotData;

  const counts = async () => {
    const one = async (table: string) =>
      Number(
        (
          (await db.execute(sql.raw(`select count(*)::int as n from ${table}`))) as Array<{
            n: number;
          }>
        )[0]?.n,
      );
    return {
      products: await one("products"),
      brands: await one("brands"),
      categories: await one("categories"),
      images: await one("product_images"),
      links: await one("product_categories"),
      sites: await one("source_sites"),
    };
  };

  const files = async (): Promise<string[]> =>
    (await readdir(storage, { recursive: true })).filter((entry) => entry.endsWith(".png")).sort();

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("reference_seed"));
    storage = await mkdtemp(path.join(os.tmpdir(), "reference-seed-"));
    snapshot = await loadSnapshot(SNAPSHOT_DIR);

    // This database is private to this file, but may hold rows from an earlier run.
    await db.execute(
      sql`truncate table product_images, product_categories, products, brands, categories, source_sites cascade`,
    );
  });

  afterAll(async () => {
    await close?.();
    if (storage) await rm(storage, { recursive: true, force: true });
  });

  it("loads the whole snapshot through the real schema", async () => {
    const summary = await seedReference(db, { snapshot, copy: productCopy, storageDir: storage });

    expect(snapshot.products).toHaveLength(SNAPSHOT.products);
    expect(summary).toMatchObject({
      created: true,
      products: SNAPSHOT.products,
      brands: SNAPSHOT.brands,
      categories: SNAPSHOT.categories,
    });
    expect(await counts()).toEqual({
      products: SNAPSHOT.products,
      brands: SNAPSHOT.brands,
      categories: SNAPSHOT.categories,
      images: SNAPSHOT.products * SNAPSHOT.imagesPerProduct,
      links: snapshot.products.reduce((sum, product) => sum + product.categoryKeys.length, 0),
      sites: 1,
    });
  });

  it("gives the storefront what the end-to-end specs look for", async () => {
    // The source renamed this category (`kapsuli` → `kafe-kapsuli`, "Капсули" →
    // "Кафе капсули"). The storefront keeps the slug it allocated and shows
    // the current name, and so must the seed.
    const [capsules] = await db.select().from(categories).where(eq(categories.slug, "kapsuli"));
    expect(capsules).toMatchObject({ sourceKey: "kafe-kapsuli", name: "Кафе капсули" });
    expect(await db.select().from(categories).where(eq(categories.slug, "kafe-kapsuli"))).toEqual(
      [],
    );

    const children = await db
      .select()
      .from(categories)
      .where(eq(categories.parentId, capsules!.id));
    expect(children.map((child) => child.slug).sort()).toEqual(
      ["a-modo-mio", "caffitaly", "dolce-gusto", "lavazza-blue", "nespresso"].sort(),
    );

    const [lavazza] = await db.select().from(brands).where(eq(brands.slug, "lavazza"));
    expect(lavazza).toBeDefined();
    // The source's own address for this brand has a stray leading space; ours must not.
    const [vergnano] = await db.select().from(brands).where(eq(brands.slug, "vergnano"));
    expect(vergnano?.sourceUrl).toBe("https://reference.invalid/vergnano/");
  });

  it("uses the snapshot's slugs, not ones derived from the source's keys", async () => {
    const categorySlugs = Object.fromEntries(
      (await db.select().from(categories)).map((row) => [row.sourceKey, row.slug]),
    );
    expect(categorySlugs).toEqual(
      Object.fromEntries(snapshot.categories.map((row) => [row.sourceKey, row.slug])),
    );
    // Two that a derivation gets wrong.
    expect(categorySlugs["kafe-na-zyrna"]).toBe("kafe-na-zarna");
    const [bourbons] = await db.select().from(brands).where(eq(brands.sourceKey, "3-bourbons"));
    expect(bourbons?.slug).toBe("3bourbons");
  });

  it("stores the fields the storefront reads, as the sync would", async () => {
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.slug, "kafe-na-zarna-amann-la-cascada-0-500kg"));
    expect(row).toMatchObject({
      currentPrice: "16.00",
      currency: "EUR",
      availability: "in_stock",
      weightValue: "500.0000",
      weightUnit: "g",
      servingsEstimated: true,
      status: "active",
    });
    expect(Number(row?.servings)).toBeGreaterThan(70);
    expect(row?.brandId).not.toBeNull();
  });

  it("publishes our copy into the override columns, and leaves the source columns alone", async () => {
    const [counted] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(
        sql`${products.descriptionTextOverride} is not null and ${products.descriptionHtmlOverride} is not null`,
      );
    expect(counted?.n).toBe(Object.keys(productCopy).length);

    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.slug, "kafe-na-zarna-amann-la-cascada-0-500kg"));
    expect(row?.descriptionTextOverride).toBe(
      productCopy["kafe-na-zarna-amann-la-cascada-0-500kg"]?.summary,
    );
    // `description_text` is the sync's record of what the source said.
    expect(row?.descriptionText).toBe(
      snapshot.products.find((p) => p.slug === row?.slug)?.descriptionText,
    );
  });

  it("writes one real image file per product, and points each image row at it", async () => {
    const written = await files();
    expect(written).toHaveLength(SNAPSHOT.products * SNAPSHOT.imagesPerProduct);

    const rows = await db.select().from(productImages);
    for (const row of rows) {
      expect(row.objectKey).toMatch(/^catalog\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
      const bytes = await readFile(path.join(storage, row.objectKey!));
      expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(bytes.length).toBe(row.byteSize);
    }
    expect(rows.filter((row) => row.isPrimary)).toHaveLength(SNAPSHOT.products);
  });

  it("stores nothing that points at the source site", async () => {
    const tables = ["products", "brands", "categories", "product_images", "source_sites"];
    for (const table of tables) {
      const [hit] = (await db.execute(
        sql.raw(`select count(*)::int as n from ${table} t where t::text ~* '${sourcePattern}'`),
      )) as Array<{ n: number }>;
      expect(hit?.n, `${table} mentions the source`).toBe(0);
    }
  });

  it("is idempotent: a second run changes no row, no id, no file and no copy", async () => {
    const before = {
      counts: await counts(),
      ids: (await db.select({ id: products.id, slug: products.slug }).from(products)).sort((a, b) =>
        a.slug.localeCompare(b.slug),
      ),
      files: await files(),
    };

    const summary = await seedReference(db, { snapshot, copy: productCopy, storageDir: storage });

    expect(summary).toMatchObject({
      created: false,
      imageFilesWritten: 0,
      // Every product with hand-written copy; the rest use the generated sentence.
      copy: { matched: Object.keys(productCopy).length, written: 0 },
    });
    expect(await counts()).toEqual(before.counts);
    expect(
      (await db.select({ id: products.id, slug: products.slug }).from(products)).sort((a, b) =>
        a.slug.localeCompare(b.slug),
      ),
    ).toEqual(before.ids);
    expect(await files()).toEqual(before.files);
  });

  it("repairs an edited row instead of duplicating it", async () => {
    await db
      .update(products)
      .set({ currentPrice: "99.99" })
      .where(eq(products.slug, "kafe-na-zarna-amann-la-cascada-0-500kg"));
    await seedReference(db, { snapshot, copy: productCopy, storageDir: storage });
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.slug, "kafe-na-zarna-amann-la-cascada-0-500kg"));
    expect(row?.currentPrice).toBe("16.00");
    expect((await counts()).products).toBe(SNAPSHOT.products);
  });

  it("refuses a database that already holds another catalog, and leaves it untouched", async () => {
    // Fresh state: only a foreign catalog, as a synced database would hold.
    await db.execute(
      sql`truncate table product_images, product_categories, products, brands, categories, source_sites cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "some-real-source",
        name: "A real source",
        baseUrl: "https://example.test/",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    await db.insert(products).values({
      sourceSiteId: site!.id,
      sourceKey: "/real/#1",
      sourceUrl: "https://example.test/real/",
      sourcePath: "/real/",
      name: "A real product",
      slug: "a-real-product",
      semanticHash: "0".repeat(64),
    });
    const before = await counts();

    await expect(
      seedReference(db, { snapshot, copy: productCopy, storageDir: storage }),
    ).rejects.toThrow(/already holds a catalog from "some-real-source"/);

    expect(await counts()).toEqual(before);
    const [row] = await db.select().from(products);
    expect(row?.slug).toBe("a-real-product");
    const [ours] = await db
      .select()
      .from(sourceSites)
      .where(eq(sourceSites.key, REFERENCE_SOURCE_KEY));
    expect(ours).toBeUndefined();
  });

  it("refuses a database holding only another site's brands or categories", async () => {
    await db.execute(
      sql`truncate table product_images, product_categories, products, brands, categories, source_sites cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "another-source",
        name: "Another",
        baseUrl: "https://example.test/",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    await db
      .insert(categories)
      .values({ sourceSiteId: site!.id, sourceKey: "c", name: "C", slug: "c" });

    await expect(
      seedReference(db, { snapshot, copy: productCopy, storageDir: storage }),
    ).rejects.toThrow(/already holds a catalog/);
  });

  it("does not mind a foreign source site that is empty", async () => {
    await db.execute(
      sql`truncate table product_images, product_categories, products, brands, categories, source_sites cascade`,
    );
    await db.insert(sourceSites).values({
      key: "empty-source",
      name: "Empty",
      baseUrl: "https://example.test/",
      canonicalHost: "example.test",
    });

    const summary = await seedReference(db, { snapshot, copy: productCopy, storageDir: storage });
    expect(summary.created).toBe(true);
    expect((await counts()).links).toBeGreaterThan(0);
    expect(await db.select().from(productCategories).limit(1)).toHaveLength(1);
  });
});
