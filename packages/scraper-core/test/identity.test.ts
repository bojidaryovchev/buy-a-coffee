import { describe, expect, it } from "vitest";
import {
  assignUniqueSlug,
  normalizeSourceSlug,
  resolveProductIdentity,
} from "../src/catalog/identity.ts";

describe("resolveProductIdentity", () => {
  it("combines path and normalised pack size by default", () => {
    const identity = resolveProductIdentity({
      path: "/lavazza-super-crema/",
      weightText: "1 кг.",
    });
    expect(identity.sourceKey).toBe("/lavazza-super-crema/#1000g");
    expect(identity.strategy).toBe("path_and_size");
    expect(identity.variantKey).toBe("1000g");
  });

  it("separates the two products that share one URL", () => {
    // The single most important behaviour in the catalog layer.
    const half = resolveProductIdentity({ path: "/borbone-crema-classica/", weightText: "0.500кг." });
    const full = resolveProductIdentity({ path: "/borbone-crema-classica/", weightText: "1 кг." });
    expect(half.sourceKey).toBe("/borbone-crema-classica/#500g");
    expect(full.sourceKey).toBe("/borbone-crema-classica/#1000g");
    expect(half.sourceKey).not.toBe(full.sourceKey);
  });

  it("collapses the duplicated CMS record that is genuinely the same product", () => {
    const a = resolveProductIdentity({ path: "/eurocaf-piacere-oro/", weightText: "1 кг." });
    const b = resolveProductIdentity({ path: "/eurocaf-piacere-oro/", weightText: "1 кг." });
    expect(a.sourceKey).toBe(b.sourceKey);
  });

  it("is stable across equivalent pack-size notations", () => {
    const a = resolveProductIdentity({ path: "/x/", weightText: "1 кг." });
    const b = resolveProductIdentity({ path: "/x/", weightText: "1000 г" });
    expect(a.sourceKey).toBe(b.sourceKey);
  });

  it("falls back to the path alone when there is no pack size", () => {
    const identity = resolveProductIdentity({ path: "/rema-caffe-intenso/", weightText: "" });
    expect(identity.sourceKey).toBe("/rema-caffe-intenso/");
    expect(identity.strategy).toBe("path");
  });

  it("prefers an explicit source id over everything else", () => {
    const identity = resolveProductIdentity({
      path: "/x/",
      weightText: "1 кг.",
      sourceId: "1182",
    });
    expect(identity.sourceKey).toBe("id:1182");
    expect(identity.strategy).toBe("source_id");
  });

  it("prefers a SKU over the path", () => {
    const identity = resolveProductIdentity({ path: "/x/", weightText: "1 кг.", sku: "LSC-1KG" });
    expect(identity.sourceKey).toBe("sku:LSC-1KG");
    expect(identity.strategy).toBe("sku");
  });

  it("normalises path shape so trailing slashes cannot fork identity", () => {
    expect(resolveProductIdentity({ path: "/x" }).sourceKey).toBe("/x/");
    expect(resolveProductIdentity({ path: "x/" }).sourceKey).toBe("/x/");
    expect(resolveProductIdentity({ path: "" }).sourceKey).toBe("/");
  });

  it("keeps path case, because the source is case-sensitive", () => {
    expect(resolveProductIdentity({ path: "/Lavazza/" }).sourceKey).toBe("/Lavazza/");
  });
});

describe("normalizeSourceSlug", () => {
  it("trims the leading space in the real brand slug", () => {
    expect(normalizeSourceSlug(" vergnano")).toBe("vergnano");
    expect(normalizeSourceSlug("BIANCHI ")).toBe("bianchi");
  });

  it("maps blank values to null", () => {
    expect(normalizeSourceSlug("")).toBeNull();
    expect(normalizeSourceSlug("   ")).toBeNull();
    expect(normalizeSourceSlug(null)).toBeNull();
    expect(normalizeSourceSlug(undefined)).toBeNull();
  });
});

describe("assignUniqueSlug", () => {
  it("returns the plain slug when it is free", () => {
    const taken = new Set<string>();
    expect(assignUniqueSlug("Кафе на зърна Lavazza Super Crema 1кг.", taken)).toBe(
      "kafe-na-zarna-lavazza-super-crema-1kg",
    );
  });

  it("disambiguates a collision with the pack size", () => {
    const taken = new Set<string>();
    const first = assignUniqueSlug("Borbone Crema Classica", taken, { variantKey: "500g" });
    const second = assignUniqueSlug("Borbone Crema Classica", taken, { variantKey: "1000g" });
    expect(first).toBe("borbone-crema-classica");
    expect(second).toBe("borbone-crema-classica-1000g");
    expect(first).not.toBe(second);
  });

  it("falls back to a numeric suffix when the variant is also taken", () => {
    const taken = new Set(["x", "x-1000g"]);
    expect(assignUniqueSlug("x", taken, { variantKey: "1000g" })).toBe("x-2");
  });

  it("never produces an empty slug", () => {
    const taken = new Set<string>();
    expect(assignUniqueSlug("!!!", taken)).toBe("product");
  });

  it("registers each allocation so later calls see it", () => {
    const taken = new Set<string>();
    assignUniqueSlug("Coffee", taken);
    expect(taken.has("coffee")).toBe(true);
  });
});
