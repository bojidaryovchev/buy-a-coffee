import type { CatalogDiscoveryResult } from "../catalog/discover.ts";
import type { DiscoveryCrawlResult } from "./crawler.ts";

/**
 * Functional inventory of the reference storefront.
 *
 * Every entry must be backed by evidence URLs from the crawl. Nothing is
 * asserted because a coffee shop "usually" has it — the storefront build
 * treats this file as its requirements list, so an invented feature here
 * becomes wasted work there, and a missed one becomes a gap.
 */

export interface ObservedFeature {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly evidenceUrls: string[];
  readonly pageTypes: string[];
  readonly inputs?: string[];
  readonly outputs?: string[];
  readonly implementationNotes?: string[];
}

export interface ObservedForm {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly pageUrls: string[];
  readonly action: string | null;
  readonly method: string;
  readonly externalEndpoint: boolean;
  readonly fields: Array<{
    name: string | null;
    type: string | null;
    required: boolean;
    label: string | null;
  }>;
  /** Always false. Discovery never submits a public form. */
  readonly submitted: false;
  readonly sideEffectWarning: string | null;
}

export interface ObservedFilter {
  readonly id: string;
  readonly name: string;
  readonly urlParam: string | null;
  readonly multiValue: boolean;
  readonly values: Array<{ value: string; label: string | null; count: number | null }>;
  readonly pageUrls: string[];
  readonly appliesToPageTypes: string[];
  readonly urlStateObservable: boolean;
  readonly notes: string | null;
}

/** Human labels for the filter values the source exposes. */
const FILTER_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  strength: { weak: "Леко", medium: "Средно", strong: "Силно" },
  decaf: { yes: "Да", no: "Не" },
  aromas: { yes: "Да", no: "Не" },
};

const FILTER_NAMES: Readonly<Record<string, string>> = {
  brand: "Brand",
  strength: "Brew strength",
  decaf: "Decaffeinated",
  aromas: "Flavoured",
  category: "Category",
};

function urlsFor(crawl: DiscoveryCrawlResult, predicate: (page: DiscoveryCrawlResult["pages"][number]) => boolean): string[] {
  return crawl.pages.filter(predicate).map((page) => page.canonicalUrl).sort();
}

