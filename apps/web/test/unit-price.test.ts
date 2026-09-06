import { describe, expect, it } from "vitest";
import { pricePerUnitMeasure } from "@catalog/shared";

/**
 * Unit price — the "цена за единица мярка" price-indication rules require for
 * goods sold by weight or volume.
 *
 * The cases that matter are the ones where returning a number would be worse
 * than returning nothing: a pack sold by the piece, a missing size, and a zero
 * size that would otherwise divide.
 */
describe("pricePerUnitMeasure", () => {
  it("prices a 250 g bag per kilogram", () => {
    expect(pricePerUnitMeasure("9.95", "250", "g")).toEqual({
      amount: "39.8000",
      unit: "kg",
    });
  });

  it("leaves a 1 kg bag at its own price", () => {
    expect(pricePerUnitMeasure("29.90", "1000", "g")).toEqual({
      amount: "29.9000",
      unit: "kg",
    });
  });

  it("prices millilitres per litre", () => {
    expect(pricePerUnitMeasure("4.50", "500", "ml")).toEqual({
      amount: "9.0000",
      unit: "l",
    });
  });

  it("returns null for packs sold by the piece", () => {
    // Capsules are not sold by weight or volume, so the rule does not reach
    // them and a per-kilogram figure would be meaningless.
    expect(pricePerUnitMeasure("5.60", "16", "pc")).toBeNull();
  });

  it("returns null rather than inventing a figure", () => {
    expect(pricePerUnitMeasure(null, "250", "g")).toBeNull();
    expect(pricePerUnitMeasure("9.95", null, null)).toBeNull();
    expect(pricePerUnitMeasure("9.95", "not a number", "g")).toBeNull();
  });

  it("never divides by a zero pack size", () => {
    expect(pricePerUnitMeasure("9.95", "0", "g")).toBeNull();
  });

  it("keeps a repeating division exact to scale", () => {
    // 9.99 / 0.3 kg = 33.30 exactly; 10.00 / 0.3 kg repeats and must not drift.
    expect(pricePerUnitMeasure("9.99", "300", "g")).toEqual({ amount: "33.3000", unit: "kg" });
    expect(pricePerUnitMeasure("10.00", "300", "g")).toEqual({ amount: "33.3333", unit: "kg" });
  });
});
