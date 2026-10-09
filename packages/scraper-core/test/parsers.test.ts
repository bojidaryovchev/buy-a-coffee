import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMoney, parseWeight, sha256Hex, normalizeHtmlForHash } from "@catalog/shared";
import {
  extractJsonArrayAfterKey,
  flattenCategories,
  hasFilterInit,
  parseFilterInit,
} from "../src/parsers/filterInit.ts";
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
    const $ = cheerio.load(`<div id="row"><span>1 кг.</span><span>€30.00</span></div>`);
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

  // The blob still parses completely after the source's rename of its product
  // URLs: 187 records, up from 111, none rejected.
  it("parses products, brands and the category tree", () => {
    const result = parseFilterInit(html);
    expect(result).not.toBeNull();
    expect(result!.products).toHaveLength(187);
    expect(result!.brands.length).toBe(20);
    expect(result!.categories.length).toBe(3);
    expect(result!.invalidRecords).toEqual([]);
  });

  it("flattens the capsule subcategories under their parent", () => {
    // Expectation updated: the source renamed the category `kapsuli` to
    // `kafe-kapsuli`; the structure under it is unchanged.
    const flat = flattenCategories(parseFilterInit(html)!.categories);
    const nespresso = flat.find((entry) => entry.category.slug === "nespresso");
    expect(nespresso?.parentSlug).toBe("kafe-kapsuli");
    expect(nespresso?.depth).toBe(1);
    const capsules = flat.find((entry) => entry.category.slug === "kafe-kapsuli");
    expect(capsules?.parentSlug).toBeNull();
    expect(flat.filter((entry) => entry.parentSlug === "kafe-kapsuli")).toHaveLength(5);
  });

  it("no longer has two products behind one URL", () => {
    // Expectation replaced: `/borbone-crema-classica/` used to serve two
    // products. Each pack size now has its own URL.
    const products = parseFilterInit(html)!.products;
    expect(new Set(products.map((p) => p.url)).size).toBe(products.length);
    const borbone = products.filter((p) => p.url.startsWith("/borbone-crema-classica"));
    expect(borbone.map((p) => p.url).sort()).toEqual([
      "/borbone-crema-classica-1/",
      "/borbone-crema-classica-500/",
    ]);
    expect(borbone.map((p) => p.weight).sort()).toEqual(["0.500кг.", "1 кг."].sort());
  });

  it("still keeps both records when a blob repeats one URL", () => {
    // The collision is gone from the source, but the parser's promise not to
    // drop records on its own is worth keeping under test.
    const blob = `window.FILTER_INIT = { brands: [], categories: [], products: [
      {"h1":"A 0.500кг.","url":"/a/","price":"€1.00","weight":"0.500кг.","brandSlug":"x","categorySlug":"y","imageUrl":"/img/product-img-1.jpg-800w.jpg","description":""},
      {"h1":"A 1кг.","url":"/a/","price":"€2.00","weight":"1 кг.","brandSlug":"x","categorySlug":"y","imageUrl":"/img/product-img-2.jpg-800w.jpg","description":""}
    ] };`;
    expect(parseFilterInit(blob)!.products).toHaveLength(2);
  });

  it("keeps the stray whitespace the source puts in brand names", () => {
    // Brand slugs used to carry a leading space; they no longer do, but three
    // display names still do, and are normalised by the catalog layer.
    const brands = parseFilterInit(html)!.brands;
    expect(brands.map((b) => b.slug)).toContain("vergnano");
    expect(brands.find((b) => b.slug === "vergnano")?.h1).toBe(" VERGNANO");
    expect(brands.every((b) => b.slug === b.slug.trim())).toBe(true);
  });

  it("keeps the dirty product URL exactly as the source prints it", () => {
    const urls = parseFilterInit(html)!.products.map((p) => p.url);
    expect(urls).toContain("/caffitaly-espresso-morbido-10 /");
  });

  it("reads the record with an empty brand and the non-conforming image path", () => {
    const products = parseFilterInit(html)!.products;
    expect(products.filter((p) => !p.brandSlug).map((p) => p.url)).toEqual([
      "/tezzoro-espresso-classic-1/",
    ]);
    expect(products.find((p) => p.url === "/lavazza-gran-espresso-1/")?.imageUrl).toBe(
      "/img/66123-800w.jpg",
    );
  });

  it("finds every product priced, and none with a comma decimal", () => {
    const products = parseFilterInit(html)!.products;
    expect(products.every((p) => parseMoney(p.price) !== null)).toBe(true);
    expect(products.some((p) => p.price.includes(","))).toBe(false);
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
    expect(parseListingPage(fixture("promo")).cards).toEqual([]);
    expect(parseListingPage(fixture("brand-empty")).cards).toEqual([]);
    expect(parseListingPage(fixture("category-konsumativi")).cards).toEqual([]);
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
    // No product on the source lacks a price any more, so the page is
    // derived: the product's own price elements are removed from a real
    // fixture. The related cards keep theirs, and none of them is ours.
    const html = fixture("product-lavazza-gusto-forte");
    const own = parseProductPage(html);
    expect(own.priceText).toBe("€20.60");
    const withoutOwnPrice = html.replaceAll("€20.60", "");
    const result = parseProductPage(withoutOwnPrice);
    expect(result.priceText).toBeNull();
    expect(result.related.length).toBeGreaterThan(0);
    expect(result.related.some((item) => item.priceText !== null)).toBe(true);
  });

  it("handles the comma decimal price", () => {
    // The source printed "€4,90" once; every price is dotted now. The real
    // page is rewritten to the comma convention to keep that path covered.
    const html = fixture("product-dg-molini-napoli");
    expect(parseProductPage(html).priceText).toBe("€4.90");
    const result = parseProductPage(html.replaceAll("€4.90", "€4,90"));
    expect(result.priceText).toBe("€4,90");
    expect(parseMoney(result.priceText)?.amount).toBe("4.90");
  });

  it("de-duplicates the desktop and mobile attribute rows", () => {
    // Expectation updated: the source now prints a product code ("Код:") as a
    // row of its own, between availability and intensity.
    const result = parseProductPage(fixture("product-lavazza-super-crema"));
    expect(result.rawAttributeRows).toEqual([
      "Наличност: В наличност",
      "Код: 00011",
      "Интензивност: 8 от 10",
      "Тегло: 1 кг.",
    ]);
    expect(result.attributes.intensity).toBe("8 от 10");
    expect(result.attributes.code).toBe("00011");
    expect(result.availabilityText).toBe("В наличност");
  });

  it("reads each related card on its own, and only the cards", () => {
    // The page now has a description section between the product and the
    // related cards, and the cards are links rather than click handlers. A
    // card must get its own name, price and image (not the first card's), and
    // the "see all" link after the cards is not a card.
    const result = parseProductPage(fixture("product-lavazza-super-crema"));
    expect(result.related.map((item) => item.href)).toEqual([
      "/lollo-caffe-oro-1/",
      "/lollo-caffe-nero-1/",
      "/lollo-caffe-classico-1/",
      "/lollo-caffe-classico-500/",
    ]);
    expect(new Set(result.related.map((item) => item.imageUrl)).size).toBe(4);
    expect(new Set(result.related.map((item) => item.name)).size).toBe(4);
    expect(result.related.every((item) => item.priceText !== null)).toBe(true);
    // None of them is this product's own price.
    expect(result.priceText).toBe("€30.00");
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
    expect(parsePage("<html><body><h1>x</h1></body></html>").structuredData).toEqual([]);
  });

  it("reads the JSON-LD the source now ships", () => {
    // Expectation replaced: the home page used to carry none. Every page has a
    // WebSite block; product pages add Product, articles add Article.
    const types = (name: string) =>
      parsePage(fixture(name)).structuredData.map(
        (block) => (block as { "@type": string })["@type"],
      );
    expect(types("home")).toEqual(["WebSite", "LocalBusiness"]);
    expect(types("product-lavazza-super-crema")).toEqual(["WebSite", "Product", "BreadcrumbList"]);
    expect(types("blog-article")).toEqual(["WebSite", "Article", "BreadcrumbList"]);
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
    expect(classify("promo", "/promo/").pageType).toBe("promotion");
    expect(classify("brands-index", "/brands/").pageType).toBe("brand_index");
    expect(classify("blog-index", "/blog/").pageType).toBe("blog_index");
    expect(classify("legal-privacy", "/privacy/").pageType).toBe("legal");
  });

  it("classifies the blog article under /blog/", () => {
    const result = classify(
      "blog-article",
      "/blog/kafezona-na-festivala-za-komunikatsiya-i-lichnostno-razvitie/",
    );
    expect(result.pageType).toBe("blog_article");
    expect(result.confidence).toBe("high");
  });

  it("uses catalog knowledge when available", () => {
    const result = classify("product-lavazza-super-crema", "/lavazza-super-crema-1/", {
      knownProductPaths: new Set(["/lavazza-super-crema-1/"]),
    });
    expect(result.pageType).toBe("product");
    expect(result.confidence).toBe("high");
  });

  it("recognises a product from structure alone", () => {
    // No catalog hints: the quick-order widget plus absence of cards decides.
    const result = classify("product-lavazza-super-crema", "/lavazza-super-crema-1/");
    expect(result.pageType).toBe("product");
    expect(result.evidence.join(" ")).toContain("quick-order");
  });

  it("recognises every product fixture, whatever its URL suffix", () => {
    for (const name of readdirSync(FIXTURES).filter((file) => file.startsWith("product-"))) {
      const key = name.replace(/\.html$/, "");
      expect(classify(key, "/some-product-500/").pageType, key).toBe("product");
    }
  });

  it("reads a product's JSON-LD type when the structure alone cannot decide", () => {
    // The WebSite block comes first on every page; the Product block after it
    // is the one that names the page.
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"WebSite"}</script>
      <script type="application/ld+json">{"@type":"Product"}</script>
    </head><body><h1>x</h1></body></html>`;
    const result = classifyPage({ path: "/x-1/", page: parsePage(html), isSoft404: false });
    expect(result.pageType).toBe("product");
    expect(result.confidence).toBe("high");
  });

  it("classifies the Vending Zone and Consumables pages as (empty) categories", () => {
    // Both are real navigation categories with no products; no new page type
    // is needed, and they must not fall through to `other`.
    for (const [name, path] of [
      ["category-empty", "/vending-zona/"],
      ["category-konsumativi", "/konsumativi/"],
    ] as const) {
      const result = classify(name, path);
      expect(result.pageType, path).toBe("category");
      expect(result.evidence.join(" ")).toContain("no products");
    }
  });

  it("distinguishes a brand page from a category page by card attributes", () => {
    expect(classify("category-kapsuli", "/kafe-kapsuli/").pageType).toBe("category");
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

  it("does not mistake the real 404 page for the home shell", () => {
    // Unknown routes now answer HTTP 404 with a page of their own, so the
    // shell hash has nothing to match; the status code is the signal.
    const home = sha256Hex(normalizeHtmlForHash(fixture("home")));
    const notFound = sha256Hex(normalizeHtmlForHash(fixture("not-found-404")));
    expect(notFound).not.toBe(home);
    expect(parsePage(fixture("not-found-404")).title).toBe("Страницата не е намерена — KafeZona");
    expect(parsePage(fixture("not-found-404")).robotsMeta).toBe("noindex");
  });
});

describe("fixture set", () => {
  const manifest = JSON.parse(readFileSync(path.join(FIXTURES, "manifest.json"), "utf8")) as {
    pages: Array<{ name: string; status?: number; derivedFrom?: string }>;
  };
  const files = readdirSync(FIXTURES).filter((name) => name.endsWith(".html"));

  it("lists every fixture in the manifest, and nothing else", () => {
    expect(manifest.pages.map((page) => page.name).sort()).toEqual([...files].sort());
  });

  it("records the real 404 as a 404 and the soft-404 shell as derived", () => {
    expect(manifest.pages.find((page) => page.name === "not-found-404.html")?.status).toBe(404);
    expect(manifest.pages.find((page) => page.name === "soft-404.html")?.derivedFrom).toBe(
      "home.html",
    );
    for (const page of manifest.pages) {
      if (page.name === "not-found-404.html" || page.derivedFrom) continue;
      expect(page.status, page.name).toBe(200);
    }
  });

  // The tenant key belongs to a third party. It is public on the source site,
  // and it must never reach this repository.
  it.each(files)("%s carries no third-party tenant key", (name) => {
    const html = fixture(name.replace(/\.html$/, ""));
    expect(html).not.toMatch(/\bkz\d*_[0-9a-f]{12,}/i);
    for (const match of html.matchAll(/\w*TENANT_KEY\w*\s*=\s*['"]([^'"]*)['"]/g)) {
      expect(match[1]).toBe("REDACTED_THIRD_PARTY_TENANT_KEY");
    }
    expect(html).not.toMatch(/X-Tenant-Key'?\s*:\s*['"](?!REDACTED_THIRD_PARTY_TENANT_KEY)/);
  });

  it("keeps the redaction marker where the key was", () => {
    expect(fixture("home")).toContain("REDACTED_THIRD_PARTY_TENANT_KEY");
  });

  it.each(files)("%s contains no plain-text e-mail address", (name) => {
    const html = fixture(name.replace(/\.html$/, ""));
    const addresses = [
      ...html.matchAll(
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|bg|net|org|eu)\b/g,
      ),
    ].map((match) => match[0]);
    expect(addresses.filter((address) => address !== "mailbox@example.invalid")).toEqual([]);
  });
});
