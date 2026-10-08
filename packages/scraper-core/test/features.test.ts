import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { silentLogger } from "@catalog/shared";
import { type CatalogDiscoveryResult, discoverCatalog } from "../src/catalog/discover.ts";
import { loadConfig } from "../src/config.ts";
import { type DiscoveryCrawlResult, runDiscoveryCrawl } from "../src/discovery/crawler.ts";
import { type ObservedFeature, buildFeatureInventory } from "../src/discovery/features.ts";
import { classifyNoticeBanner, detectStorefrontSignals } from "../src/discovery/pageSignals.ts";
import { Fetcher } from "../src/fetch/fetcher.ts";

/**
 * What the source can do now, detected from the rebuilt fixtures.
 *
 * The real crawler runs over a `fetch` stand-in that serves each fixture at
 * the path the manifest recorded for it and a real 404 for everything else —
 * which is how the source answers today. No request leaves the process.
 */

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/kafezona",
);
const fixture = (name: string): string => readFileSync(path.join(FIXTURES, name), "utf8");

interface Manifest {
  pages: Array<{ name: string; sourcePath: string; status: number; derivedFrom?: string }>;
}

function fixtureFetch(): { fetchImpl: typeof fetch; requests: string[] } {
  const manifest = JSON.parse(fixture("manifest.json")) as Manifest;
  const byPath = new Map(
    manifest.pages
      .filter((page) => page.status === 200 && !page.derivedFrom)
      .map((page) => [page.sourcePath, page.name]),
  );
  const notFound = fixture("not-found-404.html");
  const requests: string[] = [];

  const fetchImpl = (async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(typeof input === "object" && "url" in input ? input.url : input));
    const pathname = decodeURIComponent(url.pathname);
    requests.push(pathname);
    if (pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", { status: 200 });
    }
    // The source's sitemap lists every product; this one lists every fixture,
    // which is how the crawl reaches pages the trimmed listings do not link.
    if (pathname === "/sitemap.xml") {
      const locs = [...byPath.keys()]
        .map((sourcePath) => `<url><loc>${new URL(sourcePath, url.origin).href}</loc></url>`)
        .join("");
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</urlset>`,
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    }
    const name = byPath.get(pathname);
    if (!name) {
      return new Response(notFound, { status: 404, headers: { "content-type": "text/html" } });
    }
    return new Response(fixture(name), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
}

describe("detectStorefrontSignals", () => {
  it("reads the banner as a delivery threshold, not as opening hours", () => {
    const signals = detectStorefrontSignals(fixture("home.html"));
    expect(signals.hasNoticeBanner).toBe(true);
    expect(signals.noticeBanner).toEqual({
      kind: "delivery_threshold",
      deliveryThreshold: "49€",
      dismissible: true,
    });
  });

  it("finds the same banner on every kind of page", () => {
    for (const name of [
      "category-kapsuli.html",
      "blog-article.html",
      "product-amann-cascada.html",
    ]) {
      expect(detectStorefrontSignals(fixture(name)).noticeBanner?.kind, name).toBe(
        "delivery_threshold",
      );
    }
  });

  it("classifies a banner by what it says", () => {
    expect(classifyNoticeBanner("Безплатна доставка за поръчки над 49€.")).toEqual({
      kind: "delivery_threshold",
      deliveryThreshold: "49€",
    });
    expect(classifyNoticeBanner("Безплатна доставка при поръчка над 100 лв.")).toEqual({
      kind: "delivery_threshold",
      deliveryThreshold: "100лв.",
    });
    // What the banner used to be for.
    expect(classifyNoticeBanner("Магазинът ще бъде затворен от 24 до 27 декември.")).toEqual({
      kind: "opening_hours",
      deliveryThreshold: null,
    });
    expect(classifyNoticeBanner("Работно време по празниците: 10:00 - 14:00")).toMatchObject({
      kind: "opening_hours",
    });
    // An amount alone is not a threshold; delivery must be what it is about.
    expect(classifyNoticeBanner("Нови вкусове над 49€ стойност.")).toMatchObject({ kind: "other" });
    expect(classifyNoticeBanner("Добре дошли!")).toEqual({
      kind: "other",
      deliveryThreshold: null,
    });
  });

  it("reports no banner where there is none", () => {
    const html = "<html><body><main><h1>Plain</h1></main></body></html>";
    expect(detectStorefrontSignals(html)).toMatchObject({
      hasNoticeBanner: false,
      noticeBanner: null,
      paymentMethods: [],
    });
  });

  it("does not take the cookie bar for the notice banner", () => {
    const html = '<body><div id="cookie-banner"><p>Бисквитки</p></div></body>';
    expect(detectStorefrontSignals(html).hasNoticeBanner).toBe(false);
  });

  it("lists the footer's payment methods once each, as neutral keys", () => {
    // The footer is rendered once per breakpoint; each method appears twice.
    expect(detectStorefrontSignals(fixture("home.html")).paymentMethods).toEqual([
      "cash-on-delivery",
      "bank-transfer",
      "card",
    ]);
    expect(detectStorefrontSignals(fixture("product-illy-classico.html")).paymentMethods).toEqual([
      "cash-on-delivery",
      "bank-transfer",
      "card",
    ]);
  });

  it("carries none of the source's own wording for the payment methods", () => {
    const serialised = JSON.stringify(detectStorefrontSignals(fixture("home.html")));
    expect(serialised).not.toMatch(/[Ѐ-ӿ]{4,}/u);
  });

  it("reads the product code and the characteristics labels on a product page", () => {
    const signals = detectStorefrontSignals(fixture("product-amann-cascada.html"), {
      isProductPage: true,
    });
    expect(signals.hasProductCode).toBe(true);
    expect(signals.productCodeInStructuredData).toBe(true);
    expect(signals.characteristicLabels).toContain("Състав");
    expect(signals.characteristicLabels.length).toBeGreaterThanOrEqual(3);
  });

  it("reads nothing product-shaped from a page that is not a product", () => {
    expect(detectStorefrontSignals(fixture("category-kapsuli.html"))).toMatchObject({
      hasProductCode: false,
      productCodeInStructuredData: false,
      characteristicLabels: [],
    });
  });
});

describe("buildFeatureInventory over the rebuilt fixtures", () => {
  let crawl: DiscoveryCrawlResult;
  let catalog: CatalogDiscoveryResult;
  let features: ObservedFeature[];
  const feature = (id: string): ObservedFeature | undefined =>
    features.find((entry) => entry.id === id);

  beforeAll(async () => {
    const config = loadConfig(
      { minDelayMs: 0, maxRetries: 0, concurrency: 8, maxPages: 400, timeoutMs: 5_000 },
      {},
    );
    const { fetchImpl } = fixtureFetch();
    const fetcher = new Fetcher({ config, fetchImpl, logger: silentLogger });
    await fetcher.calibrateSoft404();
    catalog = await discoverCatalog({ config, fetcher, logger: silentLogger });
    crawl = await runDiscoveryCrawl({
      config,
      fetcher,
      logger: silentLogger,
      catalogHints: {
        productPaths: new Set(catalog.products.map((product) => product.sourcePath)),
        categorySlugs: new Set(
          catalog.categories.filter((c) => c.parentKey === null).map((c) => c.sourceKey),
        ),
        subcategorySlugs: new Set(
          catalog.categories.filter((c) => c.parentKey !== null).map((c) => c.sourceKey),
        ),
        brandSlugs: new Set(catalog.brands.map((brand) => brand.sourceKey)),
      },
    });
    features = buildFeatureInventory(crawl, catalog);
  }, 60_000);

  it("crawled the fixture pages as the page types the detectors rely on", () => {
    const typeOf = (pathname: string) =>
      crawl.pages.find((page) => page.path === pathname)?.classification.pageType;
    expect(catalog.products).toHaveLength(187);
    expect(typeOf("/vending-zona/")).toBe("category");
    expect(typeOf("/konsumativi/")).toBe("category");
    expect(typeOf("/blog/")).toBe("blog_index");
    expect(typeOf("/blog/kafezona-na-festivala-za-komunikatsiya-i-lichnostno-razvitie/")).toBe(
      "blog_article",
    );
    expect(typeOf("/amann-cascada-500/")).toBe("product");
    expect(crawl.pages.filter((page) => page.classification.pageType === "product")).toHaveLength(
      12,
    );
    // The source answers unknown routes with a real 404 now: no soft 404s.
    expect(crawl.stats.soft404).toBe(0);
  });

  it("backs every feature with evidence, under a unique id", () => {
    const ids = features.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of features) {
      expect(entry.evidenceUrls.length, entry.id).toBeGreaterThan(0);
    }
    expect(ids).toEqual(
      expect.arrayContaining([
        "category-browsing",
        "brand-browsing",
        "product-detail",
        "product-search",
        "catalog-filters",
        "promotions",
        "quick-order",
        "newsletter-signup",
        "related-products",
        "breadcrumbs",
        "blog",
        "legal-pages",
        "phone-contact",
        "site-notice",
        "delivery-threshold",
        "payment-methods",
        "vending-zone",
        "consumables",
        "product-code",
        "product-characteristics",
      ]),
    );
  });

  it("describes the notice banner by what it now says", () => {
    const notice = feature("site-notice");
    expect(notice?.description).toContain("order value above which delivery is free");
    // The reason it was once left out of the storefront no longer describes it.
    expect(notice?.description).not.toMatch(/closure|opening hours/i);
    expect(notice?.pageTypes).toEqual(
      expect.arrayContaining(["home", "category", "product", "blog_article"]),
    );
    expect(notice?.implementationNotes?.join(" ")).toContain("remembered in the browser");
  });

  it("reports the free-delivery threshold as a capability of its own", () => {
    const threshold = feature("delivery-threshold");
    expect(threshold?.name).toBe("Free-delivery threshold");
    expect(threshold?.implementationNotes?.[0]).toBe("Threshold stated by the source: 49€.");
    expect(threshold?.evidenceUrls).toContain("https://www.kafezona.com/");
  });

  it("reports the payment methods the footer lists", () => {
    const payment = feature("payment-methods");
    expect(payment?.implementationNotes?.[0]).toBe(
      "Methods listed: cash-on-delivery, bank-transfer, card.",
    );
    expect(payment?.pageTypes).toEqual(expect.arrayContaining(["home", "product"]));
    // The claim that there is no payment anywhere is gone with it.
    expect(feature("quick-order")?.implementationNotes?.join(" ")).not.toContain("no payment");
  });

  it("detects the Vending Zone and Consumables pages", () => {
    expect(feature("vending-zone")).toMatchObject({
      evidenceUrls: ["https://www.kafezona.com/vending-zona/"],
      pageTypes: ["category"],
    });
    expect(feature("consumables")).toMatchObject({
      evidenceUrls: ["https://www.kafezona.com/konsumativi/"],
      pageTypes: ["category"],
    });
    // Both are empty today, and say so instead of pretending to a count.
    expect(feature("vending-zone")?.implementationNotes?.[0]).toContain("lists no products");
    expect(feature("consumables")?.implementationNotes?.[0]).toContain("lists no products");
  });

  it("counts empty navigation pages instead of asserting that there are two", () => {
    const notes = feature("category-browsing")?.implementationNotes ?? [];
    expect(notes.join(" ")).toMatch(/2 navigation pages list no products/);
  });

  it("knows the blog has an article now", () => {
    const blog = feature("blog");
    expect(blog?.description).toContain("each article has a page of its own");
    expect(blog?.pageTypes).toEqual(["blog_index", "blog_article"]);
    expect(blog?.implementationNotes?.[0]).toBe("1 article observed.");
    expect(blog?.evidenceUrls).toEqual([
      "https://www.kafezona.com/blog/",
      "https://www.kafezona.com/blog/kafezona-na-festivala-za-komunikatsiya-i-lichnostno-razvitie/",
    ]);
  });

  it("detects the product code on every product page", () => {
    const code = feature("product-code");
    expect(code?.evidenceUrls).toHaveLength(12);
    expect(code?.implementationNotes).toContain(
      "The same code is the `sku` of the page's Product structured data.",
    );
  });

  it("detects the characteristics list and names its commonest labels", () => {
    const characteristics = feature("product-characteristics");
    expect(characteristics?.evidenceUrls).toHaveLength(12);
    const labels = characteristics?.implementationNotes?.[0] ?? "";
    expect(labels).toMatch(/^Labels seen most often: Състав, /);
    expect(labels).toContain("Произход");
  });

  it("omits what an older, plainer site does not have", () => {
    // The same pages with the banner, footer list and product extras removed.
    const stripped: DiscoveryCrawlResult = {
      ...crawl,
      pages: crawl.pages
        .filter((page) => !["/vending-zona/", "/konsumativi/"].includes(page.path))
        .filter((page) => page.classification.pageType !== "blog_article")
        .map((page) => ({
          ...page,
          signals: {
            ...page.signals,
            hasNoticeBanner: false,
            noticeBanner: null,
            paymentMethods: [],
            hasProductCode: false,
            characteristicLabels: [],
          },
        })),
    };
    const ids = buildFeatureInventory(stripped, catalog).map((entry) => entry.id);
    for (const id of [
      "site-notice",
      "delivery-threshold",
      "payment-methods",
      "vending-zone",
      "consumables",
      "product-code",
      "product-characteristics",
    ]) {
      expect(ids, id).not.toContain(id);
    }
    const blog = buildFeatureInventory(stripped, catalog).find((entry) => entry.id === "blog");
    expect(blog?.description).toContain("no published articles");
    expect(blog?.pageTypes).toEqual(["blog_index"]);
  });

  it("describes an opening-hours banner as one, with no threshold feature", () => {
    const hours: DiscoveryCrawlResult = {
      ...crawl,
      pages: crawl.pages.map((page) => ({
        ...page,
        signals: {
          ...page.signals,
          noticeBanner: { kind: "opening_hours", deliveryThreshold: null, dismissible: true },
        },
      })),
    };
    const inventory = buildFeatureInventory(hours, catalog);
    expect(inventory.find((entry) => entry.id === "site-notice")?.description).toContain(
      "opening hours or a closure",
    );
    expect(inventory.some((entry) => entry.id === "delivery-threshold")).toBe(false);
  });
});
