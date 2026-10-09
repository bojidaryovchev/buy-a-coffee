import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase, type Database } from "@catalog/db";
import { categories, productCategories, products, sourceSites } from "@catalog/db/schema";

/*
 * `@/lib/db` opens a pool the moment it is imported and throws when there is
 * no `DATABASE_URL`. Without one the module is replaced by an inert stand-in so
 * this file can still load, and every suite below skips itself.
 */
vi.mock("@/lib/db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {} },
);

import { parseCatalogQuery } from "@/lib/catalog/filters";
import {
  BUSINESS_SECTIONS,
  MAX_VENDING_BLENDS,
  getSectionCategory,
  getSectionListing,
  isVendingBlendName,
  listVendingBlends,
} from "@/lib/catalog/vending";

/**
 * Which products the vending page shows, against a real catalog.
 *
 * The naming rule itself is a pure function, tested in `vending.test.ts`.
 * Here are the two layers that need PostgreSQL:
 *
 *  1. the same rule in SQL, read-only, against a real catalog;
 *  2. the category-backed path, which has to *write* a category to prove that
 *     one arriving from the sync shows up with no code change.
 *
 * Both skip cleanly when no database is reachable. Layer 2 is stricter still,
 * because it writes: it runs only against a local server and only when the
 * two section categories do not exist yet, so it can never seed a shared or
 * production catalog, nor delete a category the sync created.
 */

/* --- Database-backed suites --------------------------------------------- */

const databaseUrl = process.env.DATABASE_URL;

async function probe(): Promise<{ reachable: boolean; hasCatalog: boolean }> {
  if (!databaseUrl) return { reachable: false, hasCatalog: false };
  try {
    const { sql, close } = createDatabase({ url: databaseUrl, max: 1, connectTimeoutSeconds: 3 });
    try {
      const [row] = await sql`select count(*)::int as count from products where status = 'active'`;
      return { reachable: true, hasCatalog: Number(row?.count ?? 0) > 0 };
    } finally {
      await close();
    }
  } catch {
    return { reachable: false, hasCatalog: false };
  }
}

function isLocalDatabase(): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(databaseUrl ?? "").hostname);
  } catch {
    return false;
  }
}

const { reachable, hasCatalog } = await probe();

/** The real pool, shared with the code under test. Only touched when reachable. */
async function realDb(): Promise<Database> {
  return (await import("@/lib/db")).db;
}

afterAll(async () => {
  // Without this the pool keeps the Vitest worker alive.
  await globalThis.__catalogDb?.close();
  globalThis.__catalogDb = undefined;
});

describe.skipIf(!reachable || !hasCatalog)("vending blends in the catalog", () => {
  it("selects exactly the products the naming rule accepts", async () => {
    const db = await realDb();
    const all = await db
      .select({ slug: products.slug, name: products.name })
      .from(products)
      .where(eq(products.status, "active"));

    const expected = all
      .filter((product) => isVendingBlendName(product.name))
      .map((product) => product.slug)
      .sort();
    const blends = await listVendingBlends();

    // The SQL rule and the code rule are one rule; this is what holds them together.
    expect(blends.map((blend) => blend.slug).sort()).toEqual(expected);
    expect(expected.length).toBeLessThanOrEqual(MAX_VENDING_BLENDS);
  });

  it("finds the Elia Vending line in the mirrored catalog", async () => {
    const names = (await listVendingBlends()).map((blend) => blend.name);

    expect(names).toEqual([
      "Кафе на зърна Elia Vending Aroma 1кг.",
      "Кафе на зърна Elia Vending Crema 1кг.",
      "Кафе на зърна Elia Vending Intenso 1кг.",
    ]);
  });

  it("leaves out coffees that merely suit automatic machines", async () => {
    const db = await realDb();
    // By our own slug, which is frozen. The source key is the source's to
    // rename, and it has.
    const [vandino] = await db
      .select({ slug: products.slug })
      .from(products)
      .where(eq(products.slug, "kafe-na-zarna-vandino-espresso-aroma-1kg"));
    expect(vandino, "the catalog copy should hold this product").toBeDefined();

    const slugs = (await listVendingBlends()).map((blend) => blend.slug);
    expect(slugs).not.toContain(vandino?.slug);
  });

  it("returns cards that are complete enough to sell from", async () => {
    for (const blend of await listVendingBlends()) {
      expect(blend.availability).toBeDefined();
      // Exact decimal string, never a float.
      if (blend.price) expect(blend.price.amount).toMatch(/^\d+\.\d{2}$/);
      // A card carries what a card draws, and not the product page's extras.
      expect(blend).not.toHaveProperty("descriptionHtml");
      expect(blend).not.toHaveProperty("status");
    }
  });
});

