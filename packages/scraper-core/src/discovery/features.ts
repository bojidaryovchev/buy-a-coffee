import type { CatalogDiscoveryResult } from "../catalog/discover.ts";
import type { DiscoveryCrawlResult } from "./crawler.ts";
import type { NoticeBannerSignal, StorefrontSignals } from "./pageSignals.ts";

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

type Page = DiscoveryCrawlResult["pages"][number];

function urlsFor(crawl: DiscoveryCrawlResult, predicate: (page: Page) => boolean): string[] {
  return crawl.pages
    .filter(predicate)
    .map((page) => page.canonicalUrl)
    .sort();
}

/** The storefront signals the crawler recorded for a page, if it recorded any. */
function storefront(page: Page): Partial<StorefrontSignals> {
  return page.signals as Partial<StorefrontSignals>;
}

/**
 * The two navigation pages the source added beside its product categories.
 * They classify as `category` — same listing shell, same filters — so the
 * page type cannot tell them apart; the slug and the heading can.
 */
const BUSINESS_PAGES = [
  {
    id: "vending-zone",
    name: "Vending Zone page",
    slug: /^\/vending-zona\/$/i,
    heading: /вендинг/iu,
    description:
      "A navigation page for vending customers: a paragraph of descriptive copy above a product listing with the usual filters.",
  },
  {
    id: "consumables",
    name: "Consumables page",
    slug: /^\/konsumativi\/$/i,
    heading: /консуматив/iu,
    description:
      "A navigation page for consumables sold beside the coffee: a paragraph of descriptive copy above a product listing with the usual filters.",
  },
] as const;

function isListingPage(page: Page): boolean {
  return (
    !page.isSoft404 &&
    (page.classification.pageType === "category" || page.classification.pageType === "subcategory")
  );
}

