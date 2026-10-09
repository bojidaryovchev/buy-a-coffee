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

import {
  getLanding,
  getLandingAvailability,
  getSystemListing,
} from "@/lib/catalog/landing-queries";
import { CHEAPEST_PER_SYSTEM, LANDING_IDS } from "@/lib/catalog/landings";
import { getJournalFigures } from "@/lib/catalog/journal-queries";
import { countPromotions } from "@/lib/catalog/queries";
import { getListingFacts } from "@/lib/catalog/listing-facts";
import { parseCatalogQuery } from "@/lib/catalog/filters";
import { listProducts } from "@/lib/catalog/queries";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";

/**
 * The landing listings against a real catalog, read-only.
 *
 * The selection rules are pure and tested exhaustively in `landings.test.ts`.
 * What needs PostgreSQL is that the rows those rules are handed are the
 * catalog's, and that what a landing shows agrees with what the ordinary
 * listings show for the same products: the same decaf flag the filter reads,
 * the same per-cup order the sort gives.
 *
 * Counts are compared with the catalog's own, never with a number typed here,
 * so the suite holds for any catalog. It skips cleanly when none is reachable.
 */

const databaseUrl = process.env.DATABASE_URL;

async function activeProducts(): Promise<number> {
  if (!databaseUrl) return 0;
  try {
    const { sql, close } = createDatabase({ url: databaseUrl, max: 1, connectTimeoutSeconds: 3 });
    try {
      const [row] = await sql`select count(*)::int as count from products where status = 'active'`;
      return Number(row?.count ?? 0);
    } finally {
      await close();
    }
  } catch {
    return 0;
  }
}

const hasCatalog = (await activeProducts()) > 0;

/** Everything a listing query returns, on one page. */
const everything = (params: Record<string, string>) =>
  parseCatalogQuery({ ...params, pageSize: "96" });

describe.skipIf(!hasCatalog)("the landing listings, against the catalog", () => {
  let availability: Awaited<ReturnType<typeof getLandingAvailability>>;

  beforeAll(async () => {
    availability = await getLandingAvailability();
  });

  it("agrees with itself: a landing exists exactly when it draws a card", async () => {
    for (const id of LANDING_IDS) {
      const view = await getLanding(id);
      expect(view.count).toBe(availability.counts[id]);
      expect(view.groups.map((group) => group.key)).toEqual(availability.groups[id]);
      for (const group of view.groups) expect(group.products.length).toBeGreaterThan(0);
    }
  });

  it("lists as decaf exactly what the listings' decaf filter finds in each system", async () => {
    const view = await getLanding("decaf");
    for (const system of BREWING_SYSTEMS) {
      const filtered = await listProducts({
        query: everything({ decaf: "yes", system: system.id }),
        includeFacets: false,
      });
      const group = view.groups.find((entry) => entry.key === system.id);
      expect(new Set(group?.products.map((product) => product.slug) ?? [])).toEqual(
        new Set(filtered.items.map((product) => product.slug)),
      );
    }
  });

  it("lists Lavazza's capsules and beans as the brand's own listing has them", async () => {
    const slug = availability.lavazzaBrandSlug;
    if (!slug) return;

    for (const [id, method] of [
      ["lavazzaCapsules", "capsule"],
      ["lavazzaBeans", "beans"],
    ] as const) {
      const systems = BREWING_SYSTEMS.filter((system) => system.method === method);
      const listed = await listProducts({
        query: everything({ system: systems.map((system) => system.id).join(",") }),
        brandSlug: slug,
        includeFacets: false,
      });
      const view = await getLanding(id);
      expect(
        new Set(view.groups.flatMap((group) => group.products.map((product) => product.slug))),
      ).toEqual(new Set(listed.items.map((product) => product.slug)));
      for (const group of view.groups) {
        for (const product of group.products) {
          expect(product.systemId).toBe(group.key);
          expect(product.brand?.slug).toBe(slug);
        }
      }
    }
  });

  it("shows as cheapest the head of each system's own price-per-cup sort", async () => {
    const view = await getLanding("cheapest");
    expect(view.groups.length).toBeGreaterThan(0);

    for (const group of view.groups) {
      expect(group.products.length).toBeLessThanOrEqual(CHEAPEST_PER_SYSTEM);
      expect(group.products.length).toBe(Math.min(CHEAPEST_PER_SYSTEM, group.poolSize));

      const sorted = await listProducts({
        query: everything({ system: group.key, sort: "price-per-cup" }),
        includeFacets: false,
      });
      const orderable = sorted.items.filter(
        (product) => product.availability !== "out_of_stock" && product.servingPrice !== null,
      );
      /*
       * The printed per-cup prices, not the slugs: two products at one price
       * may be ordered either way by a database collation, and either is a
       * true answer to "the three cheapest".
       */
      expect(group.products.map((product) => product.servingPrice?.formatted)).toEqual(
        orderable.slice(0, group.products.length).map((product) => product.servingPrice?.formatted),
      );
      for (const product of group.products) expect(product.systemId).toBe(group.key);
    }
  });

  it("lists a system's whole shelf for the Tchibo page, cheapest per cup first", async () => {
    const view = await getSystemListing("caffitaly");
    const shelf = await listProducts({
      query: everything({ system: "caffitaly", sort: "price-per-cup" }),
      includeFacets: false,
    });
    expect(view.count).toBe(shelf.total);
    expect(
      view.groups.flatMap((group) => group.products).map((p) => p.servingPrice?.formatted),
    ).toEqual(shelf.items.map((product) => product.servingPrice?.formatted));
  });

  it("tells the journal a landing exists exactly when the landing's route does", async () => {
    // An article links a landing only while `figures.landings` says it is
    // there; that has to be the answer the route 404s on, not a second one.
    const { landings, cupCost } = await getJournalFigures();
    for (const id of LANDING_IDS) {
      expect(landings[id], id).toBe(availability.counts[id] > 0);
    }
    // And the read behind it did not cost the article its own figures.
    expect(cupCost).not.toBeNull();
  });

  it("counts promotions for the sitemap as the promotions page counts them", async () => {
    // The page is `noindex` on `getListingFacts`; the sitemap and `llms.txt`
    // list it on `countPromotions`. One page, one answer.
    const facts = await getListingFacts({ kind: "promotions" });
    expect(await countPromotions()).toBe(facts.productCount);
  });
});
