import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { brandDisplayNames } from "../content/brand-names";
import { brandDisplayName, brandLookupKey, fallbackBrandName } from "@/lib/catalog/brand-display";
import { composeBrandSummary, systemsForCategories } from "@/lib/catalog/brand-summary";
import { BREWING_SYSTEMS, getBrewingSystem, type BrewingSystemId } from "@/lib/recommend/systems";

interface ReferenceBrand {
  readonly name: string;
  readonly sourceKey: string;
}

const referenceBrands = (
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../../../reference/latest/brands.json"),
      "utf8",
    ),
  ) as { brands: ReferenceBrand[] }
).brands;

/** The brands the source lists today; the snapshot holds the stocked subset. */
const KNOWN_BRAND_KEYS = [
  "lollocafe",
  "eurocaf",
  "biancaffe",
  "molini",
  "rema-caffe",
  "amann",
  "tezzoro",
  "este",
  "elia",
  "borbone",
  "bianchi",
  "kimbo",
  "lavazza",
  "vergnano",
  "julius-meinl",
  "foodness",
  "illy",
  "caffitaly",
  "vandino",
  "3-bourbons",
];

/** Names exactly as the source types them, warts included. */
const AS_TYPED_BY_THE_SOURCE: ReadonlyArray<[name: string, sourceKey: string, shown: string]> = [
  ["LAVAZZA", "lavazza", "Lavazza"],
  ["REMA CAFFE", "rema-caffe", "Rema Caffè"],
  ["BORBONE ", "borbone", "Borbone"],
  [" VERGNANO", " vergnano", "Vergnano"],
  ["FoodNess", "foodness", "Foodness"],
  ["3bourbons", "3bourbons", "3 Bourbons"],
  ["LOLLOCAFE", "lollocafe", "Lollo Caffè"],
  ["JULIUS MEINL", "julius-meinl", "Julius Meinl"],
  ["ILLY", "illy", "illy"],
  // The snapshot's key for this brand is one "f" short of its name.
  ["BIANCAFFE", "biancafe", "Biancaffè"],
];

describe("brand display names", () => {
  it("has an entry for each of the twenty known brands and nothing else", () => {
    expect(Object.keys(brandDisplayNames).sort()).toEqual([...KNOWN_BRAND_KEYS].sort());
  });

  it("keys every entry by a brand that exists", () => {
    const known = new Set([
      ...KNOWN_BRAND_KEYS.map(brandLookupKey),
      ...referenceBrands.flatMap((brand) => [
        brandLookupKey(brand.sourceKey),
        brandLookupKey(brand.name),
      ]),
    ]);
    for (const key of Object.keys(brandDisplayNames)) {
      expect(known.has(brandLookupKey(key)), `unknown brand key "${key}"`).toBe(true);
    }
  });

  it("keeps entries clean: no stray whitespace, no shouting capitals", () => {
    for (const [key, name] of Object.entries(brandDisplayNames)) {
      expect(key, key).toBe(key.trim().toLowerCase());
      expect(name, key).toBe(name.trim().replace(/\s+/g, " "));
      expect(name.length > 3 && name === name.toUpperCase(), `${key} is all capitals`).toBe(false);
    }
  });

  it("resolves every brand in the reference snapshot through the map", () => {
    expect(referenceBrands.length).toBeGreaterThan(0);
    const written = Object.values(brandDisplayNames);
    for (const brand of referenceBrands) {
      expect(written, `${brand.sourceKey} fell through to the fallback`).toContain(
        brandDisplayName(brand),
      );
    }
  });

  it.each(AS_TYPED_BY_THE_SOURCE)("shows %j (key %j) as %j", (name, sourceKey, shown) => {
    expect(brandDisplayName({ name, sourceKey })).toBe(shown);
    // The key is the better identity, but the name alone must be enough.
    expect(brandDisplayName({ name })).toBe(shown);
    expect(brandDisplayName({ name, sourceKey: null })).toBe(shown);
  });

  it("prefers the source key when key and name point at different entries", () => {
    expect(brandDisplayName({ name: "KIMBO", sourceKey: "lavazza" })).toBe("Lavazza");
  });
});

describe("brand display fallback", () => {
  it.each([
    ["NUOVA MARCA ", "Nuova Marca"],
    ["  caffe   nuovo", "Caffe Nuovo"],
    ["SAN-MARCO", "San-Marco"],
    ["D'ORO", "D'Oro"],
    ["КАФЕ ТЕСТ", "Кафе Тест"],
    ["4YOU", "4you"],
  ])("title-cases a single-case name: %j becomes %j", (typed, shown) => {
    expect(fallbackBrandName(typed)).toBe(shown);
    expect(brandDisplayName({ name: typed, sourceKey: "not-in-the-map" })).toBe(shown);
  });

  it("keeps deliberate mixed case, only tidying whitespace", () => {
    expect(fallbackBrandName(" NewBrand  Caffe ")).toBe("NewBrand Caffe");
    expect(fallbackBrandName("iCaffe")).toBe("iCaffe");
  });

  it("never returns a name with stray whitespace, whatever arrives", () => {
    for (const typed of ["\tX ", " a  b ", "ABC DEF ", ""]) {
      const shown = brandDisplayName({ name: typed, sourceKey: typed });
      expect(shown).toBe(shown.trim());
      expect(shown).not.toMatch(/\s{2,}/);
    }
  });
});

