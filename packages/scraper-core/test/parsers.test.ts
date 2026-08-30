import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMoney, parseWeight, sha256Hex, normalizeHtmlForHash } from "@catalog/shared";
import { extractJsonArrayAfterKey, flattenCategories, hasFilterInit, parseFilterInit } from "../src/parsers/filterInit.ts";
import { parseFilterContract, parseListingPage } from "../src/parsers/listing.ts";
import { parseProductPage } from "../src/parsers/productPage.ts";
import { parsePage } from "../src/parsers/page.ts";
import { classifyPage } from "../src/parsers/classify.ts";
import { parseSitemap } from "../src/parsers/sitemap.ts";
import { findPrices, isPriceOnlyText } from "../src/parsers/price.ts";
import * as cheerio from "cheerio";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/kafezona",
);
const fixture = (name: string): string => readFileSync(path.join(FIXTURES, `${name}.html`), "utf8");

describe("isPriceOnlyText", () => {
  it("accepts a bare price in either decimal convention", () => {
    expect(isPriceOnlyText("€30.00")).toBe(true);
    expect(isPriceOnlyText("€4,90")).toBe(true);
    expect(isPriceOnlyText("10,70 лв.")).toBe(true);
    expect(isPriceOnlyText(" €30.00 ")).toBe(true);
  });

  it("rejects a price glued to other text", () => {
    // The bug this guards: "1 кг. €30.00" parsed as EUR 1.00.
    expect(isPriceOnlyText("1 кг. €30.00")).toBe(false);
    expect(isPriceOnlyText("Цена: €30.00")).toBe(false);
  });

  it("rejects a currency symbol with no amount", () => {
    expect(isPriceOnlyText("€")).toBe(false);
    expect(isPriceOnlyText("")).toBe(false);
  });

  it("rejects numbers with no currency", () => {
    expect(isPriceOnlyText("16")).toBe(false);
    expect(isPriceOnlyText("8 от 10")).toBe(false);
    expect(isPriceOnlyText("1 кг.")).toBe(false);
  });
});

describe("findPrices", () => {
  it("prefers the innermost element over its wrapper", () => {
    const $ = cheerio.load(
      `<div id="row"><span>1 кг.</span><span>€30.00</span></div>`,
    );
    expect(findPrices($, $("body")).priceText).toBe("€30.00");
  });

  it("separates a struck-through old price from the current one", () => {
    const $ = cheerio.load(
      `<div><span class="line-through">€40.00</span><span>€30.00</span></div>`,
    );
    const prices = findPrices($, $("body"));
    expect(prices.priceText).toBe("€30.00");
    expect(prices.oldPriceText).toBe("€40.00");
  });

  it("returns nulls when there is no price", () => {
    const $ = cheerio.load("<div><span>1 кг.</span></div>");
    expect(findPrices($, $("body"))).toMatchObject({ priceText: null, oldPriceText: null });
  });
});

describe("extractJsonArrayAfterKey", () => {
  it("respects brackets inside string literals", () => {
    const source = `x = { products: [{"name":"a ] b"},{"name":"c"}] };`;
    const extracted = extractJsonArrayAfterKey(source, "products");
    expect(extracted).not.toBeNull();
    expect(JSON.parse(extracted!)).toHaveLength(2);
  });

  it("respects escaped quotes", () => {
    const source = `x = { products: [{"name":"a \\" ] b"}] };`;
    expect(JSON.parse(extractJsonArrayAfterKey(source, "products")!)).toHaveLength(1);
  });

  it("handles nested arrays", () => {
    const source = `x = { categories: [{"children":[{"a":1}]}] };`;
    expect(JSON.parse(extractJsonArrayAfterKey(source, "categories")!)).toHaveLength(1);
  });

  it("returns null for a missing or unterminated key", () => {
    expect(extractJsonArrayAfterKey("x = {}", "products")).toBeNull();
    expect(extractJsonArrayAfterKey("x = { products: [1,2", "products")).toBeNull();
  });
});

