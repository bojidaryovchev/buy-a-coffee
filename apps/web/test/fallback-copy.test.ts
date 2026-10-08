import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type FallbackCopyFacts,
  composeFallbackCopy,
  packSizeLabel,
  publishedSummary,
  resolveProductFormat,
} from "@/lib/catalog/fallback-copy";
import { BREWING_SYSTEMS } from "@/lib/recommend/systems";
import {
  type ReferenceProduct,
  generatedSentenceFor,
  referenceProductFacts,
} from "../scripts/copy-audit";

/* --- The sentence, case by case ----------------------------------------- */

const BEANS = ["kafe-na-zarna"];

describe("composeFallbackCopy", () => {
  it("composes every clause when every fact is present", () => {
    expect(
      composeFallbackCopy({
        brandName: "Lavazza",
        categoryKeys: ["kapsuli", "nespresso"],
        packValue: "10.0000",
        packUnit: "pc",
        attributes: { intensity: "8 от 12", strength: "strong", decaf: "yes", aromas: "yes" },
      }),
    ).toBe(
      "Ароматизирани капсули без кофеин от Lavazza за Nespresso Original в опаковка от 10 броя, с интензивност 8 от 12.",
    );
  });

  it("names beans by their own category", () => {
    expect(
      composeFallbackCopy({
        brandName: "Vergnano",
        categoryKeys: BEANS,
        packValue: "1000.0000",
        packUnit: "g",
        attributes: { intensity: "7 от 10", decaf: "no", aromas: "no" },
      }),
    ).toBe("Кафе на зърна от Vergnano в опаковка от 1 кг, с интензивност 7 от 10.");
  });

  it("makes the adjective agree with the noun it lands on", () => {
    const flavoured = { attributes: { aromas: "yes" } };
    expect(composeFallbackCopy({ ...flavoured, categoryKeys: BEANS })).toBe(
      "Ароматизирано кафе на зърна.",
    );
    expect(composeFallbackCopy({ ...flavoured, categoryKeys: ["dolce-gusto"] })).toBe(
      "Ароматизирани капсули за Dolce Gusto.",
    );
    expect(composeFallbackCopy({ ...flavoured, categoryKeys: ["kafe-dozi"] })).toBe(
      "Ароматизирани дози ESE.",
    );
    expect(composeFallbackCopy({ ...flavoured, categoryKeys: [] })).toBe("Ароматизиран продукт.");
  });

  it("falls back to the three-step strength when no numeric reading parses", () => {
    const facts = { categoryKeys: BEANS, packValue: 500, packUnit: "g" };
    expect(composeFallbackCopy({ ...facts, attributes: { strength: "weak" } })).toBe(
      "Кафе на зърна в опаковка от 500 г, със слаба интензивност.",
    );
    expect(composeFallbackCopy({ ...facts, attributes: { strength: "medium" } })).toBe(
      "Кафе на зърна в опаковка от 500 г, със средна интензивност.",
    );
    expect(composeFallbackCopy({ ...facts, attributes: { strength: "strong" } })).toBe(
      "Кафе на зърна в опаковка от 500 г, със силна интензивност.",
    );
    // A numeric reading wins, and an unparseable one is not echoed.
    expect(
      composeFallbackCopy({ ...facts, attributes: { strength: "weak", intensity: "9 от 10" } }),
    ).toBe("Кафе на зърна в опаковка от 500 г, с интензивност 9 от 10.");
    expect(
      composeFallbackCopy({ ...facts, attributes: { intensity: "много силно", strength: "x" } }),
    ).toBe("Кафе на зърна в опаковка от 500 г.");
  });

  it("uses a comma before the intensity only after a pack size", () => {
    expect(
      composeFallbackCopy({
        brandName: "Rema Caffè",
        categoryKeys: ["kafe-dozi"],
        attributes: { intensity: "11 от 12" },
      }),
    ).toBe("Дози ESE от Rema Caffè с интензивност 11 от 12.");
    expect(composeFallbackCopy({ categoryKeys: BEANS, attributes: { intensity: "4 от 5" } })).toBe(
      "Кафе на зърна с интензивност 4 от 5.",
    );
  });

  it("says nothing about what the data does not say", () => {
    // `decaf: "no"` and `aromas: "no"` are not turned into claims.
    const plain = composeFallbackCopy({
      brandName: "Illy",
      categoryKeys: BEANS,
      attributes: { decaf: "no", aromas: "no" },
    });
    expect(plain).toBe("Кафе на зърна от Illy.");
    expect(plain).not.toMatch(/кофеин|аромат/iu);

    // No brewing system: the product is not called coffee, because nothing
    // we hold says it is one.
    const unknown = composeFallbackCopy({
      brandName: "Lavazza",
      categoryKeys: ["neshto-novo"],
      packValue: 16,
      packUnit: "pc",
    });
    expect(unknown).toBe("Продукт на Lavazza в опаковка от 16 броя.");
    expect(unknown).not.toMatch(/кафе|капсул|доз/iu);
  });

  it("returns null when there is nothing at all to say", () => {
    expect(composeFallbackCopy({})).toBeNull();
    expect(
      composeFallbackCopy({
        brandName: "   ",
        categoryKeys: [],
        packValue: null,
        packUnit: null,
        attributes: { decaf: "no", aromas: "no" },
      }),
    ).toBeNull();
  });

  it("tidies the brand's whitespace without respelling it", () => {
    expect(composeFallbackCopy({ brandName: "  JULIUS   MEINL ", categoryKeys: BEANS })).toBe(
      "Кафе на зърна от JULIUS MEINL.",
    );
  });

  it("is deterministic", () => {
    const facts: FallbackCopyFacts = {
      brandName: "Molini",
      categoryKeys: ["dolce-gusto", "kapsuli"],
      packValue: "16.0000",
      packUnit: "pc",
      attributes: { intensity: "10 от 12" },
    };
    const first = composeFallbackCopy(facts);
    for (let i = 0; i < 20; i += 1) expect(composeFallbackCopy(facts)).toBe(first);
    // Category order is not a fact about the product.
    expect(composeFallbackCopy({ ...facts, categoryKeys: ["kapsuli", "dolce-gusto"] })).toBe(first);
  });

  /*
   * Every combination of present and absent facts, for every brewing system
   * and for none. Not a snapshot of 400 strings — the properties that make a
   * sentence well-formed, which have to hold for all of them.
   */
  it("is a well-formed sentence for every combination of facts", () => {
    const systems = [
      ...BREWING_SYSTEMS.map((system) => [system.categorySlugs[0]!]),
      [] as string[],
    ];
    const brands = ["Lavazza", null];
    const packs: Array<[number | null, string | null]> = [
      [1000, "g"],
      [16, "pc"],
      [null, null],
    ];
    const intensities: Array<Record<string, string>> = [
      { intensity: "8 от 10" },
      { strength: "medium" },
      {},
    ];
    const flags: Array<Record<string, string>> = [
      { decaf: "yes", aromas: "yes" },
      { decaf: "yes" },
      { aromas: "yes" },
      { decaf: "no", aromas: "no" },
    ];

    let composed = 0;
    for (const categoryKeys of systems)
      for (const brandName of brands)
        for (const [packValue, packUnit] of packs)
          for (const intensity of intensities)
            for (const flag of flags) {
              const facts = {
                brandName,
                categoryKeys,
                packValue,
                packUnit,
                attributes: { ...intensity, ...flag },
              };
              const sentence = composeFallbackCopy(facts);
              const label = JSON.stringify(facts);

              if (sentence === null) {
                // Only the wholly empty case may be silent.
                expect(
                  categoryKeys.length === 0 &&
                    !brandName &&
                    packValue === null &&
                    Object.keys(intensity).length === 0 &&
                    facts.attributes.decaf !== "yes" &&
                    facts.attributes.aromas !== "yes",
                  label,
                ).toBe(true);
                continue;
              }
              composed += 1;

              // One sentence: capitalised, one full stop, at the end.
              expect(sentence, label).toMatch(/^\p{Lu}/u);
              expect(sentence.endsWith("."), label).toBe(true);
              expect(sentence.slice(0, -1), label).not.toMatch(/[.!?]/u);
              // No assembly debris.
              expect(sentence, label).not.toMatch(/\s{2,}|\s[,.]|,,|undefined|null|NaN/u);
              // Short enough to be a meta description without being cut.
              expect(sentence.length, label).toBeLessThanOrEqual(160);

              // Each fact appears exactly when it was given.
              expect(sentence.includes("Lavazza"), label).toBe(
                brandName !== null || categoryKeys.some((key) => /lavazza|a-modo-mio/.test(key)),
              );
              expect(/без кофеин/u.test(sentence), label).toBe(facts.attributes.decaf === "yes");
              expect(/роматизиран/u.test(sentence), label).toBe(facts.attributes.aromas === "yes");
              expect(/опаковка/u.test(sentence), label).toBe(packValue !== null);
              expect(/8 от 10/u.test(sentence), label).toBe("intensity" in facts.attributes);
              expect(/средна интензивност/u.test(sentence), label).toBe(
                "strength" in facts.attributes,
              );
            }

    expect(composed).toBeGreaterThan(500);
  });
});

