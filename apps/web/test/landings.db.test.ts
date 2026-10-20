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
import { isNoCoffee } from "@/lib/catalog/no-coffee";
import { FLAVOURED_COFFEE, NO_COFFEE } from "../content/no-coffee";
import { productCopy } from "../content/product-copy";

/** Every product on sale flagged flavoured, as the no-coffee rule reads it. */
interface Flagged {
  readonly id: string;
  readonly slug: string;
  readonly slugs: readonly string[];
  readonly descriptions: readonly string[];
}

async function flaggedProducts(): Promise<readonly Flagged[]> {
  const { sql, close } = createDatabase({ url: databaseUrl!, max: 1, connectTimeoutSeconds: 3 });
  try {
    const rows = await sql`
      select id, slug, previous_slugs, description_text, description_text_override,
             description_html_override
      from products
      where status = 'active' and lower(attributes->>'aromas') = 'yes'`;
    return rows.map((row) => ({
      id: row.id as string,
      slug: row.slug as string,
      slugs: [row.slug as string, ...((row.previous_slugs as string[] | null) ?? [])],
      descriptions: [
        row.description_text,
        row.description_text_override,
        row.description_html_override,
      ].filter((text): text is string => typeof text === "string"),
    }));
  } finally {
    await close();
  }
}

/** „0,60 € на чаша“ → 0.6. */
const cupFigure = (formatted: string | undefined): number =>
  Number(
    (formatted ?? "")
      .match(/(\d+),(\d+)/)
      ?.slice(1, 3)
      .join(".") ?? Number.NaN,
  );

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

  it("lists as flavoured what the listings' aromas filter finds, less what holds no coffee", async () => {
    const view = await getLanding("flavoured");
    const noCoffee = new Set(
      (await flaggedProducts()).filter((product) => isNoCoffee(product)).map((p) => p.slug),
    );
    for (const system of BREWING_SYSTEMS) {
      const filtered = await listProducts({
        query: everything({ aromas: "yes", system: system.id, sort: "price-per-cup" }),
        includeFacets: false,
      });
      const coffee = filtered.items.filter((product) => !noCoffee.has(product.slug));
      const group = view.groups.find((entry) => entry.key === system.id);
      expect(new Set(group?.products.map((product) => product.slug) ?? []), system.id).toEqual(
        new Set(coffee.map((product) => product.slug)),
      );
      // In the order the per-cup sort gives, by the printed figure (a tie may go either way).
      expect(group?.products.map((product) => product.servingPrice?.formatted) ?? []).toEqual(
        coffee.map((product) => product.servingPrice?.formatted),
      );
      for (const product of group?.products ?? []) expect(product.systemId).toBe(system.id);
    }
    // Every flagged product on sale that stands in a system is listed: none is lost between the two.
    const flagged = await listProducts({
      query: everything({ aromas: "yes" }),
      includeFacets: false,
    });
    const inSystem = flagged.items.filter(
      (product) => product.systemId !== null && !noCoffee.has(product.slug),
    );
    expect(view.count).toBe(inSystem.length);
  });

  /*
   * The owner's decision of 20 October 2026: what holds no coffee stays off
   * the page headed „Ароматизирано кафе“, and its flags stay as they are. The
   * audit behind it is `content/no-coffee.ts`.
   */
  it("audits every flagged product, and lists exactly those the audit found to be coffee", async () => {
    const flagged = await flaggedProducts();
    const audited = new Set([...NO_COFFEE, ...FLAVOURED_COFFEE].map((entry) => entry.slug));
    // A flagged product the audit has not read fails here, before anyone relies on the page.
    expect(flagged.filter((product) => !product.slugs.some((slug) => audited.has(slug)))).toEqual(
      [],
    );

    const view = await getLanding("flavoured");
    const listed = new Set(view.groups.flatMap((group) => group.products.map((p) => p.slug)));
    const coffee = new Set(FLAVOURED_COFFEE.map((entry) => entry.slug));
    // Everything listed is coffee by the audit…
    expect([...listed].filter((slug) => !coffee.has(slug))).toEqual([]);
    // …and every audited coffee on sale is listed: the guard caught none of them.
    const onSale = flagged.filter((product) => coffee.has(product.slug));
    expect(onSale.map((product) => product.slug).filter((slug) => !listed.has(slug))).toEqual([]);
    expect(view.count).toBe(onSale.length);
  });

  it("leaves the drinks without coffee off the page, their flags untouched", async () => {
    const flagged = await flaggedProducts();
    const view = await getLanding("flavoured");
    const listed = new Set(view.groups.flatMap((group) => group.products.map((p) => p.slug)));
    const availability = await getLandingAvailability();
    for (const { slug } of NO_COFFEE) {
      const product = flagged.find((candidate) => candidate.slugs.includes(slug));
      // Still flagged flavoured in the catalog: the page leaves it out, not the record.
      expect(product, slug).toBeDefined();
      expect(isNoCoffee(product!), slug).toBe(true);
      expect(listed.has(product!.slug), slug).toBe(false);
      // Out of the sitemap's date and the existence check too, which read the same members.
      expect(availability.members?.flavoured ?? [], slug).not.toContain(product!.id);
    }
    // The matcha latte and the Mermaid Latte say so in our own copy as well.
    for (const slug of [
      "rema-caffe-matcha-kapsuli-dolce-gusto-16-br",
      "foodness-mermaid-latte-kapsuli-dolce-gusto-10-br",
    ]) {
      const copy = productCopy[slug];
      expect(copy, slug).toBeDefined();
      expect([copy!.summary, ...copy!.body].join(" "), slug).toMatch(/без кафе|вместо кафе/);
    }
  });

  it("prices and counts the page over what is left", async () => {
    const view = await getLanding("flavoured");
    const cards = view.groups.flatMap((group) => group.products);
    const cups = cards.map((card) => cupFigure(card.servingPrice?.formatted));
    expect(cups.every((cup) => Number.isFinite(cup))).toBe(true);
    // The range in the description is the range of the cards drawn, and of nothing left out.
    expect(Number(view.cupRange?.min.amount).toFixed(2)).toBe(Math.min(...cups).toFixed(2));
    expect(Number(view.cupRange?.max.amount).toFixed(2)).toBe(Math.max(...cups).toFixed(2));
    expect(view.count).toBe(cards.length);
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
