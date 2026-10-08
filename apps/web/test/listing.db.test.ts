import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";
import { createDatabase, type Database } from "@catalog/db";
import { categories, productCategories, products } from "@catalog/db/schema";
import { packServings, pricePerServing } from "@catalog/shared";

/*
 * `@/lib/db` opens a pool the moment it is imported and throws when there is
 * no `DATABASE_URL`. Without a database the module is replaced by an inert
 * stand-in and every suite below is skipped.
 */
vi.mock("@/lib/db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {} },
);

import { parseCatalogQuery, type RawSearchParams } from "@/lib/catalog/filters";
import { toPerServingView } from "@/lib/catalog/format";
import { listProducts, type ListProductsOptions } from "@/lib/catalog/queries";
import type { CatalogFacets, FacetValue } from "@/lib/catalog/types";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";

/**
 * The listing query against the real catalog: the system filter, the facet
 * counts and the price-per-cup order.
 *
 * Read-only. Skipped, not failed, when no database is reachable or the
 * catalog is not the real one — a clean checkout has neither, and a handful
 * of fixture rows would let every assertion here pass vacuously. The cases
 * that need particular rows (a reduction, a missing price) are in
 * `listing-fixtures.integration.test.ts`, which seeds its own database.
 */

type Scope = Omit<ListProductsOptions, "query" | "includeFacets">;

async function probe(): Promise<{ reachable: boolean; hasCatalog: boolean }> {
  const url = process.env.DATABASE_URL;
  if (!url) return { reachable: false, hasCatalog: false };
  const handle = createDatabase({ url, max: 1, connectTimeoutSeconds: 3 });
  try {
    const rows = await handle.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.status, "active"))
      .limit(60);
    return { reachable: true, hasCatalog: rows.length >= 50 };
  } catch {
    return { reachable: false, hasCatalog: false };
  } finally {
    await handle.close();
  }
}

const { reachable, hasCatalog } = await probe();

async function realDb(): Promise<Database> {
  return (await import("@/lib/db")).db;
}

afterAll(async () => {
  // Without this the pool keeps the Vitest worker alive.
  await globalThis.__catalogDb?.close();
  globalThis.__catalogDb = undefined;
});

/** Every result of a listing, across all of its pages, in order. */
async function listAll(scope: Scope, params: RawSearchParams = {}) {
  const first = await listProducts({
    ...scope,
    query: parseCatalogQuery({ ...params, pageSize: "96" }),
    includeFacets: false,
  });
  const items = [...first.items];
  for (let page = 2; page <= first.pageCount; page += 1) {
    const next = await listProducts({
      ...scope,
      query: parseCatalogQuery({ ...params, pageSize: "96", page: String(page) }),
      includeFacets: false,
    });
    items.push(...next.items);
  }
  return { total: first.total, items };
}

const idsOf = (items: readonly { id: string }[]) => items.map((item) => item.id).sort();

/** Active products filed under a system's categories, read without the listing query. */
async function productsInCategoriesOf(systemIds: readonly string[]): Promise<string[]> {
  const db = await realDb();
  const systems = BREWING_SYSTEMS.filter((system) => systemIds.includes(system.id));
  const slugs = systems.flatMap((system) => [...system.categorySlugs]);
  const sourceKeys = systems.flatMap((system) => [...system.categorySourceKeys]);
  const rows = await db
    .selectDistinct({ id: products.id })
    .from(products)
    .innerJoin(productCategories, eq(productCategories.productId, products.id))
    .innerJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(
      and(
        eq(products.status, "active"),
        or(inArray(categories.slug, slugs), inArray(categories.sourceKey, sourceKeys)),
      ),
    );
  return rows.map((row) => row.id).sort();
}

