import { brands, products } from "@catalog/db/schema";
import { createDatabase } from "@catalog/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchMatch, searchRank } from "@/lib/catalog/search";

/**
 * The predicate against a database holding the real catalog.
 *
 * Skipped, not failed, when no database is reachable or the catalog is empty:
 * a clean checkout has neither, and CI's test database holds fixtures rather
 * than the 110 real products these assertions are written against.
 */

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const handle = url ? createDatabase({ url, max: 2, connectTimeoutSeconds: 3 }) : null;

let available = false;
beforeAll(async () => {
  if (!handle) return;
  try {
    const rows = await handle.db.select({ id: products.id }).from(products).limit(60);
    // Real catalog or nothing: a handful of fixture rows proves nothing here.
    available = rows.length >= 50;
  } catch {
    available = false;
  }
});
afterAll(async () => {
  await handle?.close();
});

async function find(term: string): Promise<{ id: string; name: string }[]> {
  const rows = await handle!.db
    .select({ id: products.id, name: products.name })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(searchMatch(term))
    .orderBy(...searchRank(term), asc(products.name));
  return rows;
}

async function ids(term: string): Promise<string[]> {
  return (await find(term)).map((row) => row.id).sort();
}

/**
 * Cyrillic spelling → the catalog's own spelling, for the brands and systems
 * the August catalog holds (15 of the 20 brands). The rest are unit-tested.
 */
const CASES: readonly (readonly [cyrillic: string, latin: string])[] = [
  ["лаваца", "lavazza"],
  ["лавацца", "lavazza"],
  ["бианки", "bianchi"],
  ["бианкафе", "biancaffe"],
  ["молини", "molini"],
  ["рема кафе", "rema"],
  ["аман", "amann"],
  ["тезоро", "tezzoro"],
  ["есте", "este"],
  ["елия", "elia"],
  ["борбоне", "borbone"],
  ["вергнано", "vergnano"],
  ["верняно", "vergnano"],
  ["юлиус майнл", "julius meinl"],
  ["майнл", "meinl"],
  ["еврокаф", "eurocaf"],
  ["илли", "illy"],
  ["кафитали", "caffitaly"],
  // Systems.
  ["неспресо", "nespresso"],
  ["долче густо", "dg"],
  ["а модо мио", "a modo mio"],
  ["лаваца блу", "lavazza blue"],
];

describe.skipIf(!handle)("synonym search against the real catalog", () => {
  for (const [cyrillic, latin] of CASES) {
    it(`„${cyrillic}" finds what "${latin}" finds`, async (context) => {
      if (!available) return context.skip();
      const expected = await ids(latin);
      expect(expected.length).toBeGreaterThan(0);

      /*
       * Everything the Latin spelling finds, ranked ahead of anything else.
       *
       * Not strict equality: a shorter Cyrillic spelling is also a shorter
       * string, and typo tolerance may add near neighbours after the brand
       * („аман" also reaches "Amalfi"). That is the search working. What must
       * hold is that the brand is all there and comes first.
       */
      const found = await find(cyrillic);
      const leading = found.slice(0, expected.length).map((row) => row.id);
      expect(leading.sort()).toEqual(expected);
    });
  }

  it("finds Lavazza by „лаваца“, which folding alone cannot", async (context) => {
    if (!available) return context.skip();
    const rows = await find("лаваца");
    const named = rows.filter((row) => /lavazza/i.test(row.name));
    expect(named.length).toBeGreaterThan(0);
    /*
     * The brand's own products, ahead of anything else. Another brand's
     * capsule made for the Lavazza Blue system says so in its description,
     * so it is found too, after them, exactly as it is for "lavazza".
     */
    expect(rows.slice(0, named.length)).toEqual(named);
  });

  it("finds a synonym inside a longer query", async (context) => {
    if (!available) return context.skip();
    const expected = await ids("капсули lavazza");
    expect(expected.length).toBeGreaterThan(0);
    expect(await ids("капсули лаваца")).toEqual(expected);
    expect(await ids("капсули лаваца")).not.toEqual(await ids("лаваца"));
  });

  it("finds a half-typed spelling, as the typeahead asks", async (context) => {
    if (!available) return context.skip();
    expect(await ids("лавац")).toEqual(await ids("lavazza"));
  });

  it("ranks products reached through a synonym first, as a direct hit would", async (context) => {
    if (!available) return context.skip();
    const direct = await find("lavazza");
    const viaSynonym = await find("лаваца");
    expect(viaSynonym.slice(0, 5).map((row) => row.id)).toEqual(
      direct.slice(0, 5).map((row) => row.id),
    );
  });

  it("never loses a result a query already had", async (context) => {
    if (!available) return context.skip();
    // Plain queries are untouched by expansion.
    for (const term of ["rema", "рема", "lavaza", "капсули", "крема", "kapsuli"]) {
      expect((await find(term)).length).toBeGreaterThan(0);
    }
    expect(await ids("рема")).toEqual(await ids("rema"));
    const typo = await find("lavaza");
    expect(typo[0]?.name).toMatch(/lavazza/i);
  });

  it("still finds nothing for nonsense", async (context) => {
    if (!available) return context.skip();
    for (const term of ["zzzzqqqqxxxx", "ъъъъяяяя", "%%", "'; drop table products; --"]) {
      expect(await ids(term)).toEqual([]);
    }
  });

  it("treats LIKE wildcards in a query that also holds a synonym as text", async (context) => {
    if (!available) return context.skip();
    // Unescaped, "%" would make the substring strategy match every row.
    for (const term of ["%% лаваца", "_ _ лаваца"]) {
      expect((await find(term)).length).toBeLessThan(40);
    }
  });
});
