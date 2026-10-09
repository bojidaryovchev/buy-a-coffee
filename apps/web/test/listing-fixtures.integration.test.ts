import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { brands, categories, productCategories, products, sourceSites } from "@catalog/db/schema";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";
import type * as NextNavigation from "next/navigation";

// The listing toolbar asks for the App Router, which only exists inside Next.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof NextNavigation>()),
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

import { parseCatalogQuery, type RawSearchParams } from "@/lib/catalog/filters";
import type * as Queries from "@/lib/catalog/queries";
import type * as CategoryScope from "@/app/(site)/[lang]/_lib/category-scope";

/**
 * The listing rules that the live catalog cannot show, against a seeded
 * database of this file's own.
 *
 *  - **Promotions.** The source has no reduced price today, so on the real
 *    catalog `/promotions` only ever renders its empty state. Here a handful
 *    of products carry every shape of old price there is, and the rule is
 *    pinned: on promotion means the old price is genuinely higher than the
 *    price the customer pays.
 *  - **Price per cup** for products with no price, no pack size, or a pack of
 *    zero: last, never an error, in a fixed order.
 *  - **Business-section categories.** The two categories behind `/vending`
 *    and `/consumables` do not exist upstream yet. Seeded here, each must
 *    redirect to its section and stay out of the category index.
 *
 * Skipped when no PostgreSQL server is reachable. The database is created by
 * `useTestDatabase`, never the catalog the storefront reads.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

interface Fixture {
  readonly slug: string;
  readonly name: string;
  readonly price: string | null;
  readonly oldPrice?: string;
  readonly priceOverride?: string;
  readonly oldPriceOverride?: string;
  readonly servings: string | null;
  readonly status?: "active" | "missing" | "removed";
  /** Slug of the fixture category it is filed under. */
  readonly category: string;
}

/*
 * Names are single ASCII words so their order is the same under any
 * collation. Per-cup figures, exact:
 *
 *   golf 0.09 · echo 0.095 · india 0.33 · hotel 0.3333… · juliet 0.34
 *   kilo, kilo, mike 0.50 · alfa 0.90 · charlie 3.33 · foxtrot 4.00
 *   then no figure: xray, yankee, zulu
 */
const FIXTURES: readonly Fixture[] = [
  // --- on promotion ---
  {
    slug: "alfa",
    name: "Alfa",
    price: "9.00",
    oldPrice: "10.00",
    servings: "10",
    category: "nespresso",
  },
  // One cent off: a reduction, however small.
  {
    slug: "charlie",
    name: "Charlie",
    price: "9.99",
    oldPrice: "10.00",
    servings: "3",
    category: "nespresso",
  },
  // No source old price; ours creates the reduction.
  {
    slug: "foxtrot",
    name: "Foxtrot",
    price: "12.00",
    oldPriceOverride: "15.00",
    servings: "3",
    category: "dolce-gusto",
  },
  // Source says "was 20, is 20"; our pinned price is lower.
  {
    slug: "golf",
    name: "Golf",
    price: "20.00",
    oldPrice: "20.00",
    priceOverride: "18.00",
    servings: "200",
    category: "beans-renamed",
  },

  // --- not on promotion ---
  // The trap: as strings "9.00" > "10.00", so a text comparison lists this one.
  {
    slug: "mike",
    name: "Mike",
    price: "10.00",
    oldPrice: "9.00",
    servings: "20",
    category: "nespresso",
  },
  {
    slug: "kilo-1",
    name: "Kilo",
    price: "5.00",
    oldPrice: "5.00",
    servings: "10",
    category: "nespresso",
  },
  { slug: "kilo-2", name: "Kilo", price: "5.00", servings: "10", category: "dolce-gusto" },
  // Source says reduced from 9 to 8; our pinned price of 9.50 is above the old one.
  {
    slug: "echo",
    name: "Echo",
    price: "8.00",
    oldPrice: "9.00",
    priceOverride: "9.50",
    servings: "100",
    category: "dolce-gusto",
  },
  { slug: "hotel", name: "Hotel", price: "1.00", servings: "3", category: "beans-renamed" },
  { slug: "india", name: "India", price: "0.33", servings: "1", category: "beans-renamed" },
  { slug: "juliet", name: "Juliet", price: "0.34", servings: "1", category: "beans-renamed" },

  // --- no per-cup figure ---
  {
    slug: "zulu",
    name: "Zulu",
    price: null,
    oldPrice: "10.00",
    servings: "10",
    category: "nespresso",
  },
  { slug: "yankee", name: "Yankee", price: "3.00", servings: null, category: "nespresso" },
  { slug: "xray", name: "Xray", price: "3.00", servings: "0", category: "nespresso" },

  // --- reduced, but not on sale at all ---
  {
    slug: "gone",
    name: "Gone",
    price: "1.00",
    oldPrice: "2.00",
    servings: "10",
    status: "removed",
    category: "nespresso",
  },
  {
    slug: "unsure",
    name: "Unsure",
    price: "1.00",
    oldPrice: "2.00",
    servings: "10",
    status: "missing",
    category: "nespresso",
  },
];