describe.skipIf(!reachable || !hasCatalog)("system filter against the real catalog", () => {
  it("returns, for each system, exactly the products in that system's categories", async () => {
    let nonEmpty = 0;
    for (const system of BREWING_SYSTEMS) {
      const expected = await productsInCategoriesOf([system.id]);
      const listed = await listAll({}, { system: system.id });
      expect(idsOf(listed.items), system.id).toEqual(expected);
      expect(listed.total, system.id).toBe(expected.length);
      if (expected.length > 0) nonEmpty += 1;
    }
    // The catalog holds all seven; a filter that matched nothing would pass above.
    expect(nonEmpty).toBeGreaterThanOrEqual(5);
  });

  it("matches the category page of the same system", async () => {
    const db = await realDb();
    for (const system of BREWING_SYSTEMS) {
      const [category] = await db
        .select({ slug: categories.slug })
        .from(categories)
        .where(
          and(
            eq(categories.status, "active"),
            or(
              inArray(categories.slug, [...system.categorySlugs]),
              inArray(categories.sourceKey, [...system.categorySourceKeys]),
            ),
          ),
        )
        .limit(1);
      if (!category) continue;
      const byCategory = await listAll({ categorySlug: category.slug });
      const bySystem = await listAll({}, { system: system.id });
      expect(idsOf(bySystem.items), system.id).toEqual(idsOf(byCategory.items));
    }
  });

  it("treats several systems as a union", async () => {
    const pair = ["dolce-gusto", "nespresso-original"];
    const listed = await listAll({}, { system: pair.join(",") });
    const expected = await productsInCategoriesOf(pair);
    expect(idsOf(listed.items)).toEqual(expected);

    const one = await listAll({}, { system: pair[0]! });
    const other = await listAll({}, { system: pair[1]! });
    expect(listed.total).toBeGreaterThan(Math.max(one.total, other.total));
    expect(listed.total).toBeLessThanOrEqual(one.total + other.total);
  });

  it("narrows inside a scope and composes with the other filters", async () => {
    const capsules = await listAll({ categorySlug: "kapsuli" });
    const narrowed = await listAll({ categorySlug: "kapsuli" }, { system: "dolce-gusto" });
    const capsuleIds = new Set(idsOf(capsules.items));
    expect(narrowed.total).toBeGreaterThan(0);
    expect(narrowed.total).toBeLessThan(capsules.total);
    expect(narrowed.items.every((item) => capsuleIds.has(item.id))).toBe(true);
    expect(narrowed.items.every((item) => item.systemId === "dolce-gusto")).toBe(true);

    const strong = await listAll(
      { categorySlug: "kapsuli" },
      { system: "dolce-gusto", strength: "strong" },
    );
    const narrowedIds = new Set(idsOf(narrowed.items));
    expect(strong.total).toBeLessThanOrEqual(narrowed.total);
    expect(strong.items.every((item) => narrowedIds.has(item.id))).toBe(true);
  });

  it("shows the badge of the system it was filtered by on every card", async () => {
    for (const system of BREWING_SYSTEMS) {
      const listed = await listAll({}, { system: system.id });
      expect(
        listed.items.every((item) => item.systemId === system.id),
        system.id,
      ).toBe(true);
    }
  });
});

/** The filter each facet value stands for. */
const FACET_PARAMS: ReadonlyArray<readonly [keyof CatalogFacets, string]> = [
  ["systems", "system"],
  ["brands", "brand"],
  ["strengths", "strength"],
  ["decaf", "decaf"],
  ["aromas", "aromas"],
];

const SCOPES: ReadonlyArray<{
  readonly name: string;
  readonly scope: Scope;
  readonly params: RawSearchParams;
}> = [
  { name: "the whole catalog", scope: {}, params: {} },
  { name: "the capsule parent category", scope: { categorySlug: "kapsuli" }, params: {} },
  { name: "a single-system category", scope: { categorySlug: "nespresso" }, params: {} },
  { name: "a brand with several systems", scope: { brandSlug: "lavazza" }, params: {} },
  { name: "search results", scope: {}, params: { q: "lavazza" } },
  { name: "search in Cyrillic", scope: {}, params: { q: "кафе" } },
  // Found through the brand's name, which these products' own names do not repeat.
  { name: "search for a brand by name", scope: {}, params: { q: "lollocafe" } },
];

