import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "@catalog/db";

/*
 * `@/lib/db` opens a pool the moment it is imported and throws when there is
 * no `DATABASE_URL`. Without one the module is replaced by an inert stand-in so
 * this file can still load, and the suite below skips itself.
 */
vi.mock("@/lib/db", async (importOriginal) =>
  process.env.DATABASE_URL ? await importOriginal() : { db: {} },
);

import { brandFactsFor } from "../content/brand-facts";
import { getBeansSections } from "@/lib/catalog/beans-section-queries";
import { BEANS_SECTION_MAX, BEANS_SECTION_MIN } from "@/lib/catalog/beans-sections";

/**
 * The beans listing's sections against a real catalog, read-only.
 *
 * The rules are pure and tested with fixtures in `beans-sections.test.ts`.
 * What needs PostgreSQL is that what a section lists is, row by row, what the
 * catalog says satisfies its rule — checked here against the products table
 * itself, read with SQL of its own rather than through the code under test —
 * and that the selection is the one the rule gives, not merely a valid one.
 * Nothing is compared with a product typed here, so the suite holds for any
 * catalog that has enough to list. It skips cleanly when none is reachable.
 */

const databaseUrl = process.env.DATABASE_URL;

interface BeanRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly availability: string;
  readonly brand: string | null;
  /** Price for a kilogram, at four decimals, as text. */
  readonly perKg: string | null;
  readonly beans: boolean;
}

/** Every product with its brand, price per kilogram and whether it is filed under beans. */
async function readCatalog(): Promise<readonly BeanRow[]> {
  if (!databaseUrl) return [];
  try {
    const { sql, close } = createDatabase({ url: databaseUrl, max: 1, connectTimeoutSeconds: 3 });
    try {
      const rows = await sql<
        {
          id: string;
          name: string;
          status: string;
          availability: string;
          brand: string | null;
          per_kg: string | null;
          beans: boolean;
        }[]
      >`
        select p.id, p.name, p.status, p.availability::text as availability, b.slug as brand,
          case when p.weight_unit = 'g' and p.weight_value > 0
            then round(coalesce(p.retail_price_override, p.current_price) * 1000 / p.weight_value, 4)::text
          end as per_kg,
          exists (
            select 1 from product_categories pc join categories c on c.id = pc.category_id
            where pc.product_id = p.id
              and (c.source_key = 'kafe-na-zyrna' or c.slug in ('kafe-na-zarna', 'kafe-na-zyrna'))
          ) as beans
        from products p left join brands b on b.id = p.brand_id
      `;
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        availability: row.availability,
        brand: row.brand,
        perKg: row.per_kg,
        beans: row.beans,
      }));
    } finally {
      await close();
    }
  } catch {
    return [];
  }
}

const catalog = await readCatalog();
const hasCatalog = catalog.some((row) => row.status === "active");
const byId = new Map(catalog.map((row) => [row.id, row]));

/** The rows a section may choose from at all: beans on sale with a price per kilogram. */
const eligible = catalog.filter(
  (row) =>
    row.status === "active" &&
    row.beans &&
    row.availability !== "out_of_stock" &&
    row.perKg !== null &&
    !/разтворимо/iu.test(row.name),
);

const isItalian = (row: BeanRow) =>
  row.brand !== null && brandFactsFor({ slug: row.brand }).italian !== undefined;
const isMachineBlend = (row: BeanRow) =>
  /(^|[^\p{L}\p{N}_])vending($|[^\p{L}\p{N}_])/iu.test(row.name);

const cheapestFirst = (a: BeanRow, b: BeanRow) =>
  Number(a.perKg) - Number(b.perKg) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

describe.skipIf(!hasCatalog)("the beans sections, against the catalog", () => {
  it("lists between three and six products in each section it shows", async () => {
    const sections = await getBeansSections();
    for (const section of sections) {
      expect(section.products.length, section.id).toBeGreaterThanOrEqual(BEANS_SECTION_MIN);
      expect(section.products.length, section.id).toBeLessThanOrEqual(BEANS_SECTION_MAX);
    }
  });

  it("lists only active, orderable coffee beans, each satisfying its section's rule", async () => {
    for (const section of await getBeansSections()) {
      for (const { card, perKilogram } of section.products) {
        const row = byId.get(card.id);
        expect(row, card.slug).toBeDefined();
        expect(row!.status, card.slug).toBe("active");
        expect(row!.beans, card.slug).toBe(true);
        expect(row!.availability, card.slug).not.toBe("out_of_stock");
        expect(card.systemId, card.slug).toBe("beans");
        expect(perKilogram, card.slug).toMatch(/^\d+,\d{2}\s€ \/ кг$/u);
        if (section.id === "italian") expect(isItalian(row!), card.slug).toBe(true);
        if (section.id === "automatic") expect(isMachineBlend(row!), card.slug).toBe(true);
      }
    }
  });

  it("lists in each section the selection its rule gives, in that order", async () => {
    const sections = await getBeansSections();
    const listed = (id: string) =>
      sections.find((section) => section.id === id)?.products.map(({ card }) => card.id) ?? [];

    const blends = eligible.filter(isMachineBlend).sort(cheapestFirst);
    const automatic = blends.length >= BEANS_SECTION_MIN ? blends.slice(0, BEANS_SECTION_MAX) : [];
    expect(listed("automatic")).toEqual(automatic.map((row) => row.id));

    const taken = new Set(automatic.map((row) => row.id));
    const perBrand = new Map<string, BeanRow>();
    for (const row of eligible.filter(isItalian).sort(cheapestFirst)) {
      if (!taken.has(row.id) && !perBrand.has(row.brand!)) perBrand.set(row.brand!, row);
    }
    const brands = [...perBrand.values()].sort(cheapestFirst);
    const italian = brands.length >= BEANS_SECTION_MIN ? brands.slice(0, BEANS_SECTION_MAX) : [];
    expect(listed("italian")).toEqual(italian.map((row) => row.id));
  });

  it("names each brand once in the Italian section, and each product in one section", async () => {
    const sections = await getBeansSections();
    const italian = sections.find((section) => section.id === "italian");
    const brands = italian?.products.map(({ card }) => byId.get(card.id)?.brand) ?? [];
    expect(new Set(brands).size).toBe(brands.length);
    const all = sections.flatMap((section) => section.products.map(({ card }) => card.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives the same sections on every read", async () => {
    const first = await getBeansSections();
    const second = await getBeansSections();
    const shape = (sections: typeof first) =>
      sections.map((section) => [section.id, section.products.map(({ card }) => card.id)]);
    expect(shape(second)).toEqual(shape(first));
  });
});