const BANNER_DESCRIPTIONS: Readonly<Record<NoticeBannerSignal["kind"], string>> = {
  delivery_threshold:
    "A dismissible banner at the top of every page. It currently states the order value above which delivery is free, beside a one-line pitch for ordering by phone.",
  opening_hours:
    "A dismissible banner at the top of every page. It currently announces the shop's opening hours or a closure.",
  other: "A dismissible banner at the top of every page, carrying one short shop-wide message.",
};

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
  const blogIndexUrls = byType("blog_index");
  const blogArticleUrls = byType("blog_article");
  const legalUrls = byType("legal");
  const emptyListingCount = crawl.pages.filter(
    (page) => isListingPage(page) && page.signals.listingCardCount === 0,
  ).length;

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
      ...(emptyListingCount > 0
        ? [
            `${emptyListingCount} navigation ${emptyListingCount === 1 ? "page lists" : "pages list"} no products at the moment and still ${emptyListingCount === 1 ? "renders as a valid page" : "render as valid pages"}.`,
          ]
        : []),
    ],
  });

  for (const business of BUSINESS_PAGES) {
    const pages = crawl.pages.filter(
      (page) =>
        isListingPage(page) &&
        (business.slug.test(page.path) ||
          page.headings.some(
            (heading) => heading.level === 1 && business.heading.test(heading.text),
          )),
    );
    const listed = pages.reduce(
      (sum, page) =>
        sum +
        (typeof page.signals.listingCardCount === "number" ? page.signals.listingCardCount : 0),
      0,
    );
    push({
      id: business.id,
      name: business.name,
      description: business.description,
      evidenceUrls: pages
        .map((page) => page.canonicalUrl)
        .sort()
        .slice(0, 4),
      pageTypes: ["category"],
      outputs: ["descriptive copy", "product listing"],
      implementationNotes: [
        listed === 0
          ? "It lists no products at the moment, and renders its empty state rather than a 404."
          : `It lists ${listed} product${listed === 1 ? "" : "s"}.`,
        "It is absent from the structured catalog's category list: it is navigation, not a category a product belongs to.",
        "The copy on it is the source's own and is never mirrored.",
      ],
    });
  }

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
      "Each product has a detail page with name, image, price, pack size, availability, intensity, a short description, a longer write-up, breadcrumbs and related products.",
    evidenceUrls: productUrls.slice(0, 12),
    pageTypes: ["product"],
    outputs: ["product detail"],
    implementationNotes: [
      "The source has listed products with no price and with no pack size before; both must render gracefully.",
      "The longer write-up is the source's prose: the storefront writes its own or shows none.",
    ],
  });

  const codePages = crawl.pages.filter((page) => storefront(page).hasProductCode === true);
  push({
    id: "product-code",
    name: "Product code",
    description: "Each product page prints a short product code among its attributes.",
    evidenceUrls: codePages
      .map((page) => page.canonicalUrl)
      .sort()
      .slice(0, 12),
    pageTypes: ["product"],
    outputs: ["product code"],
    implementationNotes: [
      ...(codePages.length > 0 &&
      codePages.every((page) => storefront(page).productCodeInStructuredData === true)
        ? ["The same code is the `sku` of the page's Product structured data."]
        : []),
      "It is a string: leading zeros are part of it.",
      "The catalog listing does not carry it; it is read from the product page.",
    ],
  });

  const characteristicPages = crawl.pages.filter(
    (page) => (storefront(page).characteristicLabels?.length ?? 0) > 0,
  );
  const labelCounts = new Map<string, number>();
  for (const page of characteristicPages) {
    for (const label of storefront(page).characteristicLabels ?? []) {
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
  }
  const commonLabels = [...labelCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 8)
    .map(([label]) => label);
  push({
    id: "product-characteristics",
    name: "Product characteristics list",
    description:
      "Below the write-up, product pages print a labelled list of characteristics: what the coffee is made of, where it comes from, how it tastes, what it fits.",
    evidenceUrls: characteristicPages
      .map((page) => page.canonicalUrl)
      .sort()
      .slice(0, 12),
    pageTypes: ["product"],
    outputs: ["labelled product facts"],
    implementationNotes: [
      `Labels seen most often: ${commonLabels.join(", ")}.`,
      "The list is written by hand and its markup varies; a label may be missing from any page.",
      "Only what a page states is shown: a missing label is an omitted row, never a guess.",
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
    description: "Listing pages expose filters whose state is encoded in URL search parameters.",
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

  const quickOrderPages = urlsFor(crawl, (page) =>
    page.forms.some((form) => form.fields.some((field) => field.type === "tel")),
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
      "There is no cart and no online checkout anywhere on the reference site.",
      "The reference posts to a third-party CMS endpoint; ours must post to our own API and persist locally.",
    ],
  });

  const newsletterPages = urlsFor(crawl, (page) =>
    page.forms.some((form) => form.fields.some((field) => field.type === "email")),
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
    description:
      "Product pages show a carousel of other products from the same area of the catalog.",
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
    description:
      blogArticleUrls.length > 0
        ? "A blog index lists the published articles, and each article has a page of its own."
        : "A blog route exists and currently has no published articles.",
    evidenceUrls: [...blogIndexUrls, ...blogArticleUrls].slice(0, 4),
    pageTypes: blogArticleUrls.length > 0 ? ["blog_index", "blog_article"] : ["blog_index"],
    implementationNotes:
      blogArticleUrls.length > 0
        ? [
            `${blogArticleUrls.length} article${blogArticleUrls.length === 1 ? "" : "s"} observed.`,
            "An article is the source's own writing: the capability is matched, the text is never mirrored.",
          ]
        : ["Capability only; there is no content to mirror."],
  });

  push({
    id: "legal-pages",
    name: "Legal and policy pages",
    description: "Privacy policy, general terms and cookie settings are published.",
    evidenceUrls: legalUrls.slice(0, 6),
    pageTypes: ["legal"],
    implementationNotes: ["Content must be written for our business, never copied."],
  });

  /*
   * The banner is a mechanism; what it is used for changes. It announced
   * closure dates once and states a delivery threshold now, so the entry
   * describes what was actually read from it rather than assuming either —
   * and a stated threshold is reported as a capability in its own right
   * below, because "says when delivery is free" is something a storefront
   * either does or does not do, whatever it uses to say it.
   */
  const bannerPages = crawl.pages.filter((page) => storefront(page).noticeBanner != null);
  const bannerKinds = new Map<NoticeBannerSignal["kind"], number>();
  for (const page of bannerPages) {
    const kind = (storefront(page).noticeBanner as NoticeBannerSignal).kind;
    bannerKinds.set(kind, (bannerKinds.get(kind) ?? 0) + 1);
  }
  const bannerKind = [...bannerKinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
  push({
    id: "site-notice",
    name: "Sitewide notice banner",
    description: BANNER_DESCRIPTIONS[bannerKind],
    evidenceUrls: bannerPages
      .map((page) => page.canonicalUrl)
      .sort()
      .slice(0, 3),
    pageTypes: [...new Set(bannerPages.map((page) => page.classification.pageType))].sort(),
    implementationNotes: [
      "What the banner says is the source's own message. A storefront banner states its own terms, never these.",
      ...(bannerPages.some((page) => storefront(page).noticeBanner?.dismissible)
        ? ["Dismissing it is remembered in the browser, so it stays closed on later pages."]
        : []),
    ],
  });

  const thresholdPages = bannerPages.filter(
    (page) => storefront(page).noticeBanner?.kind === "delivery_threshold",
  );
  const thresholds = [
    ...new Set(
      thresholdPages
        .map((page) => storefront(page).noticeBanner?.deliveryThreshold)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  push({
    id: "delivery-threshold",
    name: "Free-delivery threshold",
    description: "The shop states, on every page, the order value above which delivery is free.",
    evidenceUrls: thresholdPages
      .map((page) => page.canonicalUrl)
      .sort()
      .slice(0, 3),
    pageTypes: [...new Set(thresholdPages.map((page) => page.classification.pageType))].sort(),
    outputs: ["delivery terms"],
    implementationNotes: [
      `Threshold stated by the source: ${thresholds.join(", ")}.`,
      "That figure is the source's commercial term. Ours is configuration, and is shown only when it is set.",
    ],
  });

  const paymentPages = crawl.pages.filter(
    (page) => (storefront(page).paymentMethods?.length ?? 0) > 0,
  );
  const paymentMethods = [
    ...new Set(paymentPages.flatMap((page) => storefront(page).paymentMethods ?? [])),
  ];
  push({
    id: "payment-methods",
    name: "Listed payment methods",
    description: "The footer of every page lists the ways an order can be paid for.",
    evidenceUrls: paymentPages
      .map((page) => page.canonicalUrl)
      .sort()
      .slice(0, 3),
    pageTypes: [...new Set(paymentPages.map((page) => page.classification.pageType))].sort(),
    outputs: ["payment terms"],
    implementationNotes: [
      `Methods listed: ${paymentMethods.join(", ")}.`,
      "Nothing is paid on the site: there is no checkout. The list informs an order placed by phone.",
      "The source's wording for each method is not reused; ours comes from configuration.",
    ],
  });

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
        if (!existing.pageUrls.includes(page.canonicalUrl))
          existing.pageUrls.push(page.canonicalUrl);
        continue;
      }

      byKey.set(id, {
        id,
        name: isPhone
          ? "Quick order (phone)"
          : isEmail
            ? "Newsletter signup (email)"
            : "Public form",
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
      for (const category of catalog.categories)
        counts.set(category.sourceKey, category.productCount ?? 0);
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