describe("parseFilterInit against the real search page", () => {
  const html = fixture("search-filter-init");

  it("detects the blob", () => {
    expect(hasFilterInit(html)).toBe(true);
    expect(hasFilterInit(fixture("home"))).toBe(false);
  });

  it("parses products, brands and the category tree", () => {
    const result = parseFilterInit(html);
    expect(result).not.toBeNull();
    expect(result!.products.length).toBeGreaterThan(0);
    expect(result!.brands.length).toBe(15);
    expect(result!.categories.length).toBe(3);
    expect(result!.invalidRecords).toEqual([]);
  });

  it("flattens the capsule subcategories under their parent", () => {
    const flat = flattenCategories(parseFilterInit(html)!.categories);
    const nespresso = flat.find((entry) => entry.category.slug === "nespresso");
    expect(nespresso?.parentSlug).toBe("kapsuli");
    expect(nespresso?.depth).toBe(1);
    const kapsuli = flat.find((entry) => entry.category.slug === "kapsuli");
    expect(kapsuli?.parentSlug).toBeNull();
  });

  it("preserves the brand slug that really has a leading space", () => {
    expect(parseFilterInit(html)!.brands.map((b) => b.slug)).toContain(" vergnano");
  });

  it("keeps both products that share one URL", () => {
    const borbone = parseFilterInit(html)!.products.filter(
      (p) => p.url === "/borbone-crema-classica/",
    );
    expect(borbone).toHaveLength(2);
    expect(new Set(borbone.map((p) => p.weight))).toEqual(new Set(["0.500кг.", "1 кг."]));
  });

  it("returns null when the blob is absent", () => {
    expect(parseFilterInit("<html><body>nothing here</body></html>")).toBeNull();
  });

  it("survives a malformed blob instead of throwing", () => {
    expect(() => parseFilterInit("window.FILTER_INIT = { products: [ {broken ")).not.toThrow();
  });
});

describe("parseListingPage against real category and brand pages", () => {
  it("reads cards and their filter attributes from a category page", () => {
    const result = parseListingPage(fixture("category-kapsuli"));
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.unparseableCount).toBe(0);
    expect(result.filterKeys).toEqual(["aromas", "brand", "decaf", "strength"]);
    for (const card of result.cards) {
      expect(card.href).toMatch(/^\//);
      expect(card.name?.length).toBeGreaterThan(3);
      expect(parseMoney(card.priceText)).not.toBeNull();
    }
  });

  it("reads category attributes from a brand page", () => {
    const result = parseListingPage(fixture("brand-lavazza"));
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.filterKeys).toEqual(["category"]);
  });

  it("returns no cards for genuinely empty listings", () => {
    expect(parseListingPage(fixture("category-empty")).cards).toEqual([]);
    expect(parseListingPage(fixture("promo-empty")).cards).toEqual([]);
    expect(parseListingPage(fixture("brand-empty")).cards).toEqual([]);
  });

  it("recovers the filter/URL-parameter contract from the page's own script", () => {
    const contract = parseFilterContract(fixture("category-kapsuli"));
    expect(contract).toEqual([
      { urlParam: "brand", stateName: "Brands", multiValue: true },
      { urlParam: "strength", stateName: "Strengths", multiValue: true },
      { urlParam: "decaf", stateName: "Decaf", multiValue: false },
      { urlParam: "aromas", stateName: "Aromas", multiValue: false },
    ]);
  });
});

