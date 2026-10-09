import {
  type ProductNameInput,
  discriminatedSlug,
  planSlugMoves,
  productName,
} from "@catalog/shared";
import { RESERVED_PRODUCT_SLUGS } from "@catalog/shared/storefront-data";
import { describe, expect, it } from "vitest";
import { assignProductSlug } from "../src/catalog/identity.ts";
import fixture from "../../shared/test/fixtures/product-names.json" with { type: "json" };

/**
 * Two databases, one catalog, the same URLs.
 *
 * The development copy got its 187 products from the sync while the sync still
 * named slugs after the supplier's wording, and then `catalog:reslug` moved
 * all of them at once. Production will not take that path. It holds the 110
 * products it launched with; the catch-up sync, already running the new
 * generator, creates the other 77 directly; only then does `catalog:reslug`
 * move the 110.
 *
 * `content/product-copy.ts` is keyed by slug, so the two must end at the same
 * 187 slugs. This file builds the catalog both ways from the same records,
 * using the function the sync calls (`assignProductSlug`) and the function the
 * script calls (`planSlugMoves`), and compares.
 */

interface FixtureRecord extends ProductNameInput {
  readonly sourceKey: string;
  /** `launch` for the 110 production already holds, `catch-up` for the 77. */
  readonly wave: string;
  /** The slug the old generator gave it. */
  readonly formerSlug: string;
  readonly expected: { readonly slug: string };
}

const records = fixture as readonly FixtureRecord[];

/** The categories' stored slugs, as both databases hold them. */
const CATEGORY_SLUGS = [
  "kapsuli",
  "nespresso",
  "dolce-gusto",
  "lavazza-blue",
  "a-modo-mio",
  "caffitaly",
  "kafe-na-zarna",
  "kafe-dozi",
];
const RESERVED: ReadonlySet<string> = new Set([...RESERVED_PRODUCT_SLUGS, ...CATEGORY_SLUGS]);

interface Row {
  readonly record: ProductNameInput & { readonly sourceKey: string };
  slug: string;
  previousSlugs: string[];
}

type Catalog = Map<string, Row>;

/** Products that were stored before the generator changed, under their old slugs. */
function stored(rows: readonly FixtureRecord[]): Catalog {
  return new Map(
    rows.map((record) => [
      record.sourceKey,
      { record, slug: record.formerSlug, previousSlugs: [] },
    ]),
  );
}

/** What `runCatalogSync` does with products it has not seen, in arrival order. */
function syncCreates(catalog: Catalog, arriving: readonly Row["record"][]): void {
  const taken = new Set<string>(RESERVED);
  for (const row of catalog.values()) {
    taken.add(row.slug);
    for (const slug of row.previousSlugs) taken.add(slug);
  }
  for (const record of arriving) {
    catalog.set(record.sourceKey, {
      record,
      slug: assignProductSlug(record, taken),
      previousSlugs: [],
    });
  }
}

/** What `catalog:reslug --apply` does. Returns how many products it moved. */
function reslug(catalog: Catalog): number {
  const moves = planSlugMoves(
    [...catalog.values()].map((row) => ({
      sourceKey: row.record.sourceKey,
      base: productName(row.record).slugBase,
      slug: row.slug,
      previousSlugs: row.previousSlugs,
    })),
    RESERVED,
  );
  for (const move of moves) {
    const row = catalog.get(move.sourceKey)!;
    row.previousSlugs = [...row.previousSlugs.filter((slug) => slug !== move.to), move.from];
    row.slug = move.to;
  }
  return moves.length;
}

const slugsOf = (catalog: Catalog): Record<string, string> =>
  Object.fromEntries(
    [...catalog.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, row]) => [key, row.slug]),
  );

/** A small deterministic generator, so a failing shuffle can be reproduced. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0 || 1;
  for (let index = out.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const pick = state % (index + 1);
    [out[index], out[pick]] = [out[pick]!, out[index]!];
  }
  return out;
}

const launch = records.filter((record) => record.wave === "launch");
const catchUp = records.filter((record) => record.wave === "catch-up");

/** The development copy: everything stored under old slugs, then moved at once. */
function developmentRoute(rows: readonly FixtureRecord[] = records): Catalog {
  const catalog = stored(rows);
  reslug(catalog);
  return catalog;
}

/** Production: some stored under old slugs, the rest created by the new sync, then the move. */
function productionRoute(
  old: readonly FixtureRecord[],
  arriving: readonly Row["record"][],
): Catalog {
  const catalog = stored(old);
  syncCreates(catalog, arriving);
  reslug(catalog);
  return catalog;
}

