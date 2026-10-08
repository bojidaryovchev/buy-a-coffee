import { describe, expect, it } from "vitest";
import { normalizeProduct } from "../src/catalog/normalize.ts";
import type { DiscoveredBrand, DiscoveredCategory } from "../src/catalog/discover.ts";
import {
  BRANDS_ARTIFACT_DESCRIPTION,
  CATEGORIES_ARTIFACT_DESCRIPTION,
  PRODUCTS_ARTIFACT_DESCRIPTION,
  exportedSlug,
  exportedTaxonomySlug,
  referenceBrandRecord,
  referenceCategoryRecord,
  referenceProductRecord,
  serialise,
  stableSort,
} from "../src/reference/artifacts.ts";

const OPTIONS = { sourceSite: "kafezona", defaultCurrency: "EUR" } as const;

const product = normalizeProduct(
  {
    path: "/lavazza-super-crema/",
    url: "https://www.kafezona.com/lavazza-super-crema/",
    name: "Кафе на зърна Lavazza Super Crema 1кг.",
    priceText: "€30.00",
    availabilityText: "in_stock",
    weightText: "1 кг.",
    brandKey: "lavazza",
    categoryKeys: ["kafe-na-zyrna"],
    descriptionText: "Fine blend.",
    imageUrls: ["https://www.kafezona.com/img/product-img-1182.jpg-800w.jpg"],
  },
  OPTIONS,
);

describe("exportedSlug", () => {
  it("takes the stored slug for the product's source key", () => {
    const slugs = new Map([[product.sourceKey, "kafe-na-zarna-lavazza-super-crema-1kg"]]);
    expect(exportedSlug(product, slugs)).toBe("kafe-na-zarna-lavazza-super-crema-1kg");
  });

  it("is null for a product the database has not stored, and never invented", () => {
    expect(exportedSlug(product, new Map([["/something-else/#1000g", "other"]]))).toBeNull();
    expect(exportedSlug(product, new Map())).toBeNull();
    expect(exportedSlug(product, undefined)).toBeNull();
  });
});

describe("referenceProductRecord", () => {
  it("exports the storefront slug beside the source key", () => {
    const record = referenceProductRecord(product, "kafe-na-zarna-lavazza-super-crema-1kg");
    expect(record.slug).toBe("kafe-na-zarna-lavazza-super-crema-1kg");
    expect(record.sourceKey).toBe(product.sourceKey);
  });

  it("exports null, not nothing, for a product that has no slug yet", () => {
    // `stableSort` drops undefined, so an absent slug would vanish from the
    // file and a consumer could not tell "not synced" from "old export".
    const record = referenceProductRecord(product, null);
    expect(record).toHaveProperty("slug", null);
    expect(JSON.parse(serialise(record))).toHaveProperty("slug", null);
  });

  it("keeps every field the snapshot already carried", () => {
    expect(Object.keys(referenceProductRecord(product, "x")).sort()).toEqual([
      "attributes",
      "availability",
      "brandKey",
      "categoryKeys",
      "currency",
      "currentPrice",
      "descriptionText",
      "gtin",
      "hasUrlCollision",
      "identityStrategy",
      "name",
      "oldPrice",
      "semanticHash",
      "sku",
      "slug",
      "sourceImageUrls",
      "sourceKey",
      "sourcePath",
      "sourceUrl",
      "sourceVariantKey",
      "weight",
      "weightCanonical",
    ]);
  });

  it("serialises deterministically, whatever order the fields were built in", () => {
    const record = referenceProductRecord(product, "a-slug");
    const reversed = Object.fromEntries(Object.entries(record).reverse());
    expect(serialise(reversed)).toBe(serialise(record));
    expect(serialise(record).endsWith("}\n")).toBe(true);
    expect(Object.keys(stableSort(record) as object)).toEqual(Object.keys(record).sort());
  });

  it("documents the field in the artifact's own description", () => {
    expect(PRODUCTS_ARTIFACT_DESCRIPTION).toContain("`slug`");
  });
});

/* The source renamed its capsule category; the storefront kept its slug. */
const capsules: DiscoveredCategory = {
  sourceKey: "kafe-kapsuli",
  rawSlug: "kafe-kapsuli",
  sourceId: "613",
  name: "Кафе капсули",
  url: "https://www.kafezona.com/kafe-kapsuli/",
  parentKey: null,
  position: 1,
  productCount: 80,
};

const vergnano: DiscoveredBrand = {
  sourceKey: "vergnano",
  rawSlug: " vergnano",
  sourceId: "12",
  name: "VERGNANO",
  url: "https://www.kafezona.com/vergnano/",
  productCount: 4,
};

describe("exportedTaxonomySlug", () => {
  it("takes the stored slug, which need not resemble the source key", () => {
    expect(exportedTaxonomySlug("kafe-kapsuli", new Map([["kafe-kapsuli", "kapsuli"]]))).toBe(
      "kapsuli",
    );
  });

  it("is null when the database has no row for the key, and never derived from it", () => {
    expect(exportedTaxonomySlug("kafe-kapsuli", new Map([["kapsuli", "kapsuli"]]))).toBeNull();
    expect(exportedTaxonomySlug("kafe-kapsuli", new Map())).toBeNull();
    expect(exportedTaxonomySlug("kafe-kapsuli", undefined)).toBeNull();
  });
});

describe("referenceCategoryRecord and referenceBrandRecord", () => {
  it("export our slug beside the source's key and raw slug", () => {
    expect(referenceCategoryRecord(capsules, "kapsuli")).toMatchObject({
      sourceKey: "kafe-kapsuli",
      rawSlug: "kafe-kapsuli",
      slug: "kapsuli",
    });
    expect(referenceBrandRecord(vergnano, "vergnano")).toMatchObject({
      rawSlug: " vergnano",
      slug: "vergnano",
    });
  });

  it("write null, not nothing, for one that has no slug yet", () => {
    expect(JSON.parse(serialise(referenceCategoryRecord(capsules, null)))).toHaveProperty(
      "slug",
      null,
    );
    expect(JSON.parse(serialise(referenceBrandRecord(vergnano, null)))).toHaveProperty(
      "slug",
      null,
    );
  });

  it("keep every field the snapshot already carried, and add only the slug", () => {
    expect(Object.keys(referenceCategoryRecord(capsules, "x")).sort()).toEqual([
      "name",
      "parentKey",
      "position",
      "productCount",
      "rawSlug",
      "slug",
      "sourceId",
      "sourceKey",
      "url",
    ]);
    expect(Object.keys(referenceBrandRecord(vergnano, "x")).sort()).toEqual([
      "name",
      "productCount",
      "rawSlug",
      "slug",
      "sourceId",
      "sourceKey",
      "url",
    ]);
  });

  it("document the field in each artifact's own description", () => {
    expect(CATEGORIES_ARTIFACT_DESCRIPTION).toContain("`slug`");
    expect(BRANDS_ARTIFACT_DESCRIPTION).toContain("`slug`");
  });
});
