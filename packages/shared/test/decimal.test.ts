import { describe, expect, it } from "vitest";
import {
  DecimalParseError,
  compareDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  rescale,
  stripTrailingZeros,
  toScaledInteger,
} from "../src/decimal.ts";

describe("parseDecimal / formatDecimal", () => {
  it("round-trips exactly", () => {
    for (const input of ["0", "1", "12.34", "0.001", "-5.60", "1000000000000000000.99"]) {
      expect(formatDecimal(parseDecimal(input))).toBe(input.replace(/^\+/, ""));
    }
  });

  it("captures scale from the literal", () => {
    expect(parseDecimal("1.50")).toEqual({ unscaled: 150n, scale: 2 });
    expect(parseDecimal("1.5")).toEqual({ unscaled: 15n, scale: 1 });
    expect(parseDecimal("2")).toEqual({ unscaled: 2n, scale: 0 });
  });

  it("accepts leading-dot and trailing-dot forms", () => {
    expect(formatDecimal(parseDecimal(".5"))).toBe("0.5");
    expect(formatDecimal(parseDecimal("5."))).toBe("5");
  });

  it("throws on garbage", () => {
    expect(() => parseDecimal("abc")).toThrow(DecimalParseError);
    expect(() => parseDecimal("")).toThrow(DecimalParseError);
    expect(() => parseDecimal("1.2.3")).toThrow(DecimalParseError);
  });
});

describe("rescale", () => {
  it("pads without loss", () => {
    expect(formatDecimal(rescale(parseDecimal("1.5"), 3))).toBe("1.500");
  });

  it("rounds half away from zero", () => {
    expect(formatDecimal(rescale(parseDecimal("1.005"), 2))).toBe("1.01");
    expect(formatDecimal(rescale(parseDecimal("1.015"), 2))).toBe("1.02");
    expect(formatDecimal(rescale(parseDecimal("-1.005"), 2))).toBe("-1.01");
    expect(formatDecimal(rescale(parseDecimal("1.004"), 2))).toBe("1.00");
  });

  it("beats binary floating point on the classic cases", () => {
    expect(formatDecimal(rescale(parseDecimal("2.675"), 2))).toBe("2.68");
    expect((2.675).toFixed(2)).toBe("2.67");
  });
});

describe("multiplyDecimal", () => {
  it("multiplies exactly then rounds once", () => {
    expect(formatDecimal(multiplyDecimal(parseDecimal("19.99"), parseDecimal("1.2"), 2))).toBe(
      "23.99",
    );
    expect(formatDecimal(multiplyDecimal(parseDecimal("0.1"), parseDecimal("0.2"), 2))).toBe("0.02");
  });

  it("has no float drift for 0.1 * 3", () => {
    expect(formatDecimal(multiplyDecimal(parseDecimal("0.1"), parseDecimal("3"), 2))).toBe("0.30");
    expect(0.1 * 3).not.toBe(0.3);
  });
});

describe("compareDecimal", () => {
  it("compares across differing scales", () => {
    expect(compareDecimal(parseDecimal("1.50"), parseDecimal("1.5"))).toBe(0);
    expect(compareDecimal(parseDecimal("1.50"), parseDecimal("1.51"))).toBe(-1);
    expect(compareDecimal(parseDecimal("2"), parseDecimal("1.99"))).toBe(1);
  });
});

describe("toScaledInteger", () => {
  it("yields minor units", () => {
    expect(toScaledInteger(parseDecimal("30.00"), 2)).toBe(3000n);
    expect(toScaledInteger(parseDecimal("4.9"), 2)).toBe(490n);
  });
});

describe("stripTrailingZeros", () => {
  it("removes only insignificant zeros", () => {
    expect(stripTrailingZeros("0.5000")).toBe("0.5");
    expect(stripTrailingZeros("250.00")).toBe("250");
    expect(stripTrailingZeros("1000")).toBe("1000");
    expect(stripTrailingZeros("0.000")).toBe("0");
    expect(stripTrailingZeros("100.10")).toBe("100.1");
  });
});