describe("packSizeLabel", () => {
  it("speaks in the unit a customer would", () => {
    expect(packSizeLabel("1000.0000", "g")).toBe("1 кг");
    expect(packSizeLabel("1500", "g")).toBe("1,5 кг");
    expect(packSizeLabel("250.0000", "g")).toBe("250 г");
    expect(packSizeLabel(500, "ml")).toBe("500 мл");
    expect(packSizeLabel(1000, "ml")).toBe("1 л");
    expect(packSizeLabel("16.0000", "pc")).toBe("16 броя");
    expect(packSizeLabel(1, "pc")).toBe("1 брой");
  });

  it("returns null rather than guess", () => {
    expect(packSizeLabel(null, "g")).toBeNull();
    expect(packSizeLabel("", "g")).toBeNull();
    expect(packSizeLabel("abc", "g")).toBeNull();
    expect(packSizeLabel(0, "g")).toBeNull();
    expect(packSizeLabel(-5, "pc")).toBeNull();
    expect(packSizeLabel(2.5, "pc")).toBeNull();
    expect(packSizeLabel(100, null)).toBeNull();
    expect(packSizeLabel(100, "oz")).toBeNull();
  });
});

describe("resolveProductFormat", () => {
  it("finds a system by storefront slug or by source key", () => {
    expect(resolveProductFormat(["kafe-na-zarna"]).system?.id).toBe("beans");
    expect(resolveProductFormat(["kafe-na-zyrna"]).system?.id).toBe("beans");
    expect(resolveProductFormat(["kapsuli", "a-modo-mio"]).system?.id).toBe("a-modo-mio");
  });

  it("resolves every system we stock from its own categories", () => {
    for (const system of BREWING_SYSTEMS) {
      for (const key of [...system.categorySlugs, ...system.categorySourceKeys]) {
        expect(resolveProductFormat([key]).system?.id, key).toBe(system.id);
      }
    }
  });

  it("does not pick one system for a product filed under two", () => {
    const twoCapsuleSystems = resolveProductFormat(["nespresso", "dolce-gusto"]);
    expect(twoCapsuleSystems).toEqual({ system: null, method: "capsule" });
    expect(composeFallbackCopy({ categoryKeys: ["nespresso", "dolce-gusto"] })).toBe("Капсули.");

    expect(resolveProductFormat(["nespresso", "kafe-na-zarna"])).toEqual({
      system: null,
      method: null,
    });
    expect(resolveProductFormat(["kapsuli"])).toEqual({ system: null, method: null });
    expect(resolveProductFormat(null)).toEqual({ system: null, method: null });
  });
});