const sectionKeys = Object.values(BUSINESS_SECTIONS).flatMap((section) => [
  ...section.categoryKeys,
]);

async function sectionCategoriesExist(): Promise<boolean> {
  if (!reachable) return false;
  const db = await realDb();
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(inArray(categories.sourceKey, sectionKeys));
  const bySlug = await db
    .select({ id: categories.id })
    .from(categories)
    .where(inArray(categories.slug, sectionKeys));
  return rows.length + bySlug.length > 0;
}

const alreadySynced = await sectionCategoriesExist();

describe.skipIf(!reachable || !hasCatalog || alreadySynced)(
  "sections before the source lists anything",
  () => {
    it("have no category and therefore no listing", async () => {
      const query = parseCatalogQuery({});
      expect(await getSectionCategory("vending")).toBeNull();
      expect(await getSectionCategory("consumables")).toBeNull();
      expect(await getSectionListing("vending", query)).toBeNull();
      expect(await getSectionListing("consumables", query)).toBeNull();
    });
  },
);

describe.skipIf(!reachable || !hasCatalog || alreadySynced || !isLocalDatabase())(
  "sections once the sync delivers their categories",
  () => {
    const query = parseCatalogQuery({});
    const seeded: string[] = [];
    let vendingBlendSlug = "";
    let otherSlug = "";

    beforeAll(async () => {
      const db = await realDb();
      const [site] = await db.select({ id: sourceSites.id }).from(sourceSites).limit(1);
      if (!site) throw new Error("catalog has products but no source site");

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
      const blend = active.find((product) => isVendingBlendName(product.name));
      const other = active.find((product) => !isVendingBlendName(product.name));
      if (!blend || !other) throw new Error("catalog copy lacks the products this test needs");
      vendingBlendSlug = blend.slug;
      otherSlug = other.slug;

      // Only the vending category gets products; consumables stays empty.
      await db.insert(productCategories).values([
        { productId: blend.id, categoryId: vendingCategory.id },
        { productId: other.id, categoryId: vendingCategory.id },
      ]);
    });

    afterAll(async () => {
      if (seeded.length === 0) return;
      const db = await realDb();
      // `product_categories` rows go with the category (ON DELETE CASCADE).
      await db.delete(categories).where(inArray(categories.id, seeded));
    });

    it("resolves each section to its category by source key", async () => {
      expect(await getSectionCategory("vending")).toEqual({
        slug: "vending-zona",
        name: "Вендинг Зона",
        productCount: 2,
      });
      expect(await getSectionCategory("consumables")).toEqual({
        slug: "konsumativi",
        name: "Консумативи",
        productCount: 0,
      });
    });

    it("lists the category's products on the vending page", async () => {
      const listing = await getSectionListing("vending", query);

      expect(listing?.result.total).toBe(2);
      expect(listing?.result.items.map((item) => item.slug).sort()).toEqual(
        [vendingBlendSlug, otherSlug].sort(),
      );
    });

    it("keeps filtering inside the section", async () => {
      const listing = await getSectionListing("vending", parseCatalogQuery({ sort: "name-desc" }));
      const names = listing?.result.items.map((item) => item.name) ?? [];

      expect(names).toHaveLength(2);
      expect([...names].sort((a, b) => b.localeCompare(a, "bg"))).toEqual(names);
    });

    it("does not show a blend twice once the category lists it", async () => {
      const blends = (await listVendingBlends()).map((blend) => blend.slug);

      expect(blends).not.toContain(vendingBlendSlug);
      // The other blends are untouched.
      expect(blends).toHaveLength(2);
    });

    it("treats a category with nothing on sale as no listing at all", async () => {
      expect(await getSectionListing("consumables", query)).toBeNull();
    });

    it("ignores a category the sync has retired", async () => {
      const db = await realDb();
      const retire = (status: "active" | "removed") =>
        db
          .update(categories)
          .set({ status })
          .where(and(eq(categories.sourceKey, "vending-zona"), inArray(categories.id, seeded)));

      await retire("removed");
      try {
        expect(await getSectionCategory("vending")).toBeNull();
        expect(await getSectionListing("vending", query)).toBeNull();
        // And the blend it used to list is back among the blends.
        expect((await listVendingBlends()).map((blend) => blend.slug)).toContain(vendingBlendSlug);
      } finally {
        await retire("active");
      }
    });
  },
);
