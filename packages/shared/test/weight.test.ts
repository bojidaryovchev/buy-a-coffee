import { describe, expect, it } from "vitest";
import { parseWeight, weightIdentityToken } from "../src/weight.ts";

const canonical = (raw: string | null): string | null => parseWeight(raw)?.canonical ?? null;

describe("parseWeight", () => {
  it("parses every pack size observed in the live catalog", () => {
    expect(canonical("1 кг.")).toBe("1000g");
    expect(canonical("0.250кг.")).toBe("250g");
    expect(canonical("0.500кг.")).toBe("500g");
    expect(canonical("10 бр.")).toBe("10pc");
    expect(canonical("16 бр.")).toBe("16pc");
    expect(canonical("20 бр.")).toBe("20pc");
    expect(canonical("25бр.")).toBe("25pc");
    expect(canonical("36 бр.")).toBe("36pc");
    expect(canonical("100 бр.")).toBe("100pc");
    expect(canonical("150бр.")).toBe("150pc");
  });

  it("keeps kilograms and grams interchangeable", () => {
    // This is the whole point: identity must not fork when the source
    // switches notation between syncs.
    expect(canonical("1 кг.")).toBe(canonical("1000 г"));
    expect(canonical("0.250кг.")).toBe(canonical("250 гр."));
    expect(canonical("1kg")).toBe(canonical("1 кг."));
  });

  it("must not read kilograms as grams", () => {
    // The `г` rule would swallow `кг` if rule order were wrong.
    expect(parseWeight("1 кг.")?.value).toBe("1000");
    expect(parseWeight("1 г")?.value).toBe("1");
  });

  it("handles the comma decimal notation", () => {
    expect(canonical("0,250 кг")).toBe("250g");
  });

  it("normalises volumes", () => {
    expect(canonical("1 л")).toBe("1000ml");
    expect(canonical("330 мл")).toBe("330ml");
  });

  it("returns null when the source omits a size", () => {
    // /rema-caffe-intenso/ genuinely has no weight row.
    expect(parseWeight("")).toBeNull();
    expect(parseWeight(null)).toBeNull();
    expect(parseWeight(undefined)).toBeNull();
    expect(parseWeight("   ")).toBeNull();
  });

  it("returns null for unit-less or unrecognised text", () => {
    expect(parseWeight("1")).toBeNull();
    expect(parseWeight("голям")).toBeNull();
    expect(parseWeight("1 парсек")).toBeNull();
  });

  it("preserves the raw text for auditing", () => {
    expect(parseWeight("  0.250кг.  ")?.raw).toBe("0.250кг.");
  });

  it("keeps fractional base units when they are not whole", () => {
    expect(canonical("0.0005 кг")).toBe("0.5g");
  });

  it("produces an empty identity token for a missing size", () => {
    expect(weightIdentityToken(null)).toBe("");
    expect(weightIdentityToken(parseWeight("1 кг."))).toBe("1000g");
  });

  it("separates the two products that share /borbone-crema-classica/", () => {
    // The single most important behaviour in this module.
    expect(canonical("0.500кг.")).not.toBe(canonical("1 кг."));
  });
});