export function buildFeatureInventory(
  crawl: DiscoveryCrawlResult,
  catalog: CatalogDiscoveryResult,
): ObservedFeature[] {
  const features: ObservedFeature[] = [];
  const byType = (type: string) => urlsFor(crawl, (page) => page.classification.pageType === type);

  const categoryUrls = byType("category");
  const subcategoryUrls = byType("subcategory");
  const brandUrls = byType("brand");
  const productUrls = byType("product");
  const searchUrls = byType("search");
  const promotionUrls = byType("promotion");
  const brandIndexUrls = byType("brand_index");
  const blogUrls = [...byType("blog_index"), ...byType("blog_article")];
  const legalUrls = byType("legal");

  const push = (feature: ObservedFeature): void => {
    if (feature.evidenceUrls.length > 0) features.push(feature);
  };

  push({
    id: "category-browsing",
    name: "Category browsing",
    description:
      "Products are organised into top-level categories, with a nested set of capsule subcategories reachable from the header navigation.",
    evidenceUrls: [...categoryUrls, ...subcategoryUrls].slice(0, 12),
    pageTypes: ["category", "subcategory"],
    outputs: ["product listing"],
    implementationNotes: [
      `${catalog.categories.length} categories observed, including nested children.`,
      "Two navigation categories are currently empty and still render as valid pages.",
    ],
  });

  push({
    id: "brand-browsing",
    name: "Brand browsing",
    description:
      "Brands are first-class: an index page lists every brand, and each brand has its own listing page with a description and product count.",
    evidenceUrls: [...brandIndexUrls, ...brandUrls].slice(0, 12),
    pageTypes: ["brand_index", "brand"],
    outputs: ["product listing"],
    implementationNotes: [
      `${catalog.brands.length} brands carry products; the index also lists brands with none.`,
      "Brand pages filter by category, the inverse of category pages, which filter by brand.",
    ],
  });

  push({
    id: "product-detail",
    name: "Product detail page",
    description:
      "Each product has a detail page with name, image, price, pack size, availability, intensity, a short description, breadcrumbs and related products.",
    evidenceUrls: productUrls.slice(0, 12),
    pageTypes: ["product"],
    outputs: ["product detail"],
    implementationNotes: [
      "Some products genuinely have no price and no pack size; both must render gracefully.",
    ],
  });

  push({
    id: "product-search",
    name: "Product search",
    description:
      "A header search box submits to a dedicated search route with the query in the URL, so results are shareable and refresh-safe.",
    evidenceUrls: searchUrls.slice(0, 4),
    pageTypes: ["search"],
    inputs: ["free-text query (min 2 characters, debounced)"],
    outputs: ["matching products"],
    implementationNotes: [
      "Reference search is client-side over an embedded catalog; our storefront queries PostgreSQL instead.",
      "Query state lives in the `q` search parameter.",
    ],
  });

  push({
    id: "catalog-filters",
    name: "Catalog filtering",
    description:
      "Listing pages expose filters whose state is encoded in URL search parameters.",
    evidenceUrls: crawl.filters.flatMap((filter) => filter.pageUrls).slice(0, 12),
    pageTypes: ["category", "subcategory", "brand", "promotion", "search"],
    inputs: crawl.filters.map((filter) => filter.urlParam ?? filter.key),
    outputs: ["filtered product listing"],
    implementationNotes: [
      "Reference filtering is client-side show/hide over a fully rendered list.",
      "A server-rendered equivalent is required for our storefront so filtered pages are crawlable.",
    ],
  });

  push({
    id: "promotions",
    name: "Promotions",
    description:
      "A promotions route lists products carrying a reduced price. The capability exists and is currently empty.",
    evidenceUrls: promotionUrls.slice(0, 4),
    pageTypes: ["promotion"],
    outputs: ["discounted product listing"],
    implementationNotes: [
      "Every observed product has an empty `old_price`, so no promotion is active right now.",
      "The route must render a proper empty state rather than 404.",
    ],
  });

  const quickOrderPages = urlsFor(
    crawl,
    (page) => page.forms.some((form) => form.fields.some((field) => field.type === "tel")),
  );
  push({
    id: "quick-order",
    name: "Quick order by phone",
    description:
      "Instead of a cart and checkout, each product offers a single phone-number field. The shop calls back to confirm the order.",
    evidenceUrls: quickOrderPages.slice(0, 8),
    pageTypes: ["product"],
    inputs: ["phone number"],
    outputs: ["order enquiry"],
    implementationNotes: [
      "There is no cart, no checkout and no payment anywhere on the reference site.",
      "The reference posts to a third-party CMS endpoint; ours must post to our own API and persist locally.",
    ],
  });

  const newsletterPages = urlsFor(
    crawl,
    (page) => page.forms.some((form) => form.fields.some((field) => field.type === "email")),
  );
  push({
    id: "newsletter-signup",
    name: "Newsletter signup",
    description: "A footer email field offers a discount in exchange for subscribing.",
    evidenceUrls: newsletterPages.slice(0, 4),
    pageTypes: ["home", "category", "product"],
    inputs: ["email address"],
    outputs: ["subscription"],
    implementationNotes: ["Must store consent locally rather than forwarding to the source."],
  });

  push({
    id: "related-products",
    name: "Related products",
    description: "Product pages show a carousel of other products from the same area of the catalog.",
    evidenceUrls: productUrls.slice(0, 6),
    pageTypes: ["product"],
    outputs: ["product recommendations"],
    implementationNotes: [
      "No explicit relationship is published, so ours is derived from category and brand.",
    ],
  });

  push({
    id: "breadcrumbs",
    name: "Breadcrumb navigation",
    description: "Product pages show shop → category → product.",
    evidenceUrls: productUrls.slice(0, 6),
    pageTypes: ["product"],
  });

  push({
    id: "blog",
    name: "Blog",
    description: "A blog route exists and currently has no published articles.",
    evidenceUrls: blogUrls.slice(0, 4),
    pageTypes: ["blog_index"],
    implementationNotes: ["Capability only; there is no content to mirror."],
  });

  push({
    id: "legal-pages",
    name: "Legal and policy pages",
    description: "Privacy policy, general terms and cookie settings are published.",
    evidenceUrls: legalUrls.slice(0, 6),
    pageTypes: ["legal"],
    implementationNotes: ["Content must be written for our business, never copied."],
  });

  const bannerPages = urlsFor(crawl, (page) =>
    Boolean((page.signals as { hasNoticeBanner?: boolean }).hasNoticeBanner),
  );
  if (bannerPages.length > 0) {
    push({
      id: "site-notice",
      name: "Sitewide notice banner",
      description: "A dismissible banner announces temporary shop closures.",
      evidenceUrls: bannerPages.slice(0, 3),
      pageTypes: ["home"],
    });
  }

  push({
    id: "phone-contact",
    name: "Phone contact",
    description: "A phone number is present in the header and footer as a direct `tel:` link.",
    evidenceUrls: urlsFor(crawl, (page) => !page.isSoft404).slice(0, 3),
    pageTypes: ["home", "product", "category"],
  });

  return features;
}

