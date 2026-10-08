import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FactsTable, factRows, type FactsTableProduct } from "@/components/catalog/facts-table";
import { ProductCompatibility } from "@/components/catalog/product-compatibility";
import { MACHINE_BRANDS } from "@/content/machines";
import {
  COMPATIBLE_MACHINE_LIMIT,
  compatibilityLine,
  compatibleMachines,
  compositionLabel,
  packLabel,
  systemListingHref,
} from "@/lib/catalog/product-facts";
import { BREWING_SYSTEMS, getBrewingSystem } from "@/lib/recommend/systems";
import { deriveProductFacts } from "../../../packages/scraper-core/src/parsers/productFacts";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

/** The row headings of a rendered table, in the order they appear. */
const labels = (markup: string): string[] =>
  [...markup.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((match) => match[1] ?? "");

/** The rendered value cell that follows a given heading. */
function cell(markup: string, label: string): string {
  const match = new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>(.*?)</dd>`).exec(markup);
  if (!match) throw new Error(`no row "${label}"`);
  return match[1] ?? "";
}

const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, "");

/** A capsule product as the catalog holds it today: every enriched fact null. */
const CAPSULE: FactsTableProduct = {
  systemId: "dolce-gusto",
  intensity: "8 от 12",
  attributes: { strength: "medium", intensity: "8 от 12", decaf: "no", aromas: "no" },
  arabicaPercent: null,
  origin: null,
  roast: null,
  pack: { value: "16.0000", unit: "pc" },
  weight: "16 бр.",
  servingPrice: { formatted: "0,35 € на чаша", estimated: false },
  unitPrice: null,
  sku: null,
  categories: [
    {
      slug: "dolce-gusto",
      sourceKey: "dolce-gusto",
      name: "Dolce Gusto",
      isPrimary: true,
      parentSlug: "kapsuli",
    },
  ],
};

/** A bag of beans after the enrichment sync has filled every fact. */
const BEANS_ENRICHED: FactsTableProduct = {
  systemId: "beans",
  intensity: "7 от 10",
  attributes: { strength: "strong", intensity: "7 от 10", decaf: "yes", aromas: "yes" },
  arabicaPercent: 70,
  origin: "Уганда и Индия",
  roast: "средно тъмно",
  pack: { value: "1000.0000", unit: "g" },
  weight: "1 кг.",
  servingPrice: { formatted: "≈ 0,22 € на чаша", estimated: true },
  unitPrice: { amount: "32.0000", currency: "EUR", formatted: "32,00 € / кг" },
  sku: "AB-1234",
  categories: [
    {
      slug: "kafe-na-zarna",
      sourceKey: "kafe-na-zyrna",
      name: "Кафе на зърна",
      isPrimary: true,
      parentSlug: null,
    },
  ],
};

const EMPTY: FactsTableProduct = {
  systemId: null,
  intensity: null,
  attributes: {},
  arabicaPercent: null,
  origin: null,
  roast: null,
  pack: null,
  weight: null,
  servingPrice: null,
  unitPrice: null,
  sku: null,
  categories: [],
};

describe("composition wording", () => {
  it("states the arabica share and nothing about the rest of the blend", () => {
    expect(compositionLabel(100)).toBe("100% арабика");
    expect(compositionLabel(70)).toBe("70% арабика");
    expect(compositionLabel(1)).toBe("1% арабика");
    expect(compositionLabel(0)).toBe("0% арабика");
  });

  it("never names robusta: the column does not say what the remainder is", () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      const label = compositionLabel(percent);
      expect(label).toBe(`${percent}% арабика`);
      expect(label).not.toMatch(/робуста/i);
    }
  });

  it("says nothing for an absent or impossible value", () => {
    for (const value of [null, undefined, -1, 101, 62.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(compositionLabel(value)).toBeNull();
    }
  });

  /*
   * The wording is only as good as its reading of the stored value, so these
   * run the sync's own parser and word what it returns. If the parser ever
   * starts deriving a share ("100% робуста" → 0), the first case fails here.
   */
  it("words exactly what the sync's parser stores, for each kind of statement", () => {
    const stored = (value: string) =>
      deriveProductFacts({ characteristics: [{ label: "Състав", value }], prose: [] })
        .arabicaPercent;

    const cases: ReadonlyArray<readonly [statement: string, expected: string | null]> = [
      ["100% арабика", "100% арабика"],
      ["70% арабика и 30% робуста", "70% арабика"],
      ["40% арабика, 60% робуста", "40% арабика"],
      ["0% арабика", "0% арабика"],
      // Says nothing about arabica: stored as null, so no row.
      ["100% робуста", null],
      // Hedged: not a stated figure.
      ["около 80% арабика", null],
      // Two figures on one page are a contradiction, not a choice.
      ["70% арабика или 80% арабика", null],
      ["арабика и робуста", null],
    ];

    for (const [statement, expected] of cases) {
      expect(compositionLabel(stored(statement)), statement).toBe(expected);
    }
  });
});

describe("pack size", () => {
  it("prints a figure with its unit, from the normalised columns", () => {
    expect(packLabel({ value: "1000.0000", unit: "g" })).toBe("1 кг");
    expect(packLabel({ value: "500.0000", unit: "g" })).toBe("500 г");
    expect(packLabel({ value: "250.0000", unit: "g" })).toBe("250 г");
    expect(packLabel({ value: "1500", unit: "g" })).toBe("1,5 кг");
    expect(packLabel({ value: "16.0000", unit: "pc" })).toBe("16 бр.");
    expect(packLabel({ value: "1", unit: "pc" })).toBe("1 бр.");
    expect(packLabel({ value: "700", unit: "ml" })).toBe("700 мл");
    expect(packLabel({ value: "1000", unit: "ml" })).toBe("1 л");
  });

  it("is null for a size it cannot state", () => {
    expect(packLabel(null)).toBeNull();
    expect(packLabel({ value: "0", unit: "g" })).toBeNull();
    expect(packLabel({ value: "-5", unit: "g" })).toBeNull();
    expect(packLabel({ value: "abc", unit: "g" })).toBeNull();
    expect(packLabel({ value: "2.5", unit: "pc" })).toBeNull();
    expect(packLabel({ value: "10", unit: "oz" })).toBeNull();
  });
});

describe("where the system badge links", () => {
  it("is the product's own category that binds it to the system", () => {
    expect(systemListingHref("dolce-gusto", CAPSULE.categories)).toBe("/categories/dolce-gusto");
  });

  it("matches on the source key when the storefront slug was renamed", () => {
    expect(
      systemListingHref("beans", [{ slug: "zarna-novo-ime", sourceKey: "kafe-na-zyrna" }]),
    ).toBe("/categories/zarna-novo-ime");
  });

  it("is null rather than a guess when no category of the product belongs to the system", () => {
    expect(systemListingHref("nespresso-original", CAPSULE.categories)).toBeNull();
    expect(systemListingHref("dolce-gusto", [])).toBeNull();
    expect(systemListingHref(null, CAPSULE.categories)).toBeNull();
    expect(systemListingHref("vertuo", CAPSULE.categories)).toBeNull();
  });
});

describe("compatibility", () => {
  it("names the system for every capsule system, and says nothing for beans", () => {
    for (const system of BREWING_SYSTEMS) {
      const line = compatibilityLine(system);
      if (system.method === "capsule") expect(line).toBe(`Става за машини ${system.name}.`);
      if (system.method === "pod")
        expect(line).toBe("Става за еспресо машини с цедка за дози ESE.");
      if (system.method === "beans") expect(line).toBeNull();
      expect(line ?? "").not.toMatch(/оригинал/i);
    }
    expect(compatibilityLine(null)).toBeNull();
  });

  it("lists only machines the machine database assigns to the system", () => {
    for (const system of BREWING_SYSTEMS) {
      const known = new Map<string, string>();
      for (const brand of MACHINE_BRANDS) {
        for (const model of brand.models) {
          if (model.system !== system.id) continue;
          known.set(
            model.name.startsWith(brand.name) ? model.name : `${brand.name} ${model.name}`,
            `/wizard/machines/${brand.slug}`,
          );
        }
      }

      const machines = compatibleMachines(system.id);
      expect(machines.total).toBe(known.size);
      expect(machines.shown.length).toBe(Math.min(known.size, COMPATIBLE_MACHINE_LIMIT));
      for (const machine of machines.shown) {
        expect(known.get(machine.name), `${system.id}: ${machine.name}`).toBe(machine.href);
      }
    }
  });

  it("caps the list and still shows every maker of a shared format", () => {
    const caffitaly = compatibleMachines("caffitaly");
    expect(caffitaly.shown).toHaveLength(COMPATIBLE_MACHINE_LIMIT);
    expect(caffitaly.total).toBeGreaterThan(COMPATIBLE_MACHINE_LIMIT);
    expect(caffitaly.crossFormatBrands).toEqual(["Tchibo", "K-fee"]);
    expect(compatibleMachines("caffitaly", 3).shown).toHaveLength(3);
  });

  it("is empty for an unknown system", () => {
    expect(compatibleMachines("vertuo")).toEqual({ shown: [], total: 0, crossFormatBrands: [] });
    expect(compatibleMachines(null).shown).toEqual([]);
  });

  it("renders the section for a capsule, with the cross-format sentence where it applies", () => {
    const caffitaly = getBrewingSystem("caffitaly")!;
    const markup = html(createElement(ProductCompatibility, { system: caffitaly }));
    expect(markup).toContain("<h2");
    expect(markup).toContain("Става за тези машини");
    expect(markup).toContain(caffitaly.recognise);
    expect(stripTags(markup)).toContain("Машините Tchibo и K-fee приемат същия формат капсула.");
    expect(markup).toContain('href="/wizard/machines"');
    expect(stripTags(markup)).toMatch(/Показани са 12 от \d+ модела\./);

    const nespresso = html(
      createElement(ProductCompatibility, { system: getBrewingSystem("nespresso-original")! }),
    );
    expect(nespresso).not.toContain("приемат същия формат");
  });

  it("renders nothing for beans", () => {
    expect(html(createElement(ProductCompatibility, { system: getBrewingSystem("beans")! }))).toBe(
      "",
    );
  });
});

describe("FactsTable", () => {
  it("keeps the fixed order when every row has a value", () => {
    const markup = html(createElement(FactsTable, { product: BEANS_ENRICHED }));
    expect(labels(markup)).toEqual([
      "Система",
      "Интензивност",
      "Състав",
      "Произход",
      "Изпичане",
      "Кофеин",
      "Ароматизирано",
      "Опаковка",
      "Цена на чаша",
      "Цена за килограм",
      "Код",
      "Категория",
    ]);
  });

  it("is correct with every enriched fact null — today's catalog", () => {
    const markup = html(createElement(FactsTable, { product: CAPSULE }));
    expect(labels(markup)).toEqual([
      "Система",
      "Интензивност",
      "Кофеин",
      "Ароматизирано",
      "Опаковка",
      "Цена на чаша",
      "Категория",
    ]);
    for (const absent of ["Състав", "Произход", "Изпичане", "Код", "Цена за килограм"]) {
      expect(markup).not.toContain(absent);
    }
  });

  it("omits a row without data instead of printing a dash or a placeholder", () => {
    for (const product of [CAPSULE, BEANS_ENRICHED, EMPTY]) {
      const markup = html(createElement(FactsTable, { product }));
      expect(markup).not.toMatch(/<dd[^>]*>\s*<\/dd>/);
      expect(markup).not.toMatch(/<dd[^>]*>\s*[-–—]\s*<\/dd>/);
      expect(markup).not.toMatch(/няма данни|null|undefined|NaN/);
    }
  });

  it("renders nothing at all when the record holds no fact", () => {
    expect(factRows(EMPTY)).toEqual([]);
    expect(html(createElement(FactsTable, { product: EMPTY }))).toBe("");
  });

  it("treats blank text as absent", () => {
    const blank: FactsTableProduct = {
      ...EMPTY,
      origin: "   ",
      roast: "",
      sku: " ",
      intensity: "  ",
      weight: " ",
      attributes: { decaf: "", aromas: " " },
    };
    expect(factRows(blank)).toEqual([]);
  });

  it("drops each row independently", () => {
    const only = (patch: Partial<FactsTableProduct>) =>
      labels(html(createElement(FactsTable, { product: { ...EMPTY, ...patch } })));

    expect(only({ systemId: "ese-pod" })).toEqual(["Система"]);
    expect(only({ intensity: "4 от 5" })).toEqual(["Интензивност"]);
    expect(only({ attributes: { strength: "weak" } })).toEqual(["Интензивност"]);
    expect(only({ arabicaPercent: 100 })).toEqual(["Състав"]);
    expect(only({ origin: "Бразилия" })).toEqual(["Произход"]);
    expect(only({ roast: "тъмно" })).toEqual(["Изпичане"]);
    expect(only({ attributes: { decaf: "yes" } })).toEqual(["Кофеин"]);
    expect(only({ attributes: { aromas: "no" } })).toEqual(["Ароматизирано"]);
    expect(only({ pack: { value: "10", unit: "pc" } })).toEqual(["Опаковка"]);
    expect(only({ servingPrice: { formatted: "0,31 € на чаша", estimated: false } })).toEqual([
      "Цена на чаша",
    ]);
    expect(only({ unitPrice: BEANS_ENRICHED.unitPrice })).toEqual(["Цена за килограм"]);
    expect(only({ sku: "X-1" })).toEqual(["Код"]);
    expect(only({ categories: CAPSULE.categories })).toEqual(["Категория"]);
    // An unknown system is no system: a badge is never guessed.
    expect(only({ systemId: "vertuo" as never })).toEqual([]);
  });

  describe("formatting", () => {
    const enriched = html(createElement(FactsTable, { product: BEANS_ENRICHED }));
    const capsule = html(createElement(FactsTable, { product: CAPSULE }));

    it("system: the badge, named, linked to the product's own system category", () => {
      const value = cell(capsule, "Система");
      expect(value).toContain('data-system="dolce-gusto"');
      expect(value).toContain('href="/categories/dolce-gusto"');
      expect(stripTags(value)).toBe("Dolce Gusto");
      expect(value).toContain("min-h-6");

      expect(cell(enriched, "Система")).toContain('href="/categories/kafe-na-zarna"');
    });

    it("system: unlinked when the product has no category of that system", () => {
      const markup = html(createElement(FactsTable, { product: { ...CAPSULE, categories: [] } }));
      expect(cell(markup, "Система")).not.toContain("<a ");
      expect(stripTags(cell(markup, "Система"))).toBe("Dolce Gusto");
    });

    it("intensity: the band word, then the scale on the product's own maximum", () => {
      const value = cell(capsule, "Интензивност");
      expect(stripTags(value)).toBe("СредноИнтензивност 8 от 12");
      expect(value.indexOf("Средно")).toBeLessThan(value.indexOf("8 от 12"));
      // Page size: the 120 px track, twelve segments of it.
      expect(value).toContain("w-30");
      expect((value.match(/bg-pine-700/g) ?? []).length).toBe(8);
      expect((value.match(/bg-line/g) ?? []).length).toBe(4);

      expect(stripTags(cell(enriched, "Интензивност"))).toBe("СилноИнтензивност 7 от 10");
    });

    it("intensity: the band alone, the scale alone, and an unknown band left out", () => {
      const row = (patch: Partial<FactsTableProduct>) =>
        stripTags(
          cell(
            html(createElement(FactsTable, { product: { ...EMPTY, ...patch } })),
            "Интензивност",
          ),
        );

      expect(row({ attributes: { strength: "weak" } })).toBe("Слабо");
      expect(row({ intensity: "12 от 13" })).toBe("Интензивност 12 от 13");
      expect(row({ intensity: "5 от 9", attributes: { strength: "extreme" } })).toBe(
        "Интензивност 5 от 9",
      );
      // Unparsed: the raw text, never a bare numeral dressed up as a scale.
      expect(row({ intensity: "силно" })).toBe("Интензивност силно");
    });

    it("composition, origin and roast: as stated", () => {
      expect(cell(enriched, "Състав")).toBe("70% арабика");
      expect(cell(enriched, "Произход")).toBe("Уганда и Индия");
      expect(cell(enriched, "Изпичане")).toBe("Средно тъмно");
    });

    it("caffeine and flavouring: words, not tokens", () => {
      expect(cell(capsule, "Кофеин")).toBe("С кофеин");
      expect(cell(enriched, "Кофеин")).toBe("Без кофеин");
      expect(cell(capsule, "Ароматизирано")).toBe("Не");
      expect(cell(enriched, "Ароматизирано")).toBe("Да");
    });

    it("pack: a tabular figure with its unit, falling back to the recorded text", () => {
      expect(stripTags(cell(capsule, "Опаковка"))).toBe("16 бр.");
      expect(cell(capsule, "Опаковка")).toContain("tabular-nums");
      expect(stripTags(cell(enriched, "Опаковка"))).toBe("1 кг");

      const raw = html(createElement(FactsTable, { product: { ...EMPTY, weight: " 2 кутии " } }));
      expect(stripTags(cell(raw, "Опаковка"))).toBe("2 кутии");
    });

    it("price per cup: exact for counted pieces, marked and explained when estimated", () => {
      expect(stripTags(cell(capsule, "Цена на чаша"))).toBe("0,35 € на чаша");
      expect(cell(capsule, "Цена на чаша")).not.toContain("Изчислено");

      const estimated = cell(enriched, "Цена на чаша");
      expect(estimated).toContain("≈ 0,22 € на чаша");
      expect(stripTags(estimated)).toContain("Изчислено при 7 г кафе на чаша.");
      expect(estimated).toContain("tabular-nums");
    });

    it("unit price: per kilogram, or per litre for goods sold by volume", () => {
      expect(stripTags(cell(enriched, "Цена за килограм"))).toBe("32,00 € / кг");

      const litre = html(
        createElement(FactsTable, {
          product: {
            ...EMPTY,
            unitPrice: { amount: "12.0000", currency: "EUR", formatted: "12,00 € / л" },
          },
        }),
      );
      expect(labels(litre)).toEqual(["Цена за литър"]);
    });

    it("code and categories", () => {
      expect(cell(enriched, "Код")).toBe("AB-1234");
      const categories = html(
        createElement(FactsTable, {
          product: {
            ...EMPTY,
            categories: [
              { slug: "a", sourceKey: null, name: "Първа", isPrimary: true, parentSlug: null },
              { slug: "b", sourceKey: null, name: "Втора", isPrimary: false, parentSlug: null },
            ],
          },
        }),
      );
      const value = cell(categories, "Категория");
      expect(stripTags(value)).toBe("Първа, Втора");
      expect(value).toContain('href="/categories/a"');
      expect(value).toContain('href="/categories/b"');
    });
  });

  it("is a description list with one term and one value per row", () => {
    const markup = html(createElement(FactsTable, { product: BEANS_ENRICHED }));
    expect(markup).toMatch(/^<dl /);
    expect((markup.match(/<dt/g) ?? []).length).toBe(12);
    expect((markup.match(/<dd/g) ?? []).length).toBe(12);
    expect(markup).toContain("grid-cols-[40%_1fr]");
  });
});
