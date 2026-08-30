import { describe, expect, it } from "vitest";
import {
  moneyEquals,
  moneyFromDecimalString,
  moneyHashToken,
  normalizeNumericString,
  parseMoney,
} from "../src/money.ts";

describe("normalizeNumericString", () => {
  it("treats a two-digit tail as decimals", () => {
    expect(normalizeNumericString("4,90")).toBe("4.90");
    expect(normalizeNumericString("30.00")).toBe("30.00");
  });

  it("treats a lone three-digit tail as grouping, not decimals", () => {
    expect(normalizeNumericString("1,234")).toBe("1234");
    expect(normalizeNumericString("1.234")).toBe("1234");
  });

  it("uses the rightmost separator as the decimal point when both appear", () => {
    expect(normalizeNumericString("1.234,56")).toBe("1234.56");
    expect(normalizeNumericString("1,234.56")).toBe("1234.56");
  });

  it("treats repeated separators as grouping", () => {
    expect(normalizeNumericString("1.234.567")).toBe("1234567");
  });

  it("removes thin/nbsp/apostrophe grouping characters", () => {
    expect(normalizeNumericString("1\u00a0234,50")).toBe("1234.50");
    expect(normalizeNumericString("1'234.50")).toBe("1234.50");
  });

  it("rejects non-numeric input", () => {
    expect(normalizeNumericString("abc")).toBeNull();
    expect(normalizeNumericString("")).toBeNull();
  });
});

describe("parseMoney", () => {
  it("parses the dominant catalog format", () => {
    expect(parseMoney("€30.00")).toEqual({ currency: "EUR", amount: "30.00", minor: 3000n });
  });

  it("parses the comma-decimal outlier seen on /dg-molini-napoli/", () => {
    expect(parseMoney("€4,90")).toEqual({ currency: "EUR", amount: "4.90", minor: 490n });
  });

  it("returns null for genuinely price-less products", () => {
    // /lavazza-gusto-forte/ and /rema-caffe-intenso/ really do ship with no price.
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney("   ")).toBeNull();
    expect(parseMoney("Цена при запитване")).toBeNull();
  });

  it("detects Bulgarian lev as well as euro", () => {
    expect(parseMoney("10,70 лв.")?.currency).toBe("BGN");
    expect(parseMoney("10.70 BGN")?.currency).toBe("BGN");
    expect(parseMoney("$5.00")?.currency).toBe("USD");
  });

  it("decodes HTML entities before parsing", () => {
    expect(parseMoney("&euro;30.00")).toEqual({ currency: "EUR", amount: "30.00", minor: 3000n });
  });

  it("applies a default currency only when none is present", () => {
    expect(parseMoney("30.00", { defaultCurrency: "EUR" })?.currency).toBe("EUR");
    expect(parseMoney("€30.00", { defaultCurrency: "BGN" })?.currency).toBe("EUR");
  });

  it("always normalises to exactly two fraction digits", () => {
    expect(parseMoney("€7")?.amount).toBe("7.00");
    expect(parseMoney("€7.5")?.amount).toBe("7.50");
  });

  it("treats an ambiguous three-digit tail as grouping, matching EU notation", () => {
    // "1.005" is one thousand and five in European notation. Retail prices do
    // not carry three decimals, so grouping is the safer reading.
    expect(parseMoney("€1.005")?.amount).toBe("1005.00");
  });

  it("rounds half away from zero without floating point drift", () => {
    expect(parseMoney("€1.0050")?.amount).toBe("1.01");
    // 2.675 is 2.67499999... in binary floating point; exact math must give 2.68.
    expect(parseMoney("€2.6750")?.amount).toBe("2.68");
    expect(moneyFromDecimalString("1.005", "EUR")?.amount).toBe("1.01");
    expect(moneyFromDecimalString("2.675", "EUR")?.amount).toBe("2.68");
    expect((2.675).toFixed(2)).toBe("2.67"); // proof the naive float path is wrong
  });

  it("survives large values exactly", () => {
    expect(parseMoney("€9007199254740993.01")?.amount).toBe("9007199254740993.01");
  });

  it("ignores surrounding markup noise", () => {
    expect(parseMoney("  Цена: €14.85  ")?.amount).toBe("14.85");
  });
});

describe("moneyEquals / moneyHashToken", () => {
  it("compares exactly, including currency", () => {
    expect(moneyEquals(parseMoney("€30.00"), parseMoney("€30.00"))).toBe(true);
    expect(moneyEquals(parseMoney("€30.00"), parseMoney("€30.01"))).toBe(false);
    expect(moneyEquals(parseMoney("€30.00"), parseMoney("30.00 лв."))).toBe(false);
    expect(moneyEquals(null, null)).toBe(true);
    expect(moneyEquals(parseMoney("€1.00"), null)).toBe(false);
  });

  it("produces a stable hash token", () => {
    expect(moneyHashToken(parseMoney("€30.00"))).toBe("EUR:30.00");
    expect(moneyHashToken(null)).toBe("");
  });

  it("round-trips a stored decimal string", () => {
    expect(moneyFromDecimalString("20.50", "EUR")).toEqual({
      currency: "EUR",
      amount: "20.50",
      minor: 2050n,
    });
    expect(moneyFromDecimalString("not-a-number", "EUR")).toBeNull();
  });
});