describe("parseProductPage against real product pages", () => {
  it("extracts the price without swallowing the pack size", () => {
    const result = parseProductPage(fixture("product-lavazza-super-crema"));
    expect(result.priceText).toBe("€30.00");
    expect(parseMoney(result.priceText)?.amount).toBe("30.00");
    expect(result.weightText).toBe("1 кг.");
    expect(parseWeight(result.weightText)?.canonical).toBe("1000g");
  });

  it("reports no price for a product that genuinely has none", () => {
    // Related products on the same page do have prices; none of them is ours.
    const result = parseProductPage(fixture("product-no-price"));
    expect(result.priceText).toBeNull();
    expect(result.related.length).toBeGreaterThan(0);
    expect(result.related.some((item) => item.priceText !== null)).toBe(true);
  });

  it("handles the comma decimal price", () => {
    const result = parseProductPage(fixture("product-comma-price"));
    expect(result.priceText).toBe("€4,90");
    expect(parseMoney(result.priceText)?.amount).toBe("4.90");
  });

  it("de-duplicates the desktop and mobile attribute rows", () => {
    const result = parseProductPage(fixture("product-lavazza-super-crema"));
    expect(result.rawAttributeRows).toEqual([
      "Наличност: В наличност",
      "Интензивност: 8 от 10",
      "Тегло: 1 кг.",
    ]);
    expect(result.attributes.intensity).toBe("8 от 10");
    expect(result.availabilityText).toBe("В наличност");
  });

  it("reads a clean breadcrumb trail and the category link", () => {
    const result = parseProductPage(fixture("product-lavazza-super-crema"));
    expect(result.breadcrumbs.map((crumb) => crumb.label)).toEqual([
      "Магазин",
      "Кафе на зърна",
      "Кафе на зърна Lavazza Super Crema 1кг.",
    ]);
    expect(result.categoryHref).toBe("/kafe-na-zyrna/");
  });

  it("finds the quick-order widget and its third-party endpoint", () => {
    const result = parseProductPage(fixture("product-lavazza-super-crema"));
    expect(result.quickOrder.present).toBe(true);
    expect(result.quickOrder.external).toBe(true);
    expect(result.quickOrder.fields).toHaveLength(1);
    expect(result.quickOrder.fields[0]?.type).toBe("tel");
  });

  it("reports full confidence on a well-formed page", () => {
    expect(parseProductPage(fixture("product-lavazza-super-crema")).confidence).toBe(1);
  });

  it("degrades without throwing on unrelated markup", () => {
    const result = parseProductPage("<html><body><p>hello</p></body></html>");
    expect(result.name).toBeNull();
    expect(result.confidence).toBeLessThan(0.5);
  });
});

describe("parsePage", () => {
  it("reads document metadata", () => {
    const page = parsePage(fixture("product-lavazza-super-crema"));
    expect(page.title).toBe("Кафе на зърна Lavazza Super Crema 1кг.");
    expect(page.headings.some((h) => h.level === 1)).toBe(true);
    expect(page.links.length).toBeGreaterThan(10);
  });

  it("finds script-driven forms that have no <form> element", () => {
    // The source has zero <form> tags but two real public forms.
    const page = parsePage(fixture("product-lavazza-super-crema"));
    expect(page.forms.length).toBeGreaterThan(0);
    expect(page.forms.every((form) => form.synthetic)).toBe(true);
    expect(page.forms.some((form) => form.fields.some((f) => f.type === "tel"))).toBe(true);
  });

  it("records listing and widget signals", () => {
    const category = parsePage(fixture("category-kapsuli"));
    expect(category.signals.productItemCount).toBeGreaterThan(0);
    const product = parsePage(fixture("product-lavazza-super-crema"));
    expect(product.signals.hasQuickOrderWidget).toBe(true);
    expect(product.signals.productItemCount).toBe(0);
  });

  it("tolerates absent JSON-LD", () => {
    expect(parsePage(fixture("home")).structuredData).toEqual([]);
  });

  it("skips malformed JSON-LD rather than throwing", () => {
    const html = `<html><head><script type="application/ld+json">{oops</script></head><body></body></html>`;
    expect(parsePage(html).structuredData).toEqual([]);
  });

  it("flattens a JSON-LD array", () => {
    const html = `<html><head><script type="application/ld+json">[{"@type":"Product"},{"@type":"Brand"}]</script></head><body></body></html>`;
    expect(parsePage(html).structuredData).toHaveLength(2);
  });
});