describe("publishedSummary", () => {
  const facts = { brandName: "Illy", categoryKeys: BEANS };

  it("publishes our own copy when there is some", () => {
    expect(publishedSummary("Наш текст.", facts)).toBe("Наш текст.");
  });

  it("generates when the override is missing or blank", () => {
    expect(publishedSummary(null, facts)).toBe("Кафе на зърна от Illy.");
    expect(publishedSummary(undefined, facts)).toBe("Кафе на зърна от Illy.");
    expect(publishedSummary("   ", facts)).toBe("Кафе на зърна от Illy.");
  });
});

/* --- The whole reference snapshot ---------------------------------------- *
 *
 * The claim B7 makes is about real text, so it is checked against real text:
 * every product the crawler recorded, with the description the source
 * published for it. For each one the sentence we would generate must share no
 * sentence with that description and no run of five consecutive words.
 *
 * The comparison is written out here rather than imported from the audit
 * script, so the code under test is not also its own judge.
 */

const SNAPSHOT_DIR = path.resolve(import.meta.dirname, "../../../reference/latest");
const snapshot = JSON.parse(readFileSync(path.join(SNAPSHOT_DIR, "products.json"), "utf8")) as {
  products: ReferenceProduct[];
};
const brandFile = JSON.parse(readFileSync(path.join(SNAPSHOT_DIR, "brands.json"), "utf8")) as {
  brands: Array<{ sourceKey: string; name: string }>;
};
const brandNames = new Map(brandFile.brands.map((brand) => [brand.sourceKey, brand.name]));