export function buildFormInventory(crawl: DiscoveryCrawlResult): ObservedForm[] {
  const byKey = new Map<string, ObservedForm & { pageUrls: string[] }>();

  for (const page of crawl.pages) {
    if (page.isSoft404) continue;
    for (const form of page.forms) {
      const fieldTypes = form.fields.map((field) => field.type ?? "unknown").sort();
      const isPhone = fieldTypes.includes("tel");
      const isEmail = fieldTypes.includes("email");
      const id = isPhone ? "quick-order" : isEmail ? "newsletter" : `form-${fieldTypes.join("-")}`;

      const existing = byKey.get(id);
      if (existing) {
        if (!existing.pageUrls.includes(page.canonicalUrl)) existing.pageUrls.push(page.canonicalUrl);
        continue;
      }

      byKey.set(id, {
        id,
        name: isPhone ? "Quick order (phone)" : isEmail ? "Newsletter signup (email)" : "Public form",
        purpose: isPhone
          ? "Submit a phone number so the shop can call back and confirm an order."
          : isEmail
            ? "Subscribe to marketing email in exchange for a discount."
            : "Unclassified public form.",
        pageUrls: [page.canonicalUrl],
        action: form.action,
        method: form.method,
        externalEndpoint: Boolean(form.action && /^https?:\/\//i.test(form.action)),
        fields: form.fields,
        submitted: false,
        sideEffectWarning: isPhone
          ? "Submitting creates a real order enquiry for the source business. Never submitted."
          : isEmail
            ? "Submitting creates a real newsletter subscription. Never submitted."
            : "Not submitted.",
      });
    }
  }

  return [...byKey.values()].map((form) => ({ ...form, pageUrls: form.pageUrls.sort() }));
}

export function buildFilterInventory(
  crawl: DiscoveryCrawlResult,
  catalog: CatalogDiscoveryResult,
): ObservedFilter[] {
  return crawl.filters.map((filter) => {
    const labels = FILTER_LABELS[filter.key] ?? {};
    const counts = new Map<string, number>();
    if (filter.key === "brand") {
      for (const brand of catalog.brands) counts.set(brand.sourceKey, brand.productCount ?? 0);
    }
    if (filter.key === "category") {
      for (const category of catalog.categories) counts.set(category.sourceKey, category.productCount ?? 0);
    }

    return {
      id: filter.key,
      name: FILTER_NAMES[filter.key] ?? filter.key,
      urlParam: filter.urlParam,
      multiValue: filter.multiValue,
      values: filter.values.map((value) => ({
        value,
        label: labels[value] ?? null,
        count: counts.get(value) ?? null,
      })),
      pageUrls: filter.pageUrls.slice(0, 10),
      appliesToPageTypes: filter.appliesToPageTypes,
      urlStateObservable: filter.urlParam !== null,
      notes:
        filter.urlParam === null
          ? "No URL parameter observed; filter state appears to be client-only."
          : "Filter state is written to the URL, so filtered views are shareable.",
    };
  });
}

/** Route patterns, summarised from the observed URL set. */
export function buildRoutePatterns(crawl: DiscoveryCrawlResult): Array<{
  pattern: string;
  pageType: string;
  matchCount: number;
  exampleUrls: string[];
  notes: string | null;
}> {
  const groups = new Map<string, { pageType: string; urls: string[] }>();

  for (const page of crawl.pages) {
    const pattern = generalisePath(page.path, page.classification.pageType);
    const key = `${pattern}::${page.classification.pageType}`;
    const entry = groups.get(key) ?? { pageType: page.classification.pageType, urls: [] };
    entry.urls.push(page.canonicalUrl);
    groups.set(key, entry);
  }

  return [...groups.entries()]
    .map(([key, entry]) => {
      const pattern = key.split("::")[0] ?? "";
      return {
        pattern,
        pageType: entry.pageType,
        matchCount: entry.urls.length,
        exampleUrls: entry.urls.slice(0, 5).sort(),
        notes:
          entry.pageType === "soft_404"
            ? "These URLs return HTTP 200 with the home page shell; they are not real pages."
            : null,
      };
    })
    .sort((a, b) => b.matchCount - a.matchCount);
}

/**
 * Reduce a concrete path to a pattern.
 *
 * The source uses a flat namespace — products, categories and brands are all
 * `/<slug>/` — so the pattern is annotated with the classified page type
 * rather than pretending the URL shape carries meaning.
 */
export function generalisePath(path: string, pageType: string): string {
  if (path === "/") return "/";
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 1) {
    switch (pageType) {
      case "product":
        return "/{product-slug}/";
      case "category":
        return "/{category-slug}/";
      case "subcategory":
        return "/{subcategory-slug}/";
      case "brand":
        return "/{brand-slug}/";
      default:
        return `/${segments[0]}/`;
    }
  }
  return `/${segments.map((segment, index) => (index === 0 ? segment : `{${segment}}`)).join("/")}/`;
}