describe("classifyPage", () => {
  const classify = (name: string, path: string, extra = {}) =>
    classifyPage({
      path,
      page: parsePage(fixture(name)),
      isSoft404: false,
      listingFilterKeys: parseListingPage(fixture(name)).filterKeys,
      filterContractParams: parseFilterContract(fixture(name)).map((entry) => entry.urlParam),
      ...extra,
    });

  it("classifies the soft-404 shell", () => {
    const result = classifyPage({
      path: "/anything/",
      page: parsePage(fixture("soft-404")),
      isSoft404: true,
    });
    expect(result.pageType).toBe("soft_404");
    expect(result.confidence).toBe("high");
  });

  it("classifies the home page", () => {
    expect(classify("home", "/").pageType).toBe("home");
  });

  it("classifies known routes from the path", () => {
    expect(classify("promo-empty", "/promo/").pageType).toBe("promotion");
    expect(classify("brands-index", "/brands/").pageType).toBe("brand_index");
    expect(classify("blog-empty", "/blog/").pageType).toBe("blog_index");
    expect(classify("legal-privacy", "/privacy/").pageType).toBe("legal");
  });

  it("uses catalog knowledge when available", () => {
    const result = classify("product-lavazza-super-crema", "/lavazza-super-crema/", {
      knownProductPaths: new Set(["/lavazza-super-crema/"]),
    });
    expect(result.pageType).toBe("product");
    expect(result.confidence).toBe("high");
  });

  it("recognises a product from structure alone", () => {
    // No catalog hints: the quick-order widget plus absence of cards decides.
    const result = classify("product-lavazza-super-crema", "/lavazza-super-crema/");
    expect(result.pageType).toBe("product");
    expect(result.evidence.join(" ")).toContain("quick-order");
  });

  it("distinguishes a brand page from a category page by card attributes", () => {
    expect(classify("category-kapsuli", "/kapsuli/").pageType).toBe("category");
    expect(classify("brand-lavazza", "/lavazza/").pageType).toBe("brand");
  });

  it("classifies a brand page that currently has no products", () => {
    // Six brands on the source are genuinely empty. Falling back to "other"
    // would hide real routes from the storefront build.
    const result = classify("brand-empty", "/kimbo/");
    expect(result.pageType).toBe("brand");
    expect(result.evidence.join(" ")).toContain("FILTER_INIT");
  });

  it("classifies a category page that currently has no products", () => {
    const result = classify("category-empty", "/vending-zona/");
    expect(result.pageType).toBe("category");
    expect(result.evidence.join(" ")).toContain("filter script");
  });

  it("does not mistake a legal page for a listing", () => {
    expect(classify("legal-privacy", "/privacy/").pageType).toBe("legal");
  });

  it("does not mistake the brand index for a brand", () => {
    expect(classify("brands-index", "/brands/").pageType).toBe("brand_index");
  });

  it("treats asset paths as assets", () => {
    const result = classifyPage({
      path: "/img/product-img-1182.jpg-800w.jpg",
      page: parsePage("<html></html>"),
      isSoft404: false,
    });
    expect(result.pageType).toBe("asset");
  });

  it("falls back to `other` with low confidence", () => {
    const result = classifyPage({
      path: "/mystery/",
      page: parsePage("<html><body><div>x</div></body></html>"),
      isSoft404: false,
    });
    expect(result.pageType).toBe("other");
    expect(result.confidence).toBe("low");
  });
});

describe("parseSitemap", () => {
  it("reads a urlset", () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://www.kafezona.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
      <url><loc>https://www.kafezona.com/blog/</loc><lastmod>2026-01-01</lastmod></url>
    </urlset>`;
    const result = parseSitemap(xml);
    expect(result.kind).toBe("urlset");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.changeFrequency).toBe("weekly");
    expect(result.entries[1]?.lastModified).toBe("2026-01-01");
  });

  it("reads a sitemap index", () => {
    const xml = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://www.kafezona.com/sitemap-1.xml</loc></sitemap>
    </sitemapindex>`;
    const result = parseSitemap(xml);
    expect(result.kind).toBe("sitemapindex");
    expect(result.sitemapUrls).toEqual(["https://www.kafezona.com/sitemap-1.xml"]);
  });

  it("returns `unknown` for anything else", () => {
    expect(parseSitemap("<html></html>").kind).toBe("unknown");
  });
});

describe("soft-404 content hashing", () => {
  it("hashes the not-found shell identically to the home page", () => {
    // This equality is the entire basis of soft-404 detection on this source.
    const home = sha256Hex(normalizeHtmlForHash(fixture("home")));
    const notFound = sha256Hex(normalizeHtmlForHash(fixture("soft-404")));
    expect(notFound).toBe(home);
  });

  it("hashes a real page differently", () => {
    const home = sha256Hex(normalizeHtmlForHash(fixture("home")));
    const product = sha256Hex(normalizeHtmlForHash(fixture("product-lavazza-super-crema")));
    expect(product).not.toBe(home);
  });
});
