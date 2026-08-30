import { describe, expect, it } from "vitest";
import {
  type RawProductRecord,
  buildSemanticFields,
  normalizeProduct,
  parseAvailability,
  parseBooleanAttribute,
  validateNormalizedProduct,
} from "../src/catalog/normalize.ts";

const OPTIONS = { sourceSite: "kafezona", defaultCurrency: "EUR" } as const;

const base: RawProductRecord = {
  path: "/lavazza-super-crema/",
  url: "https://www.kafezona.com/lavazza-super-crema/",
  name: "Кафе на зърна Lavazza Super Crema 1кг.",
  priceText: "€30.00",
  availabilityText: "in_stock",
  weightText: "1 кг.",
  brandKey: "lavazza",
  categoryKeys: ["kafe-na-zyrna"],
  descriptionText: "Fine blend.",
  imageUrls: ["/img/product-img-1182.jpg-800w.jpg"],
};

describe("parseAvailability", () => {
  it("reads the machine values the source emits", () => {
    expect(parseAvailability("in_stock")).toBe("in_stock");
    expect(parseAvailability("out_of_stock")).toBe("out_of_stock");
    expect(parseAvailability("preorder")).toBe("preorder");
  });

  it("reads the Bulgarian labels shown on product pages", () => {
    expect(parseAvailability("В наличност")).toBe("in_stock");
    expect(parseAvailability("Изчерпан")).toBe("out_of_stock");
    expect(parseAvailability("Няма наличност")).toBe("out_of_stock");
    expect(parseAvailability("По заявка")).toBe("preorder");
  });

  it("returns `unknown` rather than guessing", () => {
    // Claiming "in stock" for text we did not understand is the costly error.
    expect(parseAvailability("нещо непознато")).toBe("unknown");
    expect(parseAvailability("")).toBe("unknown");
    expect(parseAvailability(null)).toBe("unknown");
  });
});

describe("parseBooleanAttribute", () => {
  it("understands both languages", () => {
    expect(parseBooleanAttribute("yes")).toBe(true);
    expect(parseBooleanAttribute("да")).toBe(true);
    expect(parseBooleanAttribute("no")).toBe(false);
    expect(parseBooleanAttribute("не")).toBe(false);
    expect(parseBooleanAttribute("maybe")).toBeNull();
  });
});

describe("normalizeProduct", () => {
  it("produces the canonical shape", () => {
    const product = normalizeProduct(base, OPTIONS);
    expect(product.sourceKey).toBe("/lavazza-super-crema/#1000g");
    expect(product.currentPrice?.amount).toBe("30.00");
    expect(product.currency).toBe("EUR");
    expect(product.availability).toBe("in_stock");
    expect(product.weight?.canonical).toBe("1000g");
    expect(product.semanticHash).toHaveLength(64);
  });

  it("keeps a missing price as null instead of zero", () => {
    // A zero price would be published as "free" on the storefront.
    const product = normalizeProduct({ ...base, priceText: "" }, OPTIONS);
    expect(product.currentPrice).toBeNull();
  });

  it("resolves relative image URLs to absolute ones", () => {
    const product = normalizeProduct(base, {
      ...OPTIONS,
      resolveUrl: (value) => new URL(value, "https://www.kafezona.com/").toString(),
    });
    expect(product.sourceImageUrls[0]).toBe(
      "https://www.kafezona.com/img/product-img-1182.jpg-800w.jpg",
    );
  });

  it("de-duplicates image URLs", () => {
    const product = normalizeProduct({ ...base, imageUrls: ["/a.jpg", "/a.jpg", "/b.jpg"] }, OPTIONS);
    expect(product.sourceImageUrls).toEqual(["/a.jpg", "/b.jpg"]);
  });

  it("trims brand and category join keys", () => {
    const product = normalizeProduct({ ...base, brandKey: " vergnano", categoryKeys: [" Kapsuli "] }, OPTIONS);
    expect(product.brandKey).toBe("vergnano");
    expect(product.categoryKeys).toEqual(["kapsuli"]);
  });

  it("drops empty attribute values", () => {
    const product = normalizeProduct(
      { ...base, attributes: { intensity: "8 от 10", decaf: "", aromas: null } },
      OPTIONS,
    );
    expect(product.attributes).toEqual({ intensity: "8 от 10" });
  });

  it("retains the verbatim source record", () => {
    const product = normalizeProduct({ ...base, sourceData: { raw: 1 } }, OPTIONS);
    expect(product.sourceData).toEqual({ raw: 1 });
  });
});

describe("semantic hashing", () => {
  const hash = (overrides: Partial<RawProductRecord>) =>
    normalizeProduct({ ...base, ...overrides }, OPTIONS).semanticHash;

  it("is stable for identical input", () => {
    expect(hash({})).toBe(hash({}));
  });

  it("ignores whitespace-only description differences", () => {
    expect(hash({ descriptionText: "Fine  blend." })).toBe(hash({ descriptionText: "Fine blend." }));
  });

  it("ignores category ordering", () => {
    expect(hash({ categoryKeys: ["a", "b"] })).toBe(hash({ categoryKeys: ["b", "a"] }));
  });

  it("ignores image ordering", () => {
    expect(hash({ imageUrls: ["/a.jpg", "/b.jpg"] })).toBe(hash({ imageUrls: ["/b.jpg", "/a.jpg"] }));
  });

  it("ignores name letter case", () => {
    expect(hash({ name: "LAVAZZA" })).toBe(hash({ name: "lavazza" }));
  });

  it("changes when the price changes", () => {
    expect(hash({ priceText: "€30.00" })).not.toBe(hash({ priceText: "€30.01" }));
  });

  it("changes when a promotion starts", () => {
    expect(hash({ oldPriceText: "" })).not.toBe(hash({ oldPriceText: "€35.00" }));
  });

  it("changes when availability changes", () => {
    expect(hash({ availabilityText: "in_stock" })).not.toBe(hash({ availabilityText: "out_of_stock" }));
  });

  it("changes when an image is added or replaced", () => {
    expect(hash({ imageUrls: ["/a.jpg"] })).not.toBe(hash({ imageUrls: ["/a.jpg", "/b.jpg"] }));
  });

  it("changes when an attribute changes", () => {
    expect(hash({ attributes: { intensity: "8 от 10" } })).not.toBe(
      hash({ attributes: { intensity: "9 от 10" } }),
    );
  });

  it("excludes volatile fields entirely", () => {
    const fields = buildSemanticFields(normalizeProduct(base, OPTIONS));
    const serialised = JSON.stringify(fields);
    for (const forbidden of ["fetchedAt", "scrapedAt", "syncRunId", "id", "firstSeenAt", "lastSeenAt"]) {
      expect(Object.keys(fields)).not.toContain(forbidden);
    }
    expect(serialised).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("does not depend on the source URL, which is not a business field", () => {
    expect(hash({ url: "https://www.kafezona.com/lavazza-super-crema/?utm_source=x" })).toBe(hash({}));
  });
});

describe("validateNormalizedProduct", () => {
  it("accepts a well-formed product", () => {
    expect(validateNormalizedProduct(normalizeProduct(base, OPTIONS)).ok).toBe(true);
  });

  it("rejects a product with no name", () => {
    const result = validateNormalizedProduct(normalizeProduct({ ...base, name: "  " }, OPTIONS));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("name");
  });

  it("rejects a product whose URL is not absolute", () => {
    const result = validateNormalizedProduct(normalizeProduct({ ...base, url: "/relative/" }, OPTIONS));
    expect(result.ok).toBe(false);
  });
});