describe.skipIf(!reachable || !hasCatalog)("facet counts against the real catalog", () => {
  for (const { name, scope, params } of SCOPES) {
    it(`equal the result counts in ${name}`, async () => {
      const { facets, total } = await listProducts({ ...scope, query: parseCatalogQuery(params) });
      expect(total).toBeGreaterThan(0);

      let checked = 0;
      for (const [facetKey, param] of FACET_PARAMS) {
        // On a brand page the brand facet is the page's own brand and is not drawn.
        if (facetKey === "brands" && scope.brandSlug) continue;
        const values: readonly FacetValue[] = facets[facetKey] ?? [];
        for (const facet of values) {
          const narrowed = await listProducts({
            ...scope,
            query: parseCatalogQuery({ ...params, [param]: facet.value }),
            includeFacets: false,
          });
          // No option leads to nothing, and each says how much it leads to.
          expect(facet.count, `${facetKey}=${facet.value}`).toBeGreaterThan(0);
          expect(narrowed.total, `${facetKey}=${facet.value}`).toBe(facet.count);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it("do not change with the filters already chosen", async () => {
    // The stated rule: counted against the scope, so the other options stay reachable.
    const bare = await listProducts({ categorySlug: "kapsuli", query: parseCatalogQuery({}) });
    const filtered = await listProducts({
      categorySlug: "kapsuli",
      query: parseCatalogQuery({
        system: "dolce-gusto",
        strength: "strong",
        sort: "price-per-cup",
      }),
    });
    expect(filtered.facets).toEqual(bare.facets);
  });

  it("offer several systems where a listing spans them, and one where it does not", async () => {
    const at = async (scope: Scope, params: RawSearchParams = {}) =>
      (await listProducts({ ...scope, query: parseCatalogQuery(params) })).facets.systems ?? [];

    expect((await at({})).length).toBeGreaterThan(1);
    expect((await at({ categorySlug: "kapsuli" })).length).toBeGreaterThan(1);
    expect((await at({ brandSlug: "lavazza" })).length).toBeGreaterThan(1);
    expect((await at({}, { q: "lavazza" })).length).toBeGreaterThan(1);

    // A single entry narrows nothing, which is how the panel knows to omit the group.
    expect((await at({ categorySlug: "nespresso" })).map((facet) => facet.value)).toEqual([
      "nespresso-original",
    ]);
    // The capsule parent holds capsule systems only.
    const capsuleSystems = (await at({ categorySlug: "kapsuli" })).map((facet) => facet.value);
    expect(capsuleSystems).not.toContain("beans");
    expect(capsuleSystems).not.toContain("ese-pod");
  });

  it("add up to the listing when every product has exactly one system", async () => {
    const { facets, total } = await listProducts({
      categorySlug: "kapsuli",
      query: parseCatalogQuery({}),
    });
    const sum = (facets.systems ?? []).reduce((count, facet) => count + facet.count, 0);
    expect(sum).toBe(total);
  });
});

describe.skipIf(!reachable || !hasCatalog)("price per cup against the real catalog", () => {
  /** The exact per-cup price the card computes, for every active product. */
  async function perCupById(): Promise<Map<string, string | null>> {
    const db = await realDb();
    const rows = await db
      .select({
        id: products.id,
        price: products.currentPrice,
        override: products.retailPriceOverride,
        weightValue: products.weightValue,
        weightUnit: products.weightUnit,
        servings: products.servings,
        servingsEstimated: products.servingsEstimated,
      })
      .from(products)
      .where(eq(products.status, "active"));
    return new Map(
      rows.map((row) => [
        row.id,
        pricePerServing(row.override ?? row.price, packServings(row.weightValue, row.weightUnit)),
      ]),
    );
  }

  it("stores the same cups per pack the card divides by", async () => {
    const db = await realDb();
    const rows = await db
      .select({
        slug: products.slug,
        weightValue: products.weightValue,
        weightUnit: products.weightUnit,
        servings: products.servings,
        servingsEstimated: products.servingsEstimated,
      })
      .from(products)
      .where(eq(products.status, "active"));

    let withServings = 0;
    for (const row of rows) {
      const computed = packServings(row.weightValue, row.weightUnit);
      // Compared as numbers of the same scale: "16" and "16.0000" are one value.
      expect(row.servings === null ? null : Number(row.servings), row.slug).toBe(
        computed ? Number(Number(computed.exact).toFixed(4)) : null,
      );
      if (computed) {
        expect(row.servingsEstimated, row.slug).toBe(computed.estimated);
        withServings += 1;
      }
    }
    expect(withServings).toBeGreaterThan(50);
  });

  it.each([
    ["the whole catalog", {} as Scope, {} as RawSearchParams],
    ["the capsule parent category", { categorySlug: "kapsuli" }, {}],
    ["a brand", { brandSlug: "lavazza" }, {}],
    ["a filtered search", {}, { q: "lavazza", strength: "strong" }],
  ])("orders %s cheapest cup first, with no figure last", async (_name, scope, params) => {
    const perCup = await perCupById();
    const { items, total } = await listAll(scope, { ...params, sort: "price-per-cup" });
    expect(items).toHaveLength(total);
    expect(total).toBeGreaterThan(1);

    const figures = items.map((item) => perCup.get(item.id) ?? null);
    const firstMissing = figures.indexOf(null);
    const known = firstMissing === -1 ? figures : figures.slice(0, firstMissing);
    // Nothing with a figure comes after something without one.
    expect(figures.slice(known.length).every((figure) => figure === null)).toBe(true);
    for (let index = 1; index < known.length; index += 1) {
      expect(Number(known[index]), items[index]!.slug).toBeGreaterThanOrEqual(
        Number(known[index - 1]),
      );
    }

    // And it is the figure the card prints, not merely one that sorts alike.
    for (const item of items) {
      const exact = perCup.get(item.id) ?? null;
      const shown = toPerServingView(exact, item.price?.currency ?? null, {
        estimated: item.servingPrice?.estimated ?? false,
      });
      expect(item.servingPrice?.formatted ?? null, item.slug).toBe(shown?.formatted ?? null);
    }
  });

  it("has exact ties to break, and breaks equal names by id", async () => {
    const db = await realDb();
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        price: products.currentPrice,
        servings: products.servings,
      })
      .from(products)
      .where(eq(products.status, "active"));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const { items } = await listAll({}, { sort: "price-per-cup" });

    let ties = 0;
    for (let index = 1; index < items.length; index += 1) {
      const previous = byId.get(items[index - 1]!.id)!;
      const current = byId.get(items[index]!.id)!;
      if (previous.price !== current.price || previous.servings !== current.servings) continue;
      ties += 1;
      if (previous.name === current.name) expect(previous.id < current.id).toBe(true);
    }
    // The catalog is full of same-size boxes at one price: ties are the normal
    // case, which is why the order needs a tie-break at all.
    expect(ties).toBeGreaterThan(0);
  });

  it("is stable across pages: every product once, in one order", async () => {
    const whole = await listAll({}, { sort: "price-per-cup" });

    const paged: string[] = [];
    const firstPage = await listProducts({
      query: parseCatalogQuery({ sort: "price-per-cup", pageSize: "12" }),
      includeFacets: false,
    });
    expect(firstPage.pageCount).toBeGreaterThan(3);
    for (let page = 1; page <= firstPage.pageCount; page += 1) {
      const result = await listProducts({
        query: parseCatalogQuery({ sort: "price-per-cup", pageSize: "12", page: String(page) }),
        includeFacets: false,
      });
      paged.push(...result.items.map((item) => item.id));
    }

    expect(new Set(paged).size).toBe(paged.length);
    expect(paged).toHaveLength(whole.total);
    // Twelve at a time or ninety-six at a time, it is the same sequence.
    expect(paged).toEqual(whole.items.map((item) => item.id));

    const again = await listAll({}, { sort: "price-per-cup" });
    expect(again.items.map((item) => item.id)).toEqual(whole.items.map((item) => item.id));
  });

  it.each(["relevance", "price-asc", "price-desc", "newest", "name-asc", "name-desc"])(
    "pages %s without repeating or dropping a product",
    async (sort) => {
      const whole = await listAll({}, { sort });
      const paged: string[] = [];
      for (let page = 1; page <= Math.ceil(whole.total / 12); page += 1) {
        const result = await listProducts({
          query: parseCatalogQuery({ sort, pageSize: "12", page: String(page) }),
          includeFacets: false,
        });
        paged.push(...result.items.map((item) => item.id));
      }
      expect(paged).toEqual(whole.items.map((item) => item.id));
      expect(new Set(paged).size).toBe(whole.total);
    },
  );
});