const RUN_LENGTH = 5;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

function runs(text: string, length: number): Set<string> {
  const list = words(text);
  const out = new Set<string>();
  for (let i = 0; i + length <= list.length; i += 1) out.add(list.slice(i, i + length).join(" "));
  return out;
}

/** Source sentences, folded to words. A decimal point does not end a sentence. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => words(sentence).join(" "))
    .filter(Boolean);
}

/** Everything `ours` shares with `source`: whole sentences and five-word runs. */
function sharedWithSource(ours: string, source: string): string[] {
  const shared: string[] = [];

  const folded = words(ours).join(" ");
  for (const sentence of sentences(source)) {
    // Either direction: ours equal to theirs, or theirs sitting inside ours.
    if (folded === sentence || folded.includes(sentence)) shared.push(`sentence "${sentence}"`);
  }

  const sourceRuns = runs(source, RUN_LENGTH);
  for (const run of runs(ours, RUN_LENGTH)) {
    if (sourceRuns.has(run)) shared.push(`run "${run}"`);
  }
  return shared;
}

describe("generated copy against the whole reference snapshot", () => {
  it("covers every product the crawler recorded, each with source text", () => {
    // A real catalog, not a fixture: the comparison below means nothing on a handful.
    expect(snapshot.products.length).toBeGreaterThanOrEqual(100);
    for (const product of snapshot.products) {
      expect(product.descriptionText?.trim(), product.sourceKey).toBeTruthy();
    }
  });

  it("generates a sentence for every product", () => {
    for (const product of snapshot.products) {
      expect(generatedSentenceFor(product, brandNames), product.sourceKey).toBeTruthy();
    }
  });

  it("shares no sentence and no run of five words with the source's text", () => {
    const offenders: string[] = [];
    for (const product of snapshot.products) {
      const generated = generatedSentenceFor(product, brandNames);
      if (!generated) continue;
      for (const shared of sharedWithSource(generated, product.descriptionText ?? "")) {
        offenders.push(`${product.sourceKey}: ${shared} — in: ${generated}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("would catch the source's own text, were it ever published", () => {
    // The detector has to be able to fail, or the test above proves nothing.
    // Publishing the source's description — what the storefront did before —
    // must be reported for every product, by both measures where both apply.
    for (const product of snapshot.products) {
      const source = product.descriptionText!;
      const shared = sharedWithSource(source, source);
      expect(
        shared.some((entry) => entry.startsWith("sentence")),
        product.sourceKey,
      ).toBe(true);
      if (words(source).length >= RUN_LENGTH) {
        expect(
          shared.some((entry) => entry.startsWith("run")),
          product.sourceKey,
        ).toBe(true);
      }
    }

    // And a single lifted phrase inside an otherwise original sentence.
    expect(
      sharedWithSource(
        "Кафе на зърна от Lavazza, изпичана за максимално развитие на аромата.",
        "Този бленд е комбинация от арабика и робуста, изпичана за максимално развитие на аромата и балансиран вкус.",
      ),
    ).not.toEqual([]);
  });

  it("is built without reading the source's description at all", () => {
    for (const product of snapshot.products.slice(0, 10)) {
      const withText = generatedSentenceFor(product, brandNames);
      const withoutText = generatedSentenceFor(
        { ...product, descriptionText: "Съвсем различен текст, който няма как да попадне." },
        brandNames,
      );
      expect(withoutText).toBe(withText);
      expect(Object.values(referenceProductFacts(product, brandNames))).not.toContain(
        product.descriptionText,
      );
    }
  });
});
