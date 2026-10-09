import { slugDiscriminator } from "@catalog/shared";
import { describe, expect, it } from "vitest";
import {
  assignProductSlug,
  normalizeSourceSlug,
  resolveProductIdentity,
} from "../src/catalog/identity.ts";
import { normalizeProduct } from "../src/catalog/normalize.ts";

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
    const half = resolveProductIdentity({
      path: "/borbone-crema-classica/",
      weightText: "0.500кг.",
    });
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

  it("never keys a product on its product code", () => {
    // The type refuses a code outright...
    // @ts-expect-error a product code is not an identity input
    const typed = resolveProductIdentity({ path: "/x/", weightText: "1 кг.", sku: "00072" });
    expect(typed.sourceKey).toBe("/x/#1000g");
    expect(typed.strategy).toBe("path_and_size");

    // ...and one that slips past the type (untyped JSON, a cast) is ignored.
    const smuggled = resolveProductIdentity({
      path: "/x/",
      weightText: "1 кг.",
      sku: "00072",
    } as unknown as Parameters<typeof resolveProductIdentity>[0]);
    expect(smuggled.sourceKey).toBe("/x/#1000g");
    expect(smuggled.strategy).toBe("path_and_size");
  });

  it("keeps a listing that states a product code on its path-shaped key", () => {
    const withCode = normalizeProduct(
      {
        path: "/amann-cascada-500/",
        url: "https://www.kafezona.com/amann-cascada-500/",
        name: "Amann Cascada 0.500кг.",
        weightText: "0.500кг.",
        sku: "00072",
      },
      { sourceSite: "kafezona" },
    );
    expect(withCode.sku).toBe("00072");
    expect(withCode.sourceKey).toBe("/amann-cascada-500/#500g");
    expect(withCode.identityStrategy).toBe("path_and_size");
    expect(withCode.sourceKey.startsWith("sku:")).toBe(false);
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

describe("assignProductSlug", () => {
  const superCrema = {
    sourceName: "Кафе на зърна Lavazza Super Crema 1кг.",
    sourceKey: "/lavazza-super-crema-1/#1000g",
    brand: { sourceKey: "lavazza", name: "LAVAZZA" },
    categoryKeys: ["kafe-na-zyrna"],
    packValue: "1000",
    packUnit: "g",
  };

  it("leads with the brand and the line, in the shop's own words", () => {
    expect(assignProductSlug(superCrema, new Set())).toBe("lavazza-super-crema-kafe-na-zarna-1-kg");
  });

  it("tells two pack sizes of one coffee apart without any tie-break", () => {
    const taken = new Set<string>();
    const borbone = {
      sourceName: "Кафе на зърна Borbone Crema Classica 0.500кг.",
      brand: { sourceKey: "borbone", name: "BORBONE" },
      categoryKeys: ["kafe-na-zyrna"],
      packUnit: "g",
    };
    expect(
      assignProductSlug(
        { ...borbone, sourceKey: "/borbone-crema-classica/#500g", packValue: "500" },
        taken,
      ),
    ).toBe("borbone-crema-classica-kafe-na-zarna-500-g");
    expect(
      assignProductSlug(
        {
          ...borbone,
          sourceName: "Кафе на зърна Borbone Crema Classica 1кг.",
          sourceKey: "/borbone-crema-classica/#1000g",
          packValue: "1000",
        },
        taken,
      ),
    ).toBe("borbone-crema-classica-kafe-na-zarna-1-kg");
  });

  it("settles a real collision from the newcomer's source key, never a counter", () => {
    const taken = new Set(["lavazza-super-crema-kafe-na-zarna-1-kg"]);
    const slug = assignProductSlug({ ...superCrema, sourceKey: "/another-address/#1000g" }, taken);
    expect(slug).toBe(
      `lavazza-super-crema-kafe-na-zarna-1-kg-${slugDiscriminator("/another-address/#1000g")}`,
    );
    // The same product, met in another run or another database, gets the same slug.
    expect(
      assignProductSlug(
        { ...superCrema, sourceKey: "/another-address/#1000g" },
        new Set(["lavazza-super-crema-kafe-na-zarna-1-kg"]),
      ),
    ).toBe(slug);
  });

  it("never produces an empty slug", () => {
    expect(assignProductSlug({ sourceName: "!!!", sourceKey: "/x/" }, new Set())).toBe("product");
  });

  it("registers each allocation so later calls see it", () => {
    const taken = new Set<string>();
    const slug = assignProductSlug(superCrema, taken);
    expect(taken.has(slug)).toBe(true);
  });
});
