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
import { SEEDED_FORMER_SLUGS } from "../scripts/reference-former-slugs";
import {
  REFERENCE_SOURCE_KEY,
  type ReferenceSnapshotData,
  loadSnapshot,
  seedFormerSlugs,
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
      .where(eq(products.slug, "amann-la-cascada-kafe-na-zarna-500-g"));
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

  it("stores the pack size the name states where the supplier's pack field states another", async () => {
    // The snapshot is the supplier's record: an 18-pod tin with a pack field
    // of 100. The seed decides by the rule the sync decides by.
    const listed = snapshot.products.find(
      (product) => product.sourceKey === "/illy-decaffeinato-18/#100pc",
    );
    expect(listed).toMatchObject({ name: "Дозети Illy Decaffeinato 18бр.", weight: "100 бр." });

    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.sourceKey, "/illy-decaffeinato-18/#100pc"));
    expect(row).toMatchObject({
      slug: "illy-decaffeinato-kafe-dozi-18-br",
      currentPrice: "9.20",
      weight: "18 бр.",
      weightValue: "18.0000",
      weightUnit: "pc",
      servings: "18.0000",
      servingsEstimated: false,
    });
    expect(row?.sourceData).toMatchObject({
      weightCanonical: "18pc",
      packField: "100 бр.",
      packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." },
    });

    // It is the only one, and every other product keeps its pack field.
    const conflicting = await db
      .select({ sourceKey: products.sourceKey })
      .from(products)
      .where(sql`${products.sourceData}->'packSizeConflict' <> 'null'::jsonb`);
    expect(conflicting).toEqual([{ sourceKey: "/illy-decaffeinato-18/#100pc" }]);
    const bySourceKey = new Map(snapshot.products.map((product) => [product.sourceKey, product]));
    for (const stored of await db
      .select({ sourceKey: products.sourceKey, weight: products.weight })
      .from(products)) {
      if (stored.sourceKey === "/illy-decaffeinato-18/#100pc") continue;
      expect(stored.weight, stored.sourceKey).toBe(bySourceKey.get(stored.sourceKey)?.weight);
    }
  });

  it("gives each product the redirect tests name the old address they ask for", async () => {
    for (const { slug, former } of Object.values(SEEDED_FORMER_SLUGS)) {
      const [row] = await db
        .select({ previousSlugs: products.previousSlugs })
        .from(products)
        .where(eq(products.slug, slug));
      expect(row?.previousSlugs, slug).toContain(former);
    }
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
      .where(eq(products.slug, "amann-la-cascada-kafe-na-zarna-500-g"));
    expect(row?.descriptionTextOverride).toBe(
      productCopy["amann-la-cascada-kafe-na-zarna-500-g"]?.summary,
    );
    // `description_text` is the sync's record of what the source said.
    expect(row?.descriptionText).toBe(
      snapshot.products.find((p) => p.sourceKey === row?.sourceKey)?.descriptionText,
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
      .where(eq(products.slug, "amann-la-cascada-kafe-na-zarna-500-g"));
    await seedReference(db, { snapshot, copy: productCopy, storageDir: storage });
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.slug, "amann-la-cascada-kafe-na-zarna-500-g"));
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

  it("still gives them from a snapshot exported after the products moved", async () => {
    // What `reference:export` will write next: every product at the slug it
    // has now. The seed's reslug then moves nothing, and the old addresses the
    // redirect tests ask for exist only because the seed writes them.
    const current = new Map(
      (await db.select({ sourceKey: products.sourceKey, slug: products.slug }).from(products)).map(
        (row) => [row.sourceKey, row.slug],
      ),
    );
    const exportedLater: ReferenceSnapshotData = {
      ...snapshot,
      products: snapshot.products.map((product) => ({
        ...product,
        slug: current.get(product.sourceKey) ?? product.slug,
      })),
    };
    expect(exportedLater.products.filter((product) => product.slug !== null)).toHaveLength(
      SNAPSHOT.products,
    );
    await db.execute(
      sql`truncate table product_images, product_categories, products, brands, categories, source_sites cascade`,
    );

    await seedReference(db, { snapshot: exportedLater, copy: productCopy, storageDir: storage });

    const deliberate = Object.values(SEEDED_FORMER_SLUGS);
    const withHistory = await db
      .select({ slug: products.slug, previousSlugs: products.previousSlugs })
      .from(products)
      .where(sql`cardinality(${products.previousSlugs}) > 0`)
      .orderBy(products.slug);
    expect(withHistory).toEqual(
      deliberate
        .map(({ slug, former }) => ({ slug, previousSlugs: [former] }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    );

    // And a second run adds none of them twice.
    await seedReference(db, { snapshot: exportedLater, copy: productCopy, storageDir: storage });
    expect(
      await db
        .select({ slug: products.slug, previousSlugs: products.previousSlugs })
        .from(products)
        .where(sql`cardinality(${products.previousSlugs}) > 0`)
        .orderBy(products.slug),
    ).toEqual(withHistory);
  });

  it("refuses to plant an old address on a product that is not there, or over a live one", async () => {
    const [site] = await db
      .select({ id: sourceSites.id })
      .from(sourceSites)
      .where(eq(sourceSites.key, REFERENCE_SOURCE_KEY));
    await expect(
      seedFormerSlugs(db, site!.id, [{ slug: "no-such-product-1-kg", former: "an-old-address" }]),
    ).rejects.toThrow(/no seeded product is at "no-such-product-1-kg"/);
    await expect(
      seedFormerSlugs(db, site!.id, [
        {
          slug: SEEDED_FORMER_SLUGS.beans.slug,
          former: SEEDED_FORMER_SLUGS.capsule.slug,
        },
      ]),
    ).rejects.toThrow(/is the current address of a seeded product/);
  });
});
