import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createDatabase, type Database } from "@catalog/db";
import { categories, products } from "@catalog/db/schema";

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
 * Here is the same rule in SQL, against a real catalog, and what the sections
 * show while the source lists nothing under them.
 *
 * **Read-only, like every `*.db.test.ts`.** The catalog in `DATABASE_URL` is
 * shared with every other such file, running in parallel. The category-backed
 * path has to *write* a category to prove that one arriving from the sync
 * shows up with no code change, so it lives in a database of its own:
 * `vending-sections.integration.test.ts`. It used to be here, and for the
 * seconds its two categories existed other files read a catalog that was not
 * the catalog.
 *
 * Everything skips cleanly when no database is reachable.
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

  it("shows every coffee its maker calls Vending, whoever the maker is", async () => {
    // The rule is the maker's own word on the bag, not a list of brands: the
    // catalog has carried Elia's three blends since August and Moreno's two
    // since 16 October, and a third maker's would arrive the same way.
    const blends = await listVendingBlends();
    expect(blends.length).toBeGreaterThan(0);
    for (const blend of blends) {
      expect(blend.title ?? blend.name).toMatch(/(?:^|\s)Vending(?:\s|$)/u);
      // Roasted coffee for a machine, never a tin of instant.
      expect(blend.kind).toBe("roasted");
    }
  });

  it("leaves out coffees that merely suit automatic machines", async () => {
    const db = await realDb();
    // By our own slug, which is frozen. The source key is the source's to
    // rename, and it has.
    const [vandino] = await db
      .select({ slug: products.slug })
      .from(products)
      .where(eq(products.slug, "vandino-espresso-aroma-kafe-na-zarna-1-kg"));
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

describe.skipIf(!reachable || !hasCatalog || !alreadySynced)(
  "the vending section's own category",
  () => {
    it("lists what the category holds, and counts the instant coffee in it by name", async () => {
      const listing = await getSectionListing("vending", parseCatalogQuery({}));
      expect(listing, "the source lists products under its vending section").not.toBeNull();
      const items = listing!.result.items;
      expect(listing!.contents?.products).toBe(listing!.result.total);
      expect(listing!.contents?.instant).toBe(
        items.filter((item) => item.kind === "instant").length,
      );
      for (const item of items.filter((each) => each.kind === "instant")) {
        // In no brewing system, and a cup counted at instant coffee's dose.
        expect(item.systemId, item.slug).toBeNull();
        expect(item.detail, item.slug).toMatch(/^Разтворимо кафе, /u);
        expect(item.servingPrice?.estimated, item.slug).toBe(true);
        expect(item.servingPrice?.assumption, item.slug).toBe(
          "Изчислено при 2 г разтворимо кафе на чаша.",
        );
      }
    });
  },
);
