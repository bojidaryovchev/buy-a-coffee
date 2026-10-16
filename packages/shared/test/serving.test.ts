import { describe, expect, it } from "vitest";
import { divideDecimal, formatDecimal, parseDecimal } from "../src/decimal.ts";
import { GRAMS_PER_SERVING, packServings, pricePerServing } from "../src/serving.ts";

const divide = (a: string, b: string, scale: number) =>
  formatDecimal(divideDecimal(parseDecimal(a), parseDecimal(b), scale));

describe("divideDecimal", () => {
  it("divides exactly when the result terminates", () => {
    expect(divide("10.00", "4", 4)).toBe("2.5000");
    expect(divide("33.25", "100", 4)).toBe("0.3325");
  });

  it("rounds half away from zero", () => {
    expect(divide("1", "8", 2)).toBe("0.13");
    expect(divide("-1", "8", 2)).toBe("-0.13");
    expect(divide("1", "3", 4)).toBe("0.3333");
    expect(divide("2", "3", 4)).toBe("0.6667");
  });

  it("handles a fractional divisor", () => {
    expect(divide("13.45", "142.8571", 4)).toBe("0.0942");
  });

  it("refuses to divide by zero rather than returning Infinity", () => {
    expect(() => divide("1", "0", 2)).toThrow(RangeError);
    expect(() => divide("1", "0.000", 2)).toThrow(RangeError);
  });
});

describe("packServings", () => {
  it("reads a piece count exactly and does not call it an estimate", () => {
    expect(packServings("100", "pc", "roasted")).toEqual({
      exact: "100",
      whole: 100,
      estimated: false,
      gramsPerServing: null,
    });
    expect(packServings("16.0000", "pc", "roasted")).toEqual({
      exact: "16",
      whole: 16,
      estimated: false,
      gramsPerServing: null,
    });
  });

  it("derives servings from weight and marks them estimated", () => {
    const kilo = packServings("1000", "g", "roasted");
    expect(kilo).toEqual({ exact: "142.8571", whole: 142, estimated: true, gramsPerServing: 7 });

    const half = packServings("500", "g", "roasted");
    expect(half?.whole).toBe(71);
    expect(half?.estimated).toBe(true);
  });

  it("counts instant coffee at its own dose, and still calls it an estimate", () => {
    // The two tins on sale: 200 g and 500 g. At the beans' 7 g the first was
    // 28 cups and about four times too dear per cup.
    expect(packServings("200", "g", "instant")).toEqual({
      exact: "100",
      whole: 100,
      estimated: true,
      gramsPerServing: 2,
    });
    expect(packServings("500.0000", "g", "instant")?.exact).toBe("250");
    expect(packServings("200", "g", "roasted")?.whole).toBe(28);
    // A count of pieces assumes no dose, whatever the kind.
    expect(packServings("50", "pc", "instant")).toEqual(packServings("50", "pc", "roasted"));
  });

  it("rounds the displayed count down, never up", () => {
    // 999 g is 142.71 servings; promising 143 would promise a cup that is not there.
    expect(packServings("999", "g", "roasted")?.whole).toBe(142);
  });

  it("returns null for anything it cannot reason about", () => {
    expect(packServings(null, "g", "roasted")).toBeNull();
    expect(packServings("1000", null, "roasted")).toBeNull();
    expect(packServings("0", "pc", "roasted")).toBeNull();
    expect(packServings("-5", "g", "instant")).toBeNull();
    expect(packServings("not a number", "g", "roasted")).toBeNull();
    // Millilitres are a bottle of syrup, not a number of coffees.
    expect(packServings("750", "ml", "roasted")).toBeNull();
  });

  it("uses the documented dose for each kind", () => {
    expect(GRAMS_PER_SERVING).toEqual({ roasted: 7, instant: 2 });
    for (const kind of ["roasted", "instant"] as const) {
      expect(packServings(String(GRAMS_PER_SERVING[kind] * 10), "g", kind)?.whole).toBe(10);
    }
  });
});

describe("pricePerServing", () => {
  it("computes the per-cup price of a capsule pack", () => {
    expect(pricePerServing("5.60", packServings("16", "pc", "roasted"))).toBe("0.3500");
    expect(pricePerServing("33.25", packServings("100", "pc", "roasted"))).toBe("0.3325");
  });

  it("exposes the comparison pack price hides", () => {
    // The larger pack looks five times more expensive and is cheaper per cup.
    const small = pricePerServing("5.60", packServings("16", "pc", "roasted"))!;
    const large = pricePerServing("33.25", packServings("100", "pc", "roasted"))!;
    expect(Number(large)).toBeLessThan(Number(small));
  });

  it("computes the per-cup price of a bean pack", () => {
    expect(pricePerServing("13.45", packServings("1000", "g", "roasted"))).toBe("0.0942");
  });

  it("computes the per-cup price of a tin of instant coffee", () => {
    // 6,15 € for 200 g: about 0,06 € a cup at 2 g, not 0,22 € at 7 g.
    expect(pricePerServing("6.15", packServings("200", "g", "instant"))).toBe("0.0615");
    expect(pricePerServing("6.15", packServings("200", "g", "roasted"))).toBe("0.2153");
  });

  it("keeps enough digits to order the cheapest products", () => {
    const a = pricePerServing("13.45", packServings("1000", "g", "roasted"))!;
    const b = pricePerServing("13.60", packServings("1000", "g", "roasted"))!;
    expect(a).not.toBe(b);
  });

  it("returns null rather than a price when either side is unknown", () => {
    expect(pricePerServing(null, packServings("16", "pc", "roasted"))).toBeNull();
    expect(pricePerServing("5.60", null)).toBeNull();
    expect(pricePerServing("", packServings("16", "pc", "roasted"))).toBeNull();
  });
});
