import { describe, expect, it } from "vitest";
import { GRAMS_PER_SERVING } from "@catalog/shared";
import {
  EMPTY_JOURNAL_FIGURES,
  computeJournalFigures,
  systemOfRow,
} from "@/lib/catalog/journal-figures";
import { FIXTURE_FIGURES, FIXTURE_ROWS, row } from "./journal-fixtures";

/* Intl separates amount and symbol with a no-break space. */
const plain = (value: string): string => value.replace(/\s/g, " ");

describe("journal figures: an empty catalog", () => {
  it("yields no figures rather than placeholders", () => {
    expect(computeJournalFigures([], "EUR")).toEqual(EMPTY_JOURNAL_FIGURES);
  });

  it("yields no price figures when nothing has a price", () => {
    const figures = computeJournalFigures(
      [row({ category: "nespresso", price: null }), row({ category: "kafe-na-zarna", price: "" })],
      "EUR",
    );
    expect(figures.cupCost).toBeNull();
    // The products still exist, so the format counts do.
    expect(figures.formats?.byMethod.capsule?.products).toBe(1);
  });
});

describe("journal figures: systems", () => {
  it("binds a product to its system by slug or by source key", () => {
    const bySlug = row({ category: "nespresso" });
    const byKey = {
      ...row({ category: "renamed-upstream" }),
      categories: [{ slug: "renamed-upstream", sourceKey: "kafe-na-zyrna" }],
    };
    expect(systemOfRow(bySlug)?.id).toBe("nespresso-original");
    expect(systemOfRow(byKey)?.id).toBe("beans");
    expect(systemOfRow(row({ category: "siropi" }))).toBeNull();
  });
});

describe("journal figures: price per cup", () => {
  const cupCost = FIXTURE_FIGURES.cupCost!;

  it("divides a piece-count pack exactly and marks nothing as estimated", () => {
    const capsules = cupCost.byMethod.capsule!;
    expect(capsules.count).toBe(3);
    expect(capsules.cheapest.slug).toBe("nespresso-hundred");
    expect(capsules.cheapest.perCupAmount).toBe("0.3325");
    expect(plain(capsules.cheapest.perCup)).toBe("0,33 €");
    expect(capsules.cheapest.estimated).toBe(false);
    expect(capsules.dearest.slug).toBe("nespresso-ten");
  });

  it("derives beans from weight at the shared constant and marks them estimated", () => {
    const beans = cupCost.byMethod.beans!;
    expect(beans.cheapest.slug).toBe("beans-kilo");
    expect(beans.cheapest.servings).toBe(Math.floor(1000 / GRAMS_PER_SERVING));
    expect(beans.cheapest.estimated).toBe(true);
    expect(beans.cheapest.perCup.startsWith("≈ ")).toBe(true);
  });

  it("lists only systems that have a priced pack, in catalog order", () => {
    expect(cupCost.bySystem.map(({ system }) => system.id)).toEqual([
      "nespresso-original",
      "dolce-gusto",
      "ese-pod",
      "beans",
    ]);
  });

  it("finds the pair where shelf price and cup price disagree", () => {
    expect(cupCost.reversal?.bigger.slug).toBe("nespresso-hundred");
    expect(cupCost.reversal?.smaller.slug).toBe("nespresso-ten");
  });

  it("prefers a pair counted by the piece to one estimated from weight", () => {
    // Beans alone do produce a reversal — the kilo against the quarter-kilo —
    const beansOnly = computeJournalFigures(
      FIXTURE_ROWS.filter((entry) => entry.slug.startsWith("beans-")),
      "EUR",
    );
    expect(beansOnly.cupCost?.reversal?.bigger.slug).toBe("beans-kilo");
    // — but with an exact pair available, the estimate is not the example.
    expect(cupCost.reversal?.bigger.estimated).toBe(false);
  });

  it("among exact pairs, takes the widest gap per cup", () => {
    const figures = computeJournalFigures(
      [
        row({ slug: "big", category: "nespresso", price: "30.00", weightValue: "100.0000" }),
        row({ slug: "near", category: "nespresso", price: "3.10", weightValue: "10.0000" }),
        row({ slug: "far", category: "nespresso", price: "5.00", weightValue: "10.0000" }),
      ],
      "EUR",
    );
    expect(figures.cupCost?.reversal?.bigger.slug).toBe("big");
    expect(figures.cupCost?.reversal?.smaller.slug).toBe("far");
  });

  it("never pairs packs for different systems", () => {
    // 100 Nespresso against 16 Dolce Gusto would be a reversal, but nobody
    // owns a machine that takes both.
    const figures = computeJournalFigures(
      FIXTURE_ROWS.filter(
        (entry) => entry.slug !== "nespresso-ten" && entry.slug !== "beans-quarter",
      ),
      "EUR",
    );
    expect(figures.cupCost?.reversal).toBeNull();
  });

  it("refuses a reversal that vanishes when rounded for display", () => {
    const figures = computeJournalFigures(
      [
        row({ category: "nespresso", price: "33.00", weightValue: "100.0000" }),
        row({ category: "nespresso", price: "3.31", weightValue: "10.0000" }),
      ],
      "EUR",
    );
    // 0.3300 against 0.3310: different, and both print as 0,33 €.
    expect(figures.cupCost?.reversal).toBeNull();
  });

  it("compares amounts as decimals, not as text", () => {
    // "9.00" sorts after "10.00" as a string; as money it is the cheaper cup.
    const figures = computeJournalFigures(
      [
        row({ slug: "nine", category: "nespresso", price: "9.00", weightValue: "1.0000" }),
        row({ slug: "ten", category: "nespresso", price: "10.00", weightValue: "1.0000" }),
      ],
      "EUR",
    );
    expect(figures.cupCost?.byMethod.capsule?.cheapest.slug).toBe("nine");
    expect(figures.cupCost?.byMethod.capsule?.dearest.slug).toBe("ten");
  });

  it("says whether beans undercut capsules, on exact amounts", () => {
    expect(cupCost.beansUndercutCapsules).toBe(true);

    const dearBeans = computeJournalFigures(
      [
        row({
          category: "kafe-na-zarna",
          price: "90.00",
          weightValue: "250.0000",
          weightUnit: "g",
        }),
        row({ category: "nespresso", price: "3.00", weightValue: "10.0000" }),
      ],
      "EUR",
    );
    expect(dearBeans.cupCost?.beansUndercutCapsules).toBe(false);
  });

  it("leaves out a product priced in another currency", () => {
    const figures = computeJournalFigures(
      [row({ category: "nespresso", currency: "BGN" }), row({ category: "nespresso" })],
      "EUR",
    );
    expect(figures.cupCost?.byMethod.capsule?.count).toBe(1);
  });
});

