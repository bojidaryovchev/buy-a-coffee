import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { brands, categories, productCategories, products, sourceSites } from "@catalog/db/schema";
import { discriminatedSlug } from "@catalog/shared";
import { applyReslug, planReslug } from "../scripts/catalog-reslug-lib";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * `catalog:reslug` against a real database: the plan it reads, the write, and
 * the second run that must find nothing to do.
 *
 * The plan's own rules are unit-tested where they live
 * (`packages/shared/test/product-slug.test.ts`) and the two-routes proof is in
 * `packages/scraper-core/test/slugRoutes.test.ts`. This is the part only a
 * database can show: what is read back from the rows, the unique index, and
 * `previous_slugs`.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

suite("catalog:reslug (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let siteId: string;
  let lavazzaId: string;
  let beansId: string;
  let dolceGustoId: string;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("catalog_reslug"));
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table source_sites restart identity cascade`);
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "reslug-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
    const [lavazza] = await db
      .insert(brands)
      .values({ sourceSiteId: siteId, sourceKey: "lavazza", name: "LAVAZZA", slug: "lavazza" })
      .returning({ id: brands.id });
    lavazzaId = lavazza!.id;
    const inserted = await db
      .insert(categories)
      .values([
        {
          sourceSiteId: siteId,
          sourceKey: "kafe-na-zyrna",
          name: "Кафе на зърна",
          slug: "kafe-na-zarna",
        },
        {
          sourceSiteId: siteId,
          sourceKey: "dolce-gusto",
          name: "Dolce Gusto",
          slug: "dolce-gusto",
        },
      ])
      .returning({ id: categories.id, sourceKey: categories.sourceKey });
    beansId = inserted.find((row) => row.sourceKey === "kafe-na-zyrna")!.id;
    dolceGustoId = inserted.find((row) => row.sourceKey === "dolce-gusto")!.id;
  });

  async function add(input: {
    sourceKey: string;
    name: string;
    slug: string;
    categoryId?: string;
    brandId?: string | null;
    weight?: [string, string] | null;
    status?: "active" | "removed";
  }): Promise<string> {
    const [row] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceKey: input.sourceKey,
        sourceUrl: `https://example.test${input.sourceKey}`,
        sourcePath: input.sourceKey,
        name: input.name,
        slug: input.slug,
        brandId: input.brandId === undefined ? lavazzaId : input.brandId,
        weightValue: input.weight === null ? null : (input.weight?.[0] ?? "1000"),
        weightUnit: input.weight === null ? null : (input.weight?.[1] ?? "g"),
        status: input.status ?? "active",
        semanticHash: input.sourceKey,
      })
      .returning({ id: products.id });
    await db
      .insert(productCategories)
      .values({ productId: row!.id, categoryId: input.categoryId ?? beansId, isPrimary: true });
    return row!.id;
  }

  const read = async () =>
    Object.fromEntries(
      (
        await db
          .select({
            sourceKey: products.sourceKey,
            slug: products.slug,
            previousSlugs: products.previousSlugs,
            searchName: products.searchName,
          })
          .from(products)
          .where(eq(products.sourceSiteId, siteId))
      ).map((row) => [row.sourceKey, row]),
    );

  it("plans without writing, then moves each product and remembers where it was", async () => {
    await add({
      sourceKey: "/lavazza-super-crema-1/#1000g",
      name: "Кафе на зърна Lavazza Super Crema 1кг.",
      slug: "kafe-na-zarna-lavazza-super-crema-1kg",
    });
    await add({
      sourceKey: "/dg-lavazza-forte-16/#16pc",
      name: "Капсули DG Lavazza Forte 16 бр.",
      slug: "kapsuli-dg-lavazza-forte-16-br",
      categoryId: dolceGustoId,
      weight: ["16", "pc"],
    });

    const plan = await planReslug(db);
    expect(plan.moves.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: "kapsuli-dg-lavazza-forte-16-br", to: "lavazza-forte-kapsuli-dolce-gusto-16-br" },
      {
        from: "kafe-na-zarna-lavazza-super-crema-1kg",
        to: "lavazza-super-crema-kafe-na-zarna-1-kg",
      },
    ]);
    // Planning wrote nothing.
    expect((await read())["/lavazza-super-crema-1/#1000g"]?.slug).toBe(
      "kafe-na-zarna-lavazza-super-crema-1kg",
    );

    expect(await applyReslug(db, plan)).toBe(2);
    expect(await read()).toEqual({
      "/lavazza-super-crema-1/#1000g": {
        sourceKey: "/lavazza-super-crema-1/#1000g",
        slug: "lavazza-super-crema-kafe-na-zarna-1-kg",
        previousSlugs: ["kafe-na-zarna-lavazza-super-crema-1kg"],
        searchName: "Lavazza Super Crema",
      },
      "/dg-lavazza-forte-16/#16pc": {
        sourceKey: "/dg-lavazza-forte-16/#16pc",
        slug: "lavazza-forte-kapsuli-dolce-gusto-16-br",
        previousSlugs: ["kapsuli-dg-lavazza-forte-16-br"],
        searchName: "Lavazza Forte",
      },
    });
  });

  it("changes nothing the second time", async () => {
    await add({
      sourceKey: "/lavazza-super-crema-1/#1000g",
      name: "Кафе на зърна Lavazza Super Crema 1кг.",
      slug: "kafe-na-zarna-lavazza-super-crema-1kg",
    });
    await applyReslug(db, await planReslug(db));
    const after = await read();

    const again = await planReslug(db);
    expect(again.moves).toEqual([]);
    expect(again.renames).toEqual([]);
    expect(await applyReslug(db, again)).toBe(0);
    expect(await read()).toEqual(after);
  });

  it("leaves a product the sync already named alone, and moves the rest around it", async () => {
    // Production after the catch-up sync: one product created by the new
    // generator, one still under its old slug.
    await add({
      sourceKey: "/lavazza-top-class-1/#1000g",
      name: "Кафе на зърна Lavazza Top Class 1кг.",
      slug: "lavazza-top-class-kafe-na-zarna-1-kg",
    });
    await add({
      sourceKey: "/lavazza-super-crema-1/#1000g",
      name: "Кафе на зърна Lavazza Super Crema 1кг.",
      slug: "kafe-na-zarna-lavazza-super-crema-1kg",
    });
    const plan = await planReslug(db);
    expect(plan.moves.map((move) => move.sourceKey)).toEqual(["/lavazza-super-crema-1/#1000g"]);
    await applyReslug(db, plan);
    expect((await read())["/lavazza-top-class-1/#1000g"]?.previousSlugs).toEqual([]);
  });

  it("gives two products with one name a slug each, from their own source keys", async () => {
    const twin = { name: "Кафе на зърна Lavazza Tierra 1кг." };
    await add({ ...twin, sourceKey: "/lavazza-tierra-1/#1000g", slug: "old-a" });
    await add({ ...twin, sourceKey: "/lavazza-tierra-bio-1/#1000g", slug: "old-b" });
    await applyReslug(db, await planReslug(db));
    const rows = await read();
    const base = "lavazza-tierra-kafe-na-zarna-1-kg";
    expect(rows["/lavazza-tierra-1/#1000g"]?.slug).toBe(
      discriminatedSlug(base, "/lavazza-tierra-1/#1000g"),
    );
    expect(rows["/lavazza-tierra-bio-1/#1000g"]?.slug).toBe(
      discriminatedSlug(base, "/lavazza-tierra-bio-1/#1000g"),
    );
  });

  it("leaves a slug another product is on to that product, and settles in one run", async () => {
    // B sits on the slug A would be planned into, and B is moving away. The
    // address was B's, so it must keep leading to B: A gets a slug of its own.
    await add({
      sourceKey: "/lavazza-super-crema-1/#1000g",
      name: "Кафе на зърна Lavazza Super Crema 1кг.",
      slug: "kafe-na-zarna-lavazza-super-crema-1kg",
    });
    await add({
      sourceKey: "/lavazza-top-class-1/#1000g",
      name: "Кафе на зърна Lavazza Top Class 1кг.",
      slug: "lavazza-super-crema-kafe-na-zarna-1-kg",
    });
    await applyReslug(db, await planReslug(db));
    const rows = await read();
    expect(rows["/lavazza-super-crema-1/#1000g"]?.slug).toBe(
      discriminatedSlug("lavazza-super-crema-kafe-na-zarna-1-kg", "/lavazza-super-crema-1/#1000g"),
    );
    expect(rows["/lavazza-top-class-1/#1000g"]).toMatchObject({
      slug: "lavazza-top-class-kafe-na-zarna-1-kg",
      previousSlugs: ["lavazza-super-crema-kafe-na-zarna-1-kg"],
    });
    expect((await planReslug(db)).moves).toEqual([]);
  });

  it("refuses a product a category's address, and moves removed products too", async () => {
    // No brand, and a name that slugifies to the beans listing's stored slug.
    await add({
      sourceKey: "/odd/",
      name: "Kafe na zarna",
      slug: "old-odd",
      brandId: null,
      weight: null,
      status: "removed",
    });
    await db.delete(productCategories);
    await applyReslug(db, await planReslug(db));
    expect((await read())["/odd/"]?.slug).toBe(discriminatedSlug("kafe-na-zarna", "/odd/"));
  });
});
