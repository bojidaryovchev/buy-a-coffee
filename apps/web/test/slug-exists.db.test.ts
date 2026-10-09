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

import { getLandingAvailability } from "@/lib/catalog/landing-queries";
import { LANDING_IDS, LANDING_PATHS } from "@/lib/catalog/landings";
import { slugExists } from "@/lib/catalog/slug-exists";
import { brandSlug } from "@/lib/routes";

/**
 * What the proxy is told about the catalog, against a real one, read-only.
 *
 * `proxy.test.ts` covers what the proxy does with an answer. This covers the
 * answers: a wrong "no" here is a live page served as a 404, so each kind is
 * checked against rows the catalog itself returns, never against a slug typed
 * into the test. It skips cleanly when no catalog is reachable.
 */

const databaseUrl = process.env.DATABASE_URL;

interface Sample {
  readonly product: string | null;
  /** A slug some product used to have, when any has moved. */
  readonly formerProduct: string | null;
  readonly brand: string | null;
  readonly brands: ReadonlyArray<{ readonly slug: string; readonly sourceKey: string }>;
  readonly category: string | null;
}

async function sample(): Promise<Sample | null> {
  if (!databaseUrl) return null;
  try {
    const { sql, close } = createDatabase({ url: databaseUrl, max: 1, connectTimeoutSeconds: 3 });
    try {
      const [product] = await sql`select slug from products where status = 'active' limit 1`;
      const [former] =
        await sql`select previous_slugs[1] as slug from products where cardinality(previous_slugs) > 0 limit 1`;
      const brandRows =
        await sql`select slug, source_key from brands where status = 'active' order by slug`;
      const [brand] = brandRows;
      const [category] = await sql`select slug from categories where status = 'active' limit 1`;
      return {
        product: (product?.slug as string | undefined) ?? null,
        formerProduct: (former?.slug as string | undefined) ?? null,
        brand: (brand?.slug as string | undefined) ?? null,
        brands: brandRows.map((row) => ({
          slug: row.slug as string,
          sourceKey: row.source_key as string,
        })),
        category: (category?.slug as string | undefined) ?? null,
      };
    } finally {
      await close();
    }
  } catch {
    return null;
  }
}

const rows = await sample();

describe.skipIf(!rows?.product)("what the proxy is told the catalog holds", () => {
  it("knows a product, a category and a brand by the slugs the catalog stores", async () => {
    expect(await slugExists("first-level", rows!.product!)).toBe(true);
    if (rows!.category) expect(await slugExists("first-level", rows!.category)).toBe(true);
    if (rows!.brand) expect(await slugExists("brand", rows!.brand)).toBe(true);
  });

  it("knows a product by a slug it used to have: that address must reach the page that redirects it", async () => {
    // Nothing has moved in a catalog that predates the shop's own slugs.
    if (!rows!.formerProduct) return;
    expect(await slugExists("first-level", rows!.formerProduct)).toBe(true);
  });

  it("knows every brand by the slug it is stored under and the one it is published at", async () => {
    for (const brand of rows!.brands) {
      expect(await slugExists("brand", brand.slug), brand.slug).toBe(true);
      expect(await slugExists("brand", brandSlug("bg", brand)), brand.slug).toBe(true);
    }
  });

  it("says no to a slug that names nothing, of each kind", async () => {
    expect(await slugExists("first-level", "no-such-product-or-category")).toBe(false);
    expect(await slugExists("brand", "no-such-brand")).toBe(false);
    expect(await slugExists("landing", "no-such-landing")).toBe(false);
  });

  it("does not mix the kinds up: a product is not a brand, a brand is not a page", async () => {
    expect(await slugExists("brand", rows!.product!)).toBe(false);
    expect(await slugExists("landing", rows!.product!)).toBe(false);
  });

  it("knows a landing listing exactly while its page would list something", async () => {
    const availability = await getLandingAvailability();
    for (const id of LANDING_IDS) {
      const segment = LANDING_PATHS[id].slice(1);
      expect(await slugExists("landing", segment), id).toBe(availability.counts[id] > 0);
    }
  });
});