describe("journal figures: formats", () => {
  const formats = FIXTURE_FIGURES.formats!;

  it("counts products per method and ignores what is not coffee", () => {
    expect(formats.byMethod.beans?.products).toBe(2);
    expect(formats.byMethod.capsule?.products).toBe(3);
    expect(formats.byMethod.pod?.products).toBe(1);
  });

  it("prints pack sizes smallest first, in the customer's units", () => {
    expect(formats.byMethod.beans?.packs).toEqual(["250 г", "1 кг"]);
    expect(formats.byMethod.capsule?.packs).toEqual(["10", "16", "100"]);
  });
});

describe("journal figures: intensity", () => {
  const intensity = FIXTURE_FIGURES.intensity!;

  it("counts declared and undeclared products", () => {
    expect(intensity.total).toBe(FIXTURE_ROWS.length);
    expect(intensity.declared).toBe(5);
    expect(intensity.undeclared).toBe(2);
  });

  it("lists the scales in use with their brands", () => {
    expect(intensity.scales).toEqual([
      { max: 10, products: 2, brands: ["ALFA", "GAMA"] },
      { max: 12, products: 2, brands: ["ALFA", "GAMA"] },
      { max: 13, products: 1, brands: ["BETA"] },
    ]);
  });

  it("names the brands that use more than one scale", () => {
    expect(intensity.mixedBrands).toEqual([
      { name: "ALFA", scales: [10, 12] },
      { name: "GAMA", scales: [10, 12] },
    ]);
  });

  it("picks the numeral declared on the most scales", () => {
    expect(intensity.sameNumeral).toEqual({
      value: 8,
      readings: [
        { max: 10, percent: 80 },
        { max: 12, percent: 67 },
        { max: 13, percent: 62 },
      ],
    });
  });

  it("has no shared numeral when every product is on one scale", () => {
    const figures = computeJournalFigures(
      [
        row({ category: "nespresso", intensity: "8 от 10" }),
        row({ category: "nespresso", intensity: "6 от 10" }),
      ],
      "EUR",
    );
    expect(figures.intensity?.sameNumeral).toBeNull();
    expect(figures.intensity?.mixedBrands).toEqual([]);
  });

  it("finds a decaf that still declares an intensity", () => {
    expect(intensity.decafWithIntensity).toEqual({
      slug: "dolce-sixteen",
      name: "Капсули Шестнадесет",
      declared: "7 от 10",
    });
  });

  it("counts the shop's own three steps in weak-to-strong order", () => {
    expect(intensity.strengths.map((step) => step.key)).toEqual(["weak", "medium", "strong"]);
  });
});
