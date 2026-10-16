import { describe, expect, it } from "vitest";
import { INSTANT_COFFEE_PATTERN, isInstantCoffeeName, productKind } from "../src/product-kind.ts";
import fixture from "./fixtures/product-names.json" with { type: "json" };

const records = fixture as ReadonlyArray<{ sourceKey: string; sourceName: string }>;

describe("productKind", () => {
  it("finds exactly the five instant coffees in the catalog", () => {
    const instant = records.filter((record) => productKind(record.sourceName) === "instant");
    expect(instant.map((record) => record.sourceKey).sort()).toEqual([
      "/bianchi-200/#200g",
      "/ristora-gold-200/#200g",
      "/ristora-green-200/#200g",
      "/ristora-red-200/#200g",
      "/vandino-supreme-500/#500g",
    ]);
  });

  it("reads the name, in either word order and either word, whatever the case", () => {
    expect(isInstantCoffeeName("Разтворимо кафе Ristora Gold 0.200кг.")).toBe(true);
    expect(isInstantCoffeeName("РАЗТВОРИМО  КАФЕ Bianchi")).toBe(true);
    expect(isInstantCoffeeName("Кафе разтворимо Vandino 500 г")).toBe(true);
    expect(isInstantCoffeeName("Инстантно кафе Example 100 г")).toBe(true);
  });

  it("calls everything else roasted coffee", () => {
    expect(productKind("Кафе на зърна Moreno Vending 1кг.")).toBe("roasted");
    expect(productKind("Капсули DG Rema Caffè Cappuccino 3in1 16 бр.")).toBe("roasted");
    expect(productKind("")).toBe("roasted");
    expect(productKind(null)).toBe("roasted");
    // Whole words only.
    expect(isInstantCoffeeName("Кафе неразтворимо")).toBe(false);
    expect(isInstantCoffeeName("Разтворимокафе")).toBe(false);
  });

  it("matches over transliterated text, as the SQL that shares the pattern does", () => {
    // `catalog_translit` lower-cases and folds Cyrillic exactly as
    // `transliterate` does, so the storefront's queries reuse this string.
    const pattern = new RegExp(INSTANT_COFFEE_PATTERN);
    expect(pattern.test("raztvorimo kafe ristora gold 0.200kg.")).toBe(true);
    expect(pattern.test("kafe na zarna moreno vending 1kg.")).toBe(false);
  });
});
