import { describe, expect, it } from "vitest";
import { decidePackSize, parsePackSizeConflict } from "../src/pack-size.ts";
import { packServings, pricePerServing } from "../src/serving.ts";
import { parseWeight } from "../src/weight.ts";

/** The pack field as the sync holds it, parsed from the source's own text. */
const field = (text: string | null) => parseWeight(text);

describe("decidePackSize", () => {
  it("takes the pack field when the name agrees with it", () => {
    expect(decidePackSize("Капсули DG Rema Caffè Cookies 16 бр.", field("16 бр."))).toEqual({
      from: "pack_field",
      named: null,
      label: "16 бр.",
      conflict: null,
    });
  });

  it("takes the name's size when the pack field states another", () => {
    // The real record: an 18-pod tin at 9,20 €, with a pack field of 100.
    const decision = decidePackSize("Дозети Illy Decaffeinato 18бр.", field("100 бр."));
    expect(decision).toEqual({
      from: "name",
      named: { raw: "18 бр.", value: "18", unit: "pc", canonical: "18pc" },
      label: "18 бр.",
      conflict: { inName: "18 бр.", inPackField: "100 бр." },
    });
    // What the rule is for: 0,51 € a cup, not 0,09 €.
    const servings = packServings(decision.named?.value, decision.named?.unit);
    expect(servings).toEqual({ exact: "18", whole: 18, estimated: false });
    expect(pricePerServing("9.20", servings)).toBe("0.5111");
    expect(pricePerServing("9.20", packServings("100", "pc"))).toBe("0.0920");
  });

  it("reads the stored columns as it reads a parsed field", () => {
    // `numeric` comes back padded.
    expect(
      decidePackSize("Дозети Illy Decaffeinato 18бр.", { value: "100.0000", unit: "pc" }).conflict,
    ).toEqual({ inName: "18 бр.", inPackField: "100 бр." });
    // A row the rule has already been applied to is settled.
    expect(
      decidePackSize("Дозети Illy Decaffeinato 18бр.", { value: "18.0000", unit: "pc" }),
    ).toMatchObject({ from: "pack_field", label: "18 бр.", conflict: null });
  });

  it("does not call one size written two ways a conflict", () => {
    expect(decidePackSize("Borbone Crema Classica 0.500кг.", field("500 г"))).toMatchObject({
      from: "pack_field",
      label: "500 г",
      conflict: null,
    });
    expect(decidePackSize("Lavazza Super Crema 1кг.", field("1000 г"))).toMatchObject({
      from: "pack_field",
      label: "1 кг",
      conflict: null,
    });
  });

  it("settles a conflict across units by the name as well", () => {
    expect(decidePackSize("Кафе на зърна Lavazza Super Crema 1кг.", field("500 г"))).toMatchObject({
      from: "name",
      named: { value: "1000", unit: "g", canonical: "1000g" },
      conflict: { inName: "1 кг", inPackField: "500 г" },
    });
    expect(decidePackSize("Капсули Caffitaly Intenso 10 бр.", field("80 г"))).toMatchObject({
      from: "name",
      named: { value: "10", unit: "pc" },
      conflict: { inName: "10 бр.", inPackField: "80 г" },
    });
  });

  it("uses the name's size when the pack field is empty, without calling it a conflict", () => {
    expect(decidePackSize("Кафе на зърна Lavazza Super Crema 1кг.", null)).toEqual({
      from: "name",
      named: { raw: "1 кг", value: "1000", unit: "g", canonical: "1000g" },
      label: "1 кг",
      conflict: null,
    });
    expect(
      decidePackSize("Кафе на зърна Lavazza Super Crema 1кг.", { value: null, unit: null }),
    ).toMatchObject({ from: "name", conflict: null });
  });

  it("keeps the pack field when the name states no size", () => {
    expect(decidePackSize("Lavazza Super Crema", field("1 кг."))).toMatchObject({
      from: "pack_field",
      label: "1 кг",
      conflict: null,
    });
  });

  it("decides nothing when neither states a size", () => {
    expect(decidePackSize("Lavazza Super Crema", null)).toEqual({
      from: null,
      named: null,
      label: null,
      conflict: null,
    });
  });

  it("does not read one part of a multipack as the pack size", () => {
    expect(decidePackSize("Lavazza Qualità Oro 2 x 250 г", field("500 г"))).toMatchObject({
      from: "pack_field",
      label: "500 г",
      conflict: null,
    });
    expect(decidePackSize("Lavazza Qualità Oro 2х250г", field("500 г")).conflict).toBeNull();
    // A line that merely ends in "x" is not a multiplier.
    expect(decidePackSize("Капсули Bianchi Lux 16 бр.", field("10 бр.")).conflict).toEqual({
      inName: "16 бр.",
      inPackField: "10 бр.",
    });
  });

  it("is deterministic", () => {
    const again = () => decidePackSize("Дозети Illy Decaffeinato 18бр.", field("100 бр."));
    expect(again()).toEqual(again());
  });
});

describe("parsePackSizeConflict", () => {
  it("reads a stored conflict and nothing else", () => {
    expect(parsePackSizeConflict({ inName: "18 бр.", inPackField: "100 бр." })).toEqual({
      inName: "18 бр.",
      inPackField: "100 бр.",
    });
    expect(parsePackSizeConflict(null)).toBeNull();
    expect(parsePackSizeConflict(undefined)).toBeNull();
    expect(parsePackSizeConflict("18 бр.")).toBeNull();
    expect(parsePackSizeConflict({ inName: "18 бр." })).toBeNull();
  });
});
