import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "@catalog/db";
import {
  brandDisplayName,
  compareDecimal,
  parseDecimal,
  pricePerUnitMeasure,
  productKind,
} from "@catalog/shared";

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
import { ITALIAN_SECTION_MAX, ITALIAN_SECTION_MIN } from "@/lib/catalog/beans-sections";
import { loadLandingRows } from "@/lib/catalog/landing-queries";

/**
 * The beans listing's sections against a real catalog, read-only.
 *
 * The rules are pure and tested with fixtures in `beans-sections.test.ts`.
 * What needs PostgreSQL is that what the Italian section lists is, row by row,
 * what the catalog says satisfies its rule, and that it is the selection the
 * rule gives, not merely a valid one. The catalog's own facts — status,
 * category, brand, availability, flavour — are read here with SQL of its own.
 * The price is not: it is read through the landing rows, the very read the
 * sections choose from, so the day the price a customer sees is computed
 * differently (a running promotion) this suite follows it instead of
 * disagreeing with it. The shared helpers that turn a price into a price per
 * kilogram and a name into a kind of coffee are the code's own as well.
 *
 * Nothing is compared with a product typed here, so the suite holds for any
 * catalog. It skips cleanly when none is reachable.
 */

const databaseUrl = process.env.DATABASE_URL;

interface CatalogRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly availability: string;
  readonly brandSlug: string | null;
  readonly brandName: string | null;
  readonly brandSourceKey: string | null;
  readonly aromas: string | null;
  readonly beans: boolean;
}

/** Every product, with its brand and whether it is filed under beans. */
async function readCatalog(): Promise<readonly CatalogRow[]> {
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
          brand_slug: string | null;
          brand_name: string | null;
          brand_source_key: string | null;
          aromas: string | null;
          beans: boolean;
        }[]
      >`
        select p.id, p.name, p.status, p.availability::text as availability,
          b.slug as brand_slug, b.name as brand_name, b.source_key as brand_source_key,
          lower(trim(p.attributes->>'aromas')) as aromas,
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
        brandSlug: row.brand_slug,
        brandName: row.brand_name,
        brandSourceKey: row.brand_source_key,
        aromas: row.aromas,
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

/** Active coffee beans: filed under beans, and not instant coffee by its name. */
const activeBeans = catalog.filter(
  (row) => row.status === "active" && row.beans && productKind(row.name) !== "instant",
);

const isItalian = (row: CatalogRow) =>
  row.brandSlug !== null && brandFactsFor({ slug: row.brandSlug }).italian !== undefined;

const shownName = (row: CatalogRow) =>
  brandDisplayName({ name: row.brandName ?? "", sourceKey: row.brandSourceKey });

describe.skipIf(!hasCatalog)("the beans sections, against the catalog", () => {
  it("lists between three and twelve Italian brands, or none", async () => {
    const { italian } = await getBeansSections();
    if (italian === null) return;
    expect(italian.length).toBeGreaterThanOrEqual(ITALIAN_SECTION_MIN);
    expect(italian.length).toBeLessThanOrEqual(ITALIAN_SECTION_MAX);
  });

  it("lists only active, orderable coffee beans of brands recorded as Italian", async () => {
    const { italian } = await getBeansSections();
    for (const { card, perKilogram } of italian ?? []) {
      const row = byId.get(card.id);
      expect(row, card.slug).toBeDefined();
      expect(row!.status, card.slug).toBe("active");
      expect(row!.beans, card.slug).toBe(true);
      expect(productKind(row!.name), card.slug).not.toBe("instant");
      expect(row!.availability, card.slug).not.toBe("out_of_stock");
      expect(isItalian(row!), card.slug).toBe(true);
      expect(card.systemId, card.slug).toBe("beans");
      expect(perKilogram, card.slug).toMatch(/^\d+,\d{2}\s€ \/ кг$/u);
    }
  });

  it("lists every Italian brand's cheapest pack per kilogram, the brands by name", async () => {
    // The price, as the sections read it.
    const priced = new Map(
      (await loadLandingRows()).flatMap((row) => {
        const unit = pricePerUnitMeasure(row.price, row.weightValue, row.weightUnit);
        return unit?.unit === "kg" ? [[row.id, unit.amount] as const] : [];
      }),
    );
    const cheapestFirst = (a: CatalogRow, b: CatalogRow) =>
      compareDecimal(parseDecimal(priced.get(a.id)!), parseDecimal(priced.get(b.id)!)) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    const perBrand = new Map<string, CatalogRow>();
    for (const row of activeBeans
      .filter((row) => isItalian(row) && row.availability !== "out_of_stock" && priced.has(row.id))
      .sort(cheapestFirst)) {
      if (!perBrand.has(row.brandSlug!)) perBrand.set(row.brandSlug!, row);
    }
    const expected = [...perBrand.values()].sort(
      (a, b) =>
        shownName(a).localeCompare(shownName(b), "bg", { sensitivity: "base" }) ||
        (a.brandSlug! < b.brandSlug! ? -1 : 1),
    );

    const { italian } = await getBeansSections();
    expect(italian?.map(({ card }) => card.id) ?? []).toEqual(
      expected.length >= ITALIAN_SECTION_MIN
        ? expected.slice(0, ITALIAN_SECTION_MAX).map((row) => row.id)
        : [],
    );
    // One pack per brand, and the order the page prints is the brands' names.
    const brands = (italian ?? []).map(({ card }) => card.brand?.name ?? "");
    expect(new Set(brands).size).toBe(brands.length);
    expect(brands).toEqual(
      [...brands].sort((a, b) => a.localeCompare(b, "bg", { sensitivity: "base" })),
    );
  });

  it("knows whether a flavoured coffee is among the beans, as the catalog does", async () => {
    const { automatic } = await getBeansSections();
    expect(automatic).toEqual(
      activeBeans.length === 0
        ? null
        : { flavoured: activeBeans.some((row) => row.aromas === "yes") },
    );
  });

  it("gives the same sections on every read", async () => {
    const shape = (view: Awaited<ReturnType<typeof getBeansSections>>) => [
      view.italian?.map(({ card }) => card.id) ?? null,
      view.automatic,
    ];
    expect(shape(await getBeansSections())).toEqual(shape(await getBeansSections()));
  });
});