describe("the real catalog, built both ways", () => {
  it("is the catalog the brief describes: 110 at launch, 77 since", () => {
    expect(launch).toHaveLength(110);
    expect(catchUp).toHaveLength(77);
  });

  it("ends at the same 187 slugs by either route", () => {
    const development = slugsOf(developmentRoute());
    const production = slugsOf(productionRoute(launch, catchUp));
    expect(Object.keys(production)).toHaveLength(187);
    expect(production).toEqual(development);
  });

  it("ends at the slugs the written copy is keyed by", () => {
    const production = slugsOf(productionRoute(launch, catchUp));
    for (const record of records) {
      expect(production[record.sourceKey], record.sourceName).toBe(record.expected.slug);
    }
  });

  it("does not depend on the order the sync meets the new products in", () => {
    const development = slugsOf(developmentRoute());
    for (let seed = 1; seed <= 25; seed += 1) {
      expect(slugsOf(productionRoute(launch, shuffled(catchUp, seed))), `seed ${seed}`).toEqual(
        development,
      );
    }
  });

  it("does not depend on which products were there first", () => {
    const development = slugsOf(developmentRoute());
    for (let seed = 1; seed <= 25; seed += 1) {
      const mixed = shuffled(records, seed);
      const cut = seed * 7;
      expect(
        slugsOf(productionRoute(mixed.slice(0, cut), mixed.slice(cut))),
        `seed ${seed}`,
      ).toEqual(development);
    }
    // The extremes: nothing was there first, and everything was.
    expect(slugsOf(productionRoute([], records))).toEqual(development);
    expect(slugsOf(productionRoute(records, []))).toEqual(development);
  });

  it("the sync alone already gives the 77 their final slugs: the move touches only the 110", () => {
    const catalog = stored(launch);
    syncCreates(catalog, catchUp);
    for (const record of catchUp) {
      expect(catalog.get(record.sourceKey)?.slug).toBe(record.expected.slug);
    }
    expect(reslug(catalog)).toBe(110);
    for (const record of catchUp) {
      expect(catalog.get(record.sourceKey)?.previousSlugs).toEqual([]);
    }
  });

  it("leaves every old slug behind as a redirect, and is a no-op the second time", () => {
    const catalog = productionRoute(launch, catchUp);
    for (const record of launch) {
      expect(catalog.get(record.sourceKey)?.previousSlugs).toEqual([record.formerSlug]);
    }
    expect(reslug(catalog)).toBe(0);
    expect(reslug(developmentRoute())).toBe(0);
  });
});

describe("two products with one name, built both ways", () => {
  /*
   * The real catalog has such a pair (the two Lavazza Crema e Aroma bags) and
   * settles it with a written name. This is the case nobody has written a
   * name for yet: the supplier lists the same coffee at two addresses.
   */
  const twin = (path: string): FixtureRecord => ({
    sourceName: "Кафе на зърна Kimbo Extra Cream 1кг.",
    sourceKey: `${path}#1000g`,
    brand: { sourceKey: "kimbo", name: "KIMBO" },
    categoryKeys: ["kafe-na-zyrna"],
    packValue: "1000",
    packUnit: "g",
    wave: "launch",
    formerSlug: `kafe-na-zarna-kimbo-extra-cream-1kg${path === "/kimbo-extra-cream-1/" ? "" : "-1000g"}`,
    expected: { slug: "" },
  });
  const first = twin("/kimbo-extra-cream-1/");
  const second = twin("/kimbo-extra-cream-new-1/");
  const base = "kimbo-extra-cream-kafe-na-zarna-1-kg";
  const settled = {
    [first.sourceKey]: discriminatedSlug(base, first.sourceKey),
    [second.sourceKey]: discriminatedSlug(base, second.sourceKey),
  };

  it("gives each a slug from its own source key, and neither the bare one", () => {
    expect(slugsOf(developmentRoute([first, second]))).toEqual(settled);
    expect(settled[first.sourceKey]).not.toBe(settled[second.sourceKey]);
  });

  it("whichever was stored first, and whichever the sync meets first", () => {
    expect(slugsOf(productionRoute([first], [second]))).toEqual(settled);
    expect(slugsOf(productionRoute([second], [first]))).toEqual(settled);
    expect(slugsOf(productionRoute([], [first, second]))).toEqual(settled);
    expect(slugsOf(productionRoute([], [second, first]))).toEqual(settled);
  });

  it("keeps the bare slug pointing at the product the sync first gave it to", () => {
    const catalog = productionRoute([], [first, second]);
    expect(catalog.get(first.sourceKey)?.previousSlugs).toEqual([base]);
    expect(reslug(catalog)).toBe(0);
  });
});

describe("a product whose name is a page's address", () => {
  it("is refused the address by the sync and by the move alike", () => {
    // A brand called "Kafe" selling a line called "Dozi", with no category
    // and no pack size, would be published at `/bg/kafe-dozi`: the ESE listing.
    const record: FixtureRecord = {
      sourceName: "Kafe Dozi",
      sourceKey: "/kafe-dozi-product/",
      brand: null,
      categoryKeys: [],
      packValue: null,
      packUnit: null,
      wave: "catch-up",
      formerSlug: "kafe-dozi-2",
      expected: { slug: "" },
    };
    expect(productName(record).slugBase).toBe("kafe-dozi");
    const refused = discriminatedSlug("kafe-dozi", record.sourceKey);
    expect(slugsOf(productionRoute([], [record]))).toEqual({ [record.sourceKey]: refused });
    expect(slugsOf(developmentRoute([record]))).toEqual({ [record.sourceKey]: refused });
  });
});