const ON_PROMOTION = ["alfa", "charlie", "foxtrot", "golf"];
const PER_CUP_ORDER_BY_NAME = [
  "Golf",
  "Echo",
  "India",
  "Hotel",
  "Juliet",
  "Kilo",
  "Kilo",
  "Mike",
  "Alfa",
  "Charlie",
  "Foxtrot",
  "Xray",
  "Yankee",
  "Zulu",
];

suite("listing rules on seeded data (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let queries: typeof Queries;
  let scope: typeof CategoryScope;
  const idBySlug = new Map<string, string>();

  const list = (params: RawSearchParams, options: { promotionsOnly?: boolean } = {}) =>
    queries.listProducts({ query: parseCatalogQuery(params), ...options });
  const slugs = (items: readonly { slug: string }[]) => items.map((item) => item.slug);

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("listing"));
    await db.execute(
      sql`truncate table product_categories, products, categories, brands, source_sites restart identity cascade`,
    );

    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "fixture",
        name: "Fixture",
        baseUrl: "https://fixture.invalid",
        canonicalHost: "fixture.invalid",
      })
      .returning({ id: sourceSites.id });
    if (!site) throw new Error("seed failed: source site");

    const [brand] = await db
      .insert(brands)
      .values({ sourceSiteId: site.id, sourceKey: "acme", name: "Acme", slug: "acme" })
      .returning({ id: brands.id });

    const [capsules] = await db
      .insert(categories)
      .values({
        sourceSiteId: site.id,
        sourceKey: "kafe-kapsuli",
        name: "Кафе капсули",
        slug: "kapsuli",
        position: 1,
      })
      .returning({ id: categories.id });
    if (!brand || !capsules) throw new Error("seed failed: brand or category");

    const seededCategories = await db
      .insert(categories)
      .values([
        {
          sourceSiteId: site.id,
          sourceKey: "nespresso",
          name: "Nespresso",
          slug: "nespresso",
          parentId: capsules.id,
        },
        {
          sourceSiteId: site.id,
          sourceKey: "dolce-gusto",
          name: "Dolce Gusto",
          slug: "dolce-gusto",
          parentId: capsules.id,
        },
        // Renamed upstream: the slug no longer says "beans", the source key still does.
        {
          sourceSiteId: site.id,
          sourceKey: "kafe-na-zyrna",
          name: "Зърна",
          slug: "beans-renamed",
          position: 2,
        },
        // What the sync would write for the two business sections. One is
        // recognisable only by its source key, the other only by its slug.
        {
          sourceSiteId: site.id,
          sourceKey: "vending-zona",
          name: "Вендинг Зона",
          slug: "vending-zona-avtomati",
          position: 90,
        },
        {
          sourceSiteId: site.id,
          sourceKey: "consumables-2026",
          name: "Консумативи",
          slug: "konsumativi",
          position: 91,
        },
      ])
      .returning({ id: categories.id, slug: categories.slug });
    const categoryIdBySlug = new Map(seededCategories.map((row) => [row.slug, row.id]));

    const inserted = await db
      .insert(products)
      .values(
        FIXTURES.map((fixture) => ({
          sourceSiteId: site.id,
          sourceKey: fixture.slug,
          sourceUrl: `https://fixture.invalid/${fixture.slug}`,
          sourcePath: `/${fixture.slug}`,
          name: fixture.name,
          slug: fixture.slug,
          currentPrice: fixture.price,
          oldPrice: fixture.oldPrice ?? null,
          retailPriceOverride: fixture.priceOverride ?? null,
          retailOldPriceOverride: fixture.oldPriceOverride ?? null,
          currency: "EUR",
          availability: "in_stock" as const,
          brandId: brand.id,
          servings: fixture.servings,
          servingsEstimated: fixture.servings === null ? null : false,
          attributes: { strength: "medium", decaf: "no", aromas: "no" },
          semanticHash: `fixture-${fixture.slug}`,
          status: fixture.status ?? ("active" as const),
        })),
      )
      .returning({ id: products.id, slug: products.slug });
    for (const row of inserted) idBySlug.set(row.slug, row.id);

    await db.insert(productCategories).values(
      FIXTURES.map((fixture) => ({
        productId: idBySlug.get(fixture.slug)!,
        categoryId: categoryIdBySlug.get(fixture.category)!,
        isPrimary: true,
      })),
    );
    // The vending category holds something, as it would once the source fills it.
    await db.insert(productCategories).values({
      productId: idBySlug.get("mike")!,
      categoryId: categoryIdBySlug.get("vending-zona-avtomati")!,
    });

    queries = await import("@/lib/catalog/queries");
    scope = await import("@/app/(site)/[lang]/_lib/category-scope");
  });

  afterAll(async () => {
    await globalThis.__catalogDb?.close();
    globalThis.__catalogDb = undefined;
    await close?.();
  });

  describe("promotions", () => {
    it("lists exactly the products whose old price is genuinely higher", async () => {
      const result = await list({ sort: "name-asc" }, { promotionsOnly: true });
      expect(slugs(result.items)).toEqual(ON_PROMOTION);
      expect(result.total).toBe(ON_PROMOTION.length);
    });

    it("does not list a price that went up, which a text comparison would", async () => {
      // "9.00" > "10.00" is true for strings. It must not be true here.
      const result = await list({}, { promotionsOnly: true });
      expect(slugs(result.items)).not.toContain("mike");
    });

    it("compares the prices the customer sees, overrides included", async () => {
      const promoted = slugs((await list({}, { promotionsOnly: true })).items);
      // An old price of our own makes a reduction the source does not have…
      expect(promoted).toContain("foxtrot");
      // …a pinned price below an unchanged source price makes one too…
      expect(promoted).toContain("golf");
      // …and a pinned price above the source's old price unmakes one.
      expect(promoted).not.toContain("echo");
    });

    it("leaves out equal prices, a missing price and a missing old price", async () => {
      const promoted = slugs((await list({}, { promotionsOnly: true })).items);
      expect(promoted).not.toContain("kilo-1");
      expect(promoted).not.toContain("kilo-2");
      expect(promoted).not.toContain("zulu");
    });

    it("leaves out reduced products that are not on sale", async () => {
      const promoted = slugs((await list({}, { promotionsOnly: true })).items);
      expect(promoted).not.toContain("gone");
      expect(promoted).not.toContain("unsure");
    });

    it("agrees with the card: on the page exactly when the card shows a reduction", async () => {
      const everything = await list({ pageSize: "96" });
      const promoted = new Set(slugs((await list({}, { promotionsOnly: true })).items));
      expect(everything.total).toBe(14);

      for (const card of everything.items) {
        const reduced = card.discountPercent !== null;
        expect(reduced, card.slug).toBe(promoted.has(card.slug));
        // A struck-out price is shown only beside a genuine reduction.
        expect(card.oldPrice !== null, card.slug).toBe(reduced);
      }
    });

    it("shows the reduced price, the old price and the saving on the card", async () => {
      const cards = new Map(
        (await list({}, { promotionsOnly: true })).items.map((card) => [card.slug, card]),
      );
      expect(cards.get("alfa")).toMatchObject({
        price: { amount: "9.00" },
        oldPrice: { amount: "10.00" },
        discountPercent: 10,
      });
      expect(cards.get("foxtrot")).toMatchObject({
        price: { amount: "12.00" },
        oldPrice: { amount: "15.00" },
        discountPercent: 20,
      });
      // The override is the price; the source's 20.00 is what it came down from.
      expect(cards.get("golf")).toMatchObject({
        price: { amount: "18.00" },
        oldPrice: { amount: "20.00" },
        discountPercent: 10,
      });
      // Whole percent, rounded down: one cent off ten euro is not "1%".
      expect(cards.get("charlie")?.discountPercent).toBe(0);
    });

    it("counts what it lists", async () => {
      expect(await queries.countPromotions()).toBe(ON_PROMOTION.length);
    });

    it("has facets that describe the promotions, not the catalog", async () => {
      const { facets, total } = await list({}, { promotionsOnly: true });
      expect(facets.systems).toEqual([
        { value: "nespresso-original", label: "Nespresso Original", count: 2 },
        { value: "dolce-gusto", label: "Dolce Gusto", count: 1 },
        { value: "beans", label: "Кафе на зърна", count: 1 },
      ]);
      expect(facets.brands).toEqual([{ value: "acme", label: "Acme", count: total }]);

      for (const facet of facets.systems ?? []) {
        const narrowed = await list({ system: facet.value }, { promotionsOnly: true });
        expect(narrowed.total, facet.value).toBe(facet.count);
      }
    });

    it("filters, sorts and pages like any other listing", async () => {
      const nespresso = await list({ system: "nespresso-original" }, { promotionsOnly: true });
      expect(slugs(nespresso.items).sort()).toEqual(["alfa", "charlie"]);

      const byCup = await list({ sort: "price-per-cup" }, { promotionsOnly: true });
      expect(slugs(byCup.items)).toEqual(["golf", "alfa", "charlie", "foxtrot"]);

      const pageTwo = await list(
        { sort: "price-per-cup", pageSize: "3", page: "2" },
        { promotionsOnly: true },
      );
      expect(slugs(pageTwo.items)).toEqual(["foxtrot"]);
      expect(pageTwo.pageCount).toBe(2);
    });

    it("is empty, not an error, when a filter leaves no promotion", async () => {
      const result = await list({ system: "caffitaly" }, { promotionsOnly: true });
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      // The facets still describe the promotions, so the way back is on the page.
      expect(result.facets.systems?.length).toBe(3);
    });
  });

  describe("system filter by source key", () => {
    it("finds a system whose category slug was renamed upstream", async () => {
      const beans = await list({ system: "beans" });
      expect(slugs(beans.items).sort()).toEqual(["golf", "hotel", "india", "juliet"]);
      expect(beans.items.every((card) => card.systemId === "beans")).toBe(true);
    });
  });

  describe("price per cup", () => {
    it("orders by the displayed price over the stored cups, exactly", async () => {
      const result = await list({ sort: "price-per-cup", pageSize: "96" });
      expect(result.items.map((card) => card.name)).toEqual(PER_CUP_ORDER_BY_NAME);
    });

    it("uses the pinned price, not the source's, when one is set", async () => {
      // By source price echo (8.00 / 100) would be cheaper than golf (20.00 / 200).
      const order = slugs((await list({ sort: "price-per-cup", pageSize: "96" })).items);
      expect(order.indexOf("golf")).toBeLessThan(order.indexOf("echo"));
    });

    it("does not round a third of a euro into a tie", async () => {
      const order = slugs((await list({ sort: "price-per-cup", pageSize: "96" })).items);
      expect(order.slice(2, 5)).toEqual(["india", "hotel", "juliet"]);
    });

    it("puts products with no price, no cups or zero cups last, by name", async () => {
      const order = slugs((await list({ sort: "price-per-cup", pageSize: "96" })).items);
      expect(order.slice(-3)).toEqual(["xray", "yankee", "zulu"]);
    });

    it("breaks an exact tie by name, and equal names by id", async () => {
      const order = slugs((await list({ sort: "price-per-cup", pageSize: "96" })).items);
      const kilos = ["kilo-1", "kilo-2"].sort((a, b) =>
        idBySlug.get(a)! < idBySlug.get(b)! ? -1 : 1,
      );
      expect(order.slice(5, 8)).toEqual([...kilos, "mike"]);
    });

    it("gives the same sequence at any page size", async () => {
      const whole = slugs((await list({ sort: "price-per-cup", pageSize: "96" })).items);
      for (const pageSize of ["1", "2", "5"]) {
        const paged: string[] = [];
        const pages = Math.ceil(whole.length / Number(pageSize));
        for (let page = 1; page <= pages; page += 1) {
          const result = await list({ sort: "price-per-cup", pageSize, page: String(page) });
          paged.push(...slugs(result.items));
        }
        expect(paged, `page size ${pageSize}`).toEqual(whole);
      }
    });
  });

  describe("categories that back a business section", () => {
    it("recognises a section category by source key or by slug", () => {
      expect(
        scope.businessSectionForCategory({
          slug: "vending-zona-avtomati",
          sourceKey: "vending-zona",
        })?.path,
      ).toBe("/kafe-za-vending-mashini");
      expect(
        scope.businessSectionForCategory({ slug: "konsumativi", sourceKey: "consumables-2026" })
          ?.path,
      ).toBe("/konsumativi");
      expect(scope.businessSectionForCategory({ slug: "konsumativi", sourceKey: null })?.path).toBe(
        "/konsumativi",
      );
      expect(
        scope.businessSectionForCategory({ slug: "nespresso", sourceKey: "nespresso" }),
      ).toBeNull();
      expect(scope.businessSectionForCategory({ slug: "vending", sourceKey: null })).toBeNull();
    });

    it("finds both in the catalog once the sync has created them", async () => {
      expect([...(await scope.listBusinessSectionCategorySlugs())].sort()).toEqual([
        "konsumativi",
        "vending-zona-avtomati",
      ]);
    });

    it("permanently redirects a section's category to the section page, in one hop", async () => {
      const { default: SlugPage } = await import("@/app/(site)/[lang]/[slug]/page");
      const visit = (slug: string, searchParams: RawSearchParams = {}) =>
        SlugPage({
          params: Promise.resolve({ lang: "bg", slug }),
          searchParams: Promise.resolve(searchParams),
        });

      // Next signals a redirect by throwing; the digest carries target and status.
      await expect(visit("vending-zona-avtomati")).rejects.toMatchObject({
        digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/bg\/kafe-za-vending-mashini;308;/),
      });
      /* Its stored slug is a route of its own (`konsumativi`), so it is
         published at `konsumativi-kategoriya` — and that, too, goes to the
         section rather than to a second page about the same shelf. */
      await expect(visit("konsumativi-kategoriya")).rejects.toMatchObject({
        digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/bg\/konsumativi;308;/),
      });
      // A filtered link keeps its filters on the way.
      await expect(
        visit("vending-zona-avtomati", { strength: "strong", sort: "price-per-cup" }),
      ).rejects.toMatchObject({
        digest: expect.stringMatching(
          /^NEXT_REDIRECT;[a-z]+;\/bg\/kafe-za-vending-mashini\?strength=strong&sort=price-per-cup;308;/,
        ),
      });
    });

    it("sends a stored slug to the landing slug, filters and all", async () => {
      const { default: SlugPage } = await import("@/app/(site)/[lang]/[slug]/page");
      await expect(
        SlugPage({
          params: Promise.resolve({ lang: "bg", slug: "nespresso" }),
          searchParams: Promise.resolve({ sort: "price-asc" }),
        }),
      ).rejects.toMatchObject({
        digest: expect.stringMatching(
          /^NEXT_REDIRECT;[a-z]+;\/bg\/nespresso-kapsuli\?sort=price-asc;308;/,
        ),
      });
    });

    it("still renders an ordinary category", async () => {
      const { default: SlugPage } = await import("@/app/(site)/[lang]/[slug]/page");
      const html = renderToStaticMarkup(
        await SlugPage({
          params: Promise.resolve({ lang: "bg", slug: "nespresso-kapsuli" }),
          searchParams: Promise.resolve({}),
        }),
      );
      expect(html).toContain('href="/bg/alfa"');
      // A single-system listing names its system above the title.
      expect(html).toMatch(/data-system="nespresso-original"[^>]*>.*Nespresso Original.*<h1/s);
    });

    it("leaves them out of the category index", async () => {
      const tree = await queries.getCategoryTree();
      // They are ordinary categories as far as the catalog is concerned…
      expect(tree.map((category) => category.slug)).toEqual(
        expect.arrayContaining(["vending-zona-avtomati", "konsumativi", "kapsuli"]),
      );

      // …and the index page does not link to them.
      const { default: CategoriesPage } = await import("@/app/(site)/[lang]/kategorii/page");
      const page = renderToStaticMarkup(
        await CategoriesPage({ params: Promise.resolve({ lang: "bg" }) }),
      );
      // By landing slug, through each category's source key.
      expect(page).toContain('href="/bg/kafe-kapsuli"');
      expect(page).toContain('href="/bg/nespresso-kapsuli"');
      expect(page).toContain('href="/bg/kafe-na-zarna"');
      expect(page).not.toContain("vending-zona-avtomati");
      expect(page).not.toContain("konsumativi");
      expect(page).not.toContain("Вендинг Зона");
      expect(page).not.toContain("Консумативи");
    });
  });
});
