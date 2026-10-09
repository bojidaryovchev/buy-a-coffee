import { beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@catalog/db";

/*
 * `@/lib/db` opens a pool the moment it is imported and throws when there is
 * no `DATABASE_URL`. Without one the module is replaced by an inert stand-in so
 * this file can still load, and the suite below skips itself.
 */
vi.mock("@/lib/db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {} },
);

import { cupRangePhrase } from "@/lib/catalog/cup-range";
import { parseCatalogQuery } from "@/lib/catalog/filters";
import { getListingFacts, listCategoryKeysByBrand } from "@/lib/catalog/listing-facts";
import {
  getCatalogSummary,
  getCategoryTree,
  listBrands,
  listProducts,
} from "@/lib/catalog/queries";
import { listBrandCategoryKeys } from "@/lib/catalog/taxonomy";

/**
 * What a meta description quotes, against a real catalog.
 *
 * The arithmetic is covered in `listing-meta.test.ts`. What needs PostgreSQL is
 * the claim the description rests on: **the range is over exactly the products
 * the page lists, and its two ends are figures the cards on that page show.**
 * So each scope is read twice — once through `getListingFacts`, once through
 * `listProducts`, the call the page itself makes — and the two are compared.
 *
 * Read-only, and skipped cleanly when no database is reachable.
 */

const databaseUrl = process.env.DATABASE_URL;

async function hasCatalog(): Promise<boolean> {
  if (!databaseUrl) return false;
  try {
    const { sql, close } = createDatabase({ url: databaseUrl, max: 1, connectTimeoutSeconds: 3 });
    try {
      const [row] = await sql`select count(*)::int as count from products where status = 'active'`;
      return Number(row?.count ?? 0) > 0;
    } finally {
      await close();
    }
  } catch {
    return false;
  }
}

const available = await hasCatalog();

/** Every card of a scope, on one page: the catalog is well under the page-size cap. */
const everything = { ...parseCatalogQuery({}), pageSize: 96 };

/** "≈ 0,12 € на чаша" → "≈ 0,12 €": the figure without its unit. */
const figure = (formatted: string) => formatted.replace(/\s*на чаша$/u, "");

function expectRangeOnCards(
  phrase: string | null,
  cards: ReadonlyArray<{ servingPrice: { formatted: string } | null }>,
): void {
  const shown = cards.flatMap((card) =>
    card.servingPrice ? [figure(card.servingPrice.formatted)] : [],
  );
  if (shown.length === 0) {
    expect(phrase).toBeNull();
    return;
  }
  expect(phrase).not.toBeNull();
  const ends = (phrase as string)
    .replace(/\s*на чаша$/u, "")
    .replace(/^от\s+/u, "")
    .split(/\s+до\s+/u);
  for (const end of ends) expect(shown, `no card shows ${end}`).toContain(end);
}

describe.skipIf(!available)("listing facts against the catalog", () => {
  let tree: Awaited<ReturnType<typeof getCategoryTree>>;
  let brands: Awaited<ReturnType<typeof listBrands>>;

  beforeAll(async () => {
    [tree, brands] = await Promise.all([getCategoryTree(), listBrands({ withProductsOnly: true })]);
  });

  it("counts what a category lists and quotes figures its cards show", async () => {
    const categories = tree.flatMap((category) => [category, ...category.children]);
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      const [facts, listing] = await Promise.all([
        getListingFacts({ kind: "category", slug: category.slug }),
        listProducts({ query: everything, categorySlug: category.slug, includeFacets: false }),
      ]);
      expect(facts.productCount, category.slug).toBe(listing.total);
      // Only when the one page holds the whole listing can its cards be compared.
      if (listing.total <= everything.pageSize) {
        expectRangeOnCards(cupRangePhrase(facts.cupRange), listing.items);
      }
    }
  });

  it("does the same for every brand", async () => {
    expect(brands.length).toBeGreaterThan(0);
    for (const brand of brands) {
      const [facts, listing] = await Promise.all([
        getListingFacts({ kind: "brand", slug: brand.slug }),
        listProducts({ query: everything, brandSlug: brand.slug, includeFacets: false }),
      ]);
      expect(facts.productCount, brand.slug).toBe(brand.productCount);
      expect(facts.productCount, brand.slug).toBe(listing.total);
      expectRangeOnCards(cupRangePhrase(facts.cupRange), listing.items);
    }
  });

  it("reads promotions by the rule the promotions page lists by", async () => {
    const [facts, listing] = await Promise.all([
      getListingFacts({ kind: "promotions" }),
      listProducts({ query: everything, promotionsOnly: true, includeFacets: false }),
    ]);
    expect(facts.productCount).toBe(listing.total);
    if (listing.total === 0) expect(facts.cupRange).toBeNull();
  });

  it("spans the whole catalog for the pages that list all of it", async () => {
    const all = await getListingFacts({ kind: "all" });
    expect(all.productCount).toBe((await getCatalogSummary()).products);
    expect(all.cupRange).not.toBeNull();
    // Beans by weight and capsules by the piece share no pack size.
    expect(all.uniformPieceCount).toBeNull();
  });

  it("reads a hand-picked set by slug, and nothing for an empty one", async () => {
    const some = await listProducts({
      query: { ...everything, pageSize: 3 },
      includeFacets: false,
    });
    const facts = await getListingFacts({
      kind: "products",
      slugs: some.items.map((item) => item.slug),
    });
    expect(facts.productCount).toBe(some.items.length);
    expectRangeOnCards(cupRangePhrase(facts.cupRange), some.items);

    expect(await getListingFacts({ kind: "products", slugs: [] })).toEqual({
      productCount: 0,
      cupRange: null,
      uniformPieceCount: null,
    });
  });

  it("lists each brand's categories as the brand page reads them", async () => {
    const byBrand = await listCategoryKeysByBrand();
    for (const brand of brands) {
      const one = await listBrandCategoryKeys(brand.slug);
      expect(
        [...(byBrand.get(brand.slug) ?? [])].map((entry) => entry.slug).sort(),
        brand.slug,
      ).toEqual(one.map((entry) => entry.slug).sort());
    }
  });
});