/* --- Brand summary ------------------------------------------------------- */

function systems(...ids: BrewingSystemId[]) {
  return ids.map((id) => {
    const system = getBrewingSystem(id);
    if (!system) throw new Error(`unknown system ${id}`);
    return system;
  });
}

describe("brand summary", () => {
  it("says nothing for a brand with nothing in a known format", () => {
    expect(composeBrandSummary("Kimbo", [])).toBeNull();
  });

  it("beans only", () => {
    expect(composeBrandSummary("illy", systems("beans"))).toEqual({
      sentence: "От illy предлагаме кафе на зърна.",
      capsuleNote: null,
    });
  });

  it("pods only", () => {
    expect(composeBrandSummary("Este", systems("ese-pod"))).toEqual({
      sentence: "От Este предлагаме хартиени дози ESE.",
      capsuleNote: null,
    });
  });

  it("capsules for one system", () => {
    const summary = composeBrandSummary("Caffitaly", systems("caffitaly"));
    expect(summary?.sentence).toBe("От Caffitaly предлагаме капсули за Caffitaly.");
    expect(summary?.capsuleNote).toBe(
      "Капсулите са за тази система и не пасват на машини от друга.",
    );
  });

  it("capsules for two systems", () => {
    const summary = composeBrandSummary("Bianchi", systems("nespresso-original", "dolce-gusto"));
    expect(summary?.sentence).toBe(
      "От Bianchi предлагаме капсули за Nespresso Original и Dolce Gusto.",
    );
    expect(summary?.capsuleNote).toContain("не са взаимозаменяеми");
  });

  it("beans and pods", () => {
    expect(composeBrandSummary("Borbone", systems("ese-pod", "beans"))?.sentence).toBe(
      "От Borbone предлагаме кафе на зърна и хартиени дози ESE.",
    );
  });

  it("beans and capsules for one system", () => {
    expect(composeBrandSummary("Borbone", systems("dolce-gusto", "beans"))?.sentence).toBe(
      "От Borbone предлагаме кафе на зърна, както и капсули за Dolce Gusto.",
    );
  });

  it("beans and capsules for three systems", () => {
    expect(
      composeBrandSummary(
        "Lavazza",
        systems("nespresso-original", "a-modo-mio", "lavazza-blue", "beans"),
      )?.sentence,
    ).toBe(
      "От Lavazza предлагаме кафе на зърна, както и капсули за Nespresso Original, Lavazza A Modo Mio и Lavazza Blue.",
    );
  });

  it("pods and capsules", () => {
    expect(
      composeBrandSummary("Rema Caffe", systems("nespresso-original", "dolce-gusto", "ese-pod"))
        ?.sentence,
    ).toBe(
      "От Rema Caffe предлагаме хартиени дози ESE, както и капсули за Nespresso Original и Dolce Gusto.",
    );
  });

  it("everything at once", () => {
    expect(composeBrandSummary("Molini", [...BREWING_SYSTEMS])?.sentence).toBe(
      "От Molini предлагаме кафе на зърна и хартиени дози ESE, както и капсули за Nespresso Original, Dolce Gusto, Lavazza A Modo Mio, Caffitaly и Lavazza Blue.",
    );
  });

  it("is a well-formed sentence for every combination of systems", () => {
    for (let mask = 1; mask < 1 << BREWING_SYSTEMS.length; mask += 1) {
      const subset = BREWING_SYSTEMS.filter((_, index) => (mask & (1 << index)) !== 0);
      const summary = composeBrandSummary("Марка", subset);
      expect(summary, String(mask)).not.toBeNull();
      const sentence = summary?.sentence ?? "";
      expect(sentence).toMatch(/^От Марка предлагаме \S.*\.$/u);
      expect(sentence).not.toMatch(/\s{2,}|,,| ,|и и|undefined|, и /u);
      expect(summary?.capsuleNote === null).toBe(
        subset.every((system) => system.method !== "capsule"),
      );
    }
  });

  it("maps categories to systems by slug or by source key, in catalog order", () => {
    const found = systemsForCategories([
      // Our slug for beans differs from its source key; either must match.
      { slug: "kafe-na-zarna", sourceKey: "renamed-upstream" },
      { slug: "renamed-here", sourceKey: "dolce-gusto" },
      { slug: "kapsuli", sourceKey: "kapsuli" },
      { slug: "nespresso" },
    ]);
    expect(found.map((system) => system.id)).toEqual([
      "nespresso-original",
      "dolce-gusto",
      "beans",
    ]);
    expect(systemsForCategories([])).toEqual([]);
  });
});
