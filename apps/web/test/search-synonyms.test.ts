import { transliterate } from "@catalog/shared";
import { describe, expect, it } from "vitest";
import {
  BRAND_SYNONYMS,
  SEARCH_SYNONYMS,
  SYSTEM_SYNONYMS,
  expandSearchTerm,
} from "@/lib/catalog/search-synonyms";

/** Brands the source catalog carries today, as it writes them. */
const SOURCE_BRANDS = [
  "lollo",
  "eurocaf",
  "biancaffe",
  "molini",
  "rema",
  "amann",
  "tezzoro",
  "este",
  "elia",
  "borbone",
  "bianchi",
  "kimbo",
  "lavazza",
  "vergnano",
  "julius meinl",
  "foodness",
  "illy",
  "caffitaly",
  "vandino",
  "3 bourbons",
];
const SYSTEMS = ["nespresso", "dg", "a modo mio", "lavazza blue", "caffitaly", "дози"];

describe("expandSearchTerm", () => {
  it("always keeps the typed term first, unchanged", () => {
    expect(expandSearchTerm("Лаваца")[0]).toBe("Лаваца");
    expect(expandSearchTerm("капсули")).toEqual(["капсули"]);
  });

  it("adds the catalog's form for a phonetic spelling", () => {
    expect(expandSearchTerm("лаваца")).toEqual(["лаваца", "lavazza"]);
    expect(expandSearchTerm("Бианки")).toEqual(["Бианки", "bianchi"]);
    expect(expandSearchTerm("тезоро")).toEqual(["тезоро", "tezzoro"]);
  });

  it("finds a synonym inside a longer query and keeps the rest", () => {
    expect(expandSearchTerm("капсули лаваца")).toEqual(["капсули лаваца", "капсули lavazza"]);
    expect(expandSearchTerm("лаваца 36 бр.")).toEqual(["лаваца 36 бр.", "lavazza 36 бр."]);
  });

  it("handles multi-word spellings, preferring the longest", () => {
    expect(expandSearchTerm("юлиус майнл")).toEqual(["юлиус майнл", "julius meinl"]);
    expect(expandSearchTerm("капсули долче густо")).toEqual(["капсули долче густо", "капсули dg"]);
    // „лаваца блу" is the Blue system, not Lavazza followed by a stray „блу".
    expect(expandSearchTerm("лаваца блу")).toEqual(["лаваца блу", "lavazza blue"]);
    expect(expandSearchTerm("3 бурбонс")).toEqual(["3 бурбонс", "3 bourbons"]);
  });

  it("replaces several spellings in one query", () => {
    expect(expandSearchTerm("лаваца неспресо")).toEqual(["лаваца неспресо", "lavazza nespresso"]);
  });

  it("matches case-insensitively and ignores punctuation between words", () => {
    expect(expandSearchTerm("ЛАВАЦА!")[1]).toBe("lavazza!");
    expect(expandSearchTerm("Долче-Густо")[1]).toBe("dg");
  });

  it("completes a half-typed final word, but not a short one", () => {
    expect(expandSearchTerm("лавац")).toEqual(["лавац", "lavazza"]);
    expect(expandSearchTerm("капсули неспр")[1]).toBe("капсули nespresso");
    expect(expandSearchTerm("лав")).toEqual(["лав"]);
    // Only the last word can still be in progress.
    expect(expandSearchTerm("лавац капсули")).toEqual(["лавац капсули"]);
  });

  it("completes the last word of a multi-word spelling", () => {
    expect(expandSearchTerm("долче густ")[1]).toBe("dg");
  });

  it("adds nothing when folding already finds the name", () => {
    for (const query of ["лавазза", "молини", "есте", "кимбо", "вандино", "lavazza", "rema"]) {
      expect(expandSearchTerm(query)).toEqual([query]);
    }
  });

  it("does not turn the everyday word „или“ into Illy", () => {
    expect(expandSearchTerm("кафе или чай")).toEqual(["кафе или чай"]);
  });

  it("leaves queries without a spelling alone, including wildcard characters", () => {
    expect(expandSearchTerm("100%")).toEqual(["100%"]);
    expect(expandSearchTerm("a_b")).toEqual(["a_b"]);
    expect(expandSearchTerm("zzzzqqqq")).toEqual(["zzzzqqqq"]);
    expect(expandSearchTerm("")).toEqual([""]);
  });

  it("skips expansion for an over-long query", () => {
    const long = "лаваца ".repeat(60);
    expect(expandSearchTerm(long)).toEqual([long]);
  });

  it("is script-insensitive: a Latin spelling of the Cyrillic key also matches", () => {
    // „дулче густо" folds to the same text as its Latin transliteration.
    expect(expandSearchTerm("dulche gusto")[1]).toBe("dg");
    expect(expandSearchTerm("dolce gusto")[1]).toBe("dg");
  });

  it("covers the Cyrillic aliases machines.ts already has", () => {
    expect(expandSearchTerm("неспресо")[1]).toBe("nespresso");
    expect(expandSearchTerm("кафитали")[1]).toBe("caffitaly");
  });
});

describe("the synonym table", () => {
  it("considers every brand and every system", () => {
    // Caffitaly is both: one group serves the brand and the system.
    const brandTargets = new Set(BRAND_SYNONYMS.map((group) => group.canonical));
    const systemTargets = new Set([
      ...SYSTEM_SYNONYMS.map((group) => group.canonical),
      "caffitaly",
    ]);
    for (const brand of SOURCE_BRANDS) expect(brandTargets.has(brand)).toBe(true);
    for (const system of SYSTEMS) expect(systemTargets.has(system)).toBe(true);
  });

  it("has no spelling listed under two different targets", () => {
    const seen = new Map<string, string>();
    for (const group of SEARCH_SYNONYMS) {
      for (const spelling of group.spellings) {
        const key = transliterate(spelling)
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .trim();
        const previous = seen.get(key);
        if (previous !== undefined && previous !== group.canonical) {
          throw new Error(`"${spelling}" maps to both "${previous}" and "${group.canonical}"`);
        }
        seen.set(key, group.canonical);
      }
    }
  });

  it("every canonical form is lower case and every spelling is non-empty", () => {
    for (const group of SEARCH_SYNONYMS) {
      expect(group.canonical).toBe(group.canonical.toLowerCase());
      expect(group.spellings.length).toBeGreaterThan(0);
      for (const spelling of group.spellings) expect(spelling.trim()).not.toBe("");
    }
  });

  it("every Cyrillic spelling of every brand expands to its canonical form", () => {
    for (const group of SEARCH_SYNONYMS) {
      for (const spelling of group.spellings) {
        const folded = transliterate(group.canonical);
        const expanded = expandSearchTerm(spelling);
        if (transliterate(spelling) === folded) {
          expect(expanded).toEqual([spelling]);
        } else {
          expect(expanded[1]).toBe(group.canonical);
        }
      }
    }
  });
});
