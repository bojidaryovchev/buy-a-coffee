import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { categories, productCategories, products, sourceSites } from "@catalog/db/schema";
import { parseCatalogQuery } from "@/lib/catalog/filters";
// Types only: the module is imported in `beforeAll`, once the test database
// has been chosen, because `@/lib/db` reads `DATABASE_URL` when first imported.
import type * as Vending from "@/lib/catalog/vending";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * The category-backed path of the two business sections: a category arriving
 * from the sync shows up on the page with no code change.
 *
 * Proving that means *writing* a category, so this runs in a database of its
 * own. It used to live in `vending.db.test.ts` and write its two categories
 * into the catalog in `DATABASE_URL`, deleting them afterwards — while every
 * other `*.db.test.ts` file, in a parallel worker, was reading that catalog.
 * For as long as the rows existed a brand had a category it does not have,
 * and whichever test happened to look just then failed, once in a while and
 * never twice. `*.db.test.ts` files read the shared catalog and nothing else
 * (`vitest.shared.ts`); a test that writes builds its own, like this.
 *
 * The read-only half — the naming rule against the real catalog — is still in
 * `vending.db.test.ts`.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

/** A small catalog: the three blends the roaster sells as "Vending", and one coffee that is not. */
const CATALOG = [
  { slug: "elia-vending-aroma-kafe-na-zarna-1-kg", name: "Кафе на зърна Elia Vending Aroma 1кг." },
  { slug: "elia-vending-crema-kafe-na-zarna-1-kg", name: "Кафе на зърна Elia Vending Crema 1кг." },
  {
    slug: "elia-vending-intenso-kafe-na-zarna-1-kg",
    name: "Кафе на зърна Elia Vending Intenso 1кг.",
  },
  {
    slug: "lavazza-super-crema-kafe-na-zarna-1-kg",
    name: "Кафе на зърна Lavazza Super Crema 1кг.",
  },
] as const;

suite("sections once the sync delivers their categories (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let vending: typeof Vending;
  const query = parseCatalogQuery({});
  const seeded: string[] = [];
  let vendingBlendSlug = "";
  let otherSlug = "";

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("vending_sections"));
    // Private to this file, but may hold rows from an earlier run.
    await db.execute(sql`truncate table source_sites restart identity cascade`);
    vending = await import("@/lib/catalog/vending");

    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "vending-sections-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    if (!site) throw new Error("seed failed: source site");

    await db.insert(products).values(
      CATALOG.map((product) => ({
        sourceSiteId: site.id,
        sourceKey: `/${product.slug}/`,
        sourceUrl: `https://example.test/${product.slug}/`,
        sourcePath: `/${product.slug}/`,
        name: product.name,
        slug: product.slug,
        currentPrice: "20.00",
        currency: "EUR",
        availability: "in_stock" as const,
        weight: "1 кг.",
        weightValue: "1000",
        weightUnit: "g",
        servings: "142.8571",
        servingsEstimated: true,
        semanticHash: product.slug,
        status: "active" as const,
      })),
    );

    // Before the source lists anything, a section has no category and no listing.
    expect(await vending.getSectionCategory("vending")).toBeNull();
    expect(await vending.getSectionListing("vending", query)).toBeNull();
    expect(await vending.listVendingBlends()).toHaveLength(3);

    // What the sync would write: the source's own keys, and its labels.
    const inserted = await db
      .insert(categories)
      .values([
        {
          sourceSiteId: site.id,
          sourceKey: "vending-zona",
          name: "Вендинг Зона",
          slug: "vending-zona",
          position: 90,
        },
        {
          sourceSiteId: site.id,
          sourceKey: "konsumativi",
          name: "Консумативи",
          slug: "konsumativi",
          position: 91,
        },
      ])
      .returning({ id: categories.id, sourceKey: categories.sourceKey });
    seeded.push(...inserted.map((row) => row.id));

    const vendingCategory = inserted.find((row) => row.sourceKey === "vending-zona");
    if (!vendingCategory) throw new Error("seed failed");

    const active = await db
      .select({ id: products.id, slug: products.slug, name: products.name })
      .from(products)
      .where(eq(products.status, "active"))
      .orderBy(products.name);
    const blend = active.find((product) => vending.isVendingBlendName(product.name));
    const other = active.find((product) => !vending.isVendingBlendName(product.name));
    if (!blend || !other) throw new Error("the seeded catalog lacks the products this test needs");
    vendingBlendSlug = blend.slug;
    otherSlug = other.slug;

    // Only the vending category gets products; consumables stays empty.
    await db.insert(productCategories).values([
      { productId: blend.id, categoryId: vendingCategory.id },
      { productId: other.id, categoryId: vendingCategory.id },
    ]);
  });

  afterAll(async () => {
    // Without this the storefront's pool keeps the Vitest worker alive.
    await globalThis.__catalogDb?.close();
    globalThis.__catalogDb = undefined;
    await close?.();
  });

  it("resolves each section to its category by source key", async () => {
    expect(await vending.getSectionCategory("vending")).toEqual({
      slug: "vending-zona",
      name: "Вендинг Зона",
      productCount: 2,
    });
    expect(await vending.getSectionCategory("consumables")).toEqual({
      slug: "konsumativi",
      name: "Консумативи",
      productCount: 0,
    });
  });

  it("lists the category's products on the vending page", async () => {
    const listing = await vending.getSectionListing("vending", query);

    expect(listing?.result.total).toBe(2);
    expect(listing?.result.items.map((item) => item.slug).sort()).toEqual(
      [vendingBlendSlug, otherSlug].sort(),
    );
  });

  it("keeps filtering inside the section", async () => {
    const listing = await vending.getSectionListing(
      "vending",
      parseCatalogQuery({ sort: "name-desc" }),
    );
    const names = listing?.result.items.map((item) => item.name) ?? [];

    expect(names).toHaveLength(2);
    expect([...names].sort((a, b) => b.localeCompare(a, "bg"))).toEqual(names);
  });

  it("does not show a blend twice once the category lists it", async () => {
    const blends = (await vending.listVendingBlends()).map((blend) => blend.slug);

    expect(blends).not.toContain(vendingBlendSlug);
    // The other blends are untouched.
    expect(blends).toHaveLength(2);
  });

  it("treats a category with nothing on sale as no listing at all", async () => {
    expect(await vending.getSectionListing("consumables", query)).toBeNull();
  });

  it("ignores a category the sync has retired", async () => {
    const retire = (status: "active" | "removed") =>
      db
        .update(categories)
        .set({ status })
        .where(and(eq(categories.sourceKey, "vending-zona"), inArray(categories.id, seeded)));

    await retire("removed");
    try {
      expect(await vending.getSectionCategory("vending")).toBeNull();
      expect(await vending.getSectionListing("vending", query)).toBeNull();
      // And the blend it used to list is back among the blends.
      expect((await vending.listVendingBlends()).map((blend) => blend.slug)).toContain(
        vendingBlendSlug,
      );
    } finally {
      await retire("active");
    }
  });
});
