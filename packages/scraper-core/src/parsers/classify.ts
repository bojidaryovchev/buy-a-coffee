import type { ParsedPage } from "./page.ts";

/**
 * Page classification from combined content signals.
 *
 * The URL tells us nothing on this site: products, categories and brands all
 * live at `/<slug>/`. `/lavazza/` is a brand, `/lavazza-super-crema/` is a
 * product, and `/kapsuli/` is a category — three identical URL shapes. So the
 * classifier reasons about what the page *contains*.
 *
 * Every decision carries its evidence, which is persisted so that a
 * misclassification can be diagnosed without re-crawling.
 */

export type PageType =
  | "home"
  | "category"
  | "subcategory"
  | "product"
  | "brand"
  | "brand_index"
  | "promotion"
  | "search"
  | "blog_index"
  | "blog_article"
  | "contact"
  | "legal"
  | "soft_404"
  | "asset"
  | "other";

export type Confidence = "high" | "medium" | "low";

export interface ClassificationInput {
  readonly path: string;
  readonly page: ParsedPage;
  readonly isSoft404: boolean;
  /** Slugs known to be categories, from the catalog index. */
  readonly knownCategorySlugs?: ReadonlySet<string>;
  /** Slugs known to be subcategories. */
  readonly knownSubcategorySlugs?: ReadonlySet<string>;
  /** Slugs known to be brands. */
  readonly knownBrandSlugs?: ReadonlySet<string>;
  /** Paths known to be products, from the catalog index. */
  readonly knownProductPaths?: ReadonlySet<string>;
  /**
   * `data-*` keys found on this page's listing cards. Category pages let you
   * filter by brand (`data-brand`); brand pages let you filter by category
   * (`data-category`). That inversion identifies the page type.
   */
  readonly listingFilterKeys?: readonly string[];
  /**
   * URL parameters the page's own filter script writes to. Present on listing
   * pages (category, subcategory, promotion) and absent on brand pages, which
   * instead ship a scoped `FILTER_INIT` blob. That inversion classifies the
   * empty pages of both kinds, where there are no cards to reason about.
   */
  readonly filterContractParams?: readonly string[];
}

export interface Classification {
  readonly pageType: PageType;
  readonly confidence: Confidence;
  readonly evidence: string[];
}

/** Route markers that are unambiguous on this site. */
const KNOWN_ROUTES: ReadonlyArray<readonly [RegExp, PageType, string]> = [
  [/^\/search\/?$/i, "search", "path is the search route"],
  [/^\/promo(?:tions)?\/?$/i, "promotion", "path is the promotions route"],
  [/^\/brands?\/?$/i, "brand_index", "path is the brand index route"],
  [/^\/blog\/?$/i, "blog_index", "path is the blog index route"],
  [/^\/blog\/.+/i, "blog_article", "path is under the blog index"],
  [/^\/(privacy|terms|cookie-settings|gdpr|obshti-usloviya)\/?$/i, "legal", "path is a legal route"],
  [/^\/(contact|kontakti|contacts)\/?$/i, "contact", "path is a contact route"],
];

const ASSET_EXTENSIONS =
  /\.(?:jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|pdf|zip|woff2?|ttf|eot|mp4|webm)$/i;

export function classifyPage(input: ClassificationInput): Classification {
  const { path, page, isSoft404 } = input;
  const evidence: string[] = [];
  const slug = path.replace(/^\/+|\/+$/g, "");

  if (isSoft404) {
    return {
      pageType: "soft_404",
      confidence: "high",
      evidence: ["body matches the site's not-found shell"],
    };
  }

  if (ASSET_EXTENSIONS.test(path)) {
    return { pageType: "asset", confidence: "high", evidence: ["path has an asset extension"] };
  }

  if (path === "/" || path === "") {
    return { pageType: "home", confidence: "high", evidence: ["root path"] };
  }

  for (const [pattern, type, why] of KNOWN_ROUTES) {
    if (pattern.test(path)) return { pageType: type, confidence: "high", evidence: [why] };
  }

  // Catalog-derived knowledge is the strongest signal available, because it
  // comes from the site's own structured data rather than from our guesses.
  if (input.knownProductPaths?.has(path)) {
    evidence.push("path appears in the catalog index as a product");
    return { pageType: "product", confidence: "high", evidence };
  }
  if (input.knownSubcategorySlugs?.has(slug)) {
    evidence.push("slug appears in the catalog index as a subcategory");
    return { pageType: "subcategory", confidence: "high", evidence };
  }
  if (input.knownCategorySlugs?.has(slug)) {
    evidence.push("slug appears in the catalog index as a top-level category");
    return { pageType: "category", confidence: "high", evidence };
  }
  if (input.knownBrandSlugs?.has(slug)) {
    evidence.push("slug appears in the catalog index as a brand");
    return { pageType: "brand", confidence: "high", evidence };
  }

  // Structural signals, used when the catalog index cannot decide.
  const { signals } = page;

  const looksLikeProduct =
    signals.hasMain && signals.productItemCount === 0 && signals.hasQuickOrderWidget;
  if (looksLikeProduct) {
    evidence.push("has <main>, a quick-order widget and no listing cards");
    if (signals.sectionCount >= 1) evidence.push("detail plus related-products sections");
    return { pageType: "product", confidence: "medium", evidence };
  }

  /*
   * Structural signals that work even when a page lists nothing at all.
   * Six brands and two categories on the source are genuinely empty, and
   * without these rules they fall through to "other".
   */
  if (signals.hasFilterInit && !signals.hasQuickOrderWidget) {
    evidence.push("ships a scoped FILTER_INIT blob, which only brand pages do");
    if (signals.productItemCount === 0) evidence.push("brand currently has no products");
    return { pageType: "brand", confidence: "medium", evidence };
  }

  const contractParams = input.filterContractParams ?? [];
  if (contractParams.length > 0 && !signals.hasFilterInit) {
    evidence.push(`filter script writes ${contractParams.join(", ")} to the URL`);
    if (signals.productItemCount === 0) evidence.push("category currently has no products");
    return { pageType: "category", confidence: "medium", evidence };
  }

  if (signals.productItemCount > 0) {
    evidence.push(`renders ${signals.productItemCount} listing cards`);
    const filterKeys = new Set(input.listingFilterKeys ?? []);
    if (filterKeys.has("category") && !filterKeys.has("brand")) {
      evidence.push("cards expose data-category, the brand-page shape");
      return { pageType: "brand", confidence: "medium", evidence };
    }
    if (filterKeys.has("brand")) {
      evidence.push("cards expose data-brand, the category-page shape");
      return { pageType: "category", confidence: "medium", evidence };
    }
    evidence.push("listing cards with no distinguishing filter attributes");
    return { pageType: "category", confidence: "low", evidence };
  }

  // A JSON-LD type is authoritative when present. This site ships none today,
  // but relying on it first keeps the classifier correct if that changes.
  const jsonLdType = firstJsonLdType(page.structuredData);
  if (jsonLdType) {
    evidence.push(`JSON-LD @type is ${jsonLdType}`);
    const mapped = mapJsonLdType(jsonLdType);
    if (mapped) return { pageType: mapped, confidence: "high", evidence };
  }

  if (signals.h1Count === 0 && !signals.hasMain) {
    evidence.push("no headings and no <main>");
    return { pageType: "other", confidence: "low", evidence };
  }

  evidence.push("no decisive signal");
  return { pageType: "other", confidence: "low", evidence };
}

function firstJsonLdType(blocks: readonly unknown[]): string | null {
  for (const block of blocks) {
    if (block && typeof block === "object" && "@type" in block) {
      const type = (block as { "@type": unknown })["@type"];
      if (typeof type === "string") return type;
      if (Array.isArray(type) && typeof type[0] === "string") return type[0];
    }
  }
  return null;
}

function mapJsonLdType(type: string): PageType | null {
  switch (type.toLowerCase()) {
    case "product":
      return "product";
    case "collectionpage":
    case "itemlist":
      return "category";
    case "brand":
      return "brand";
    case "blogposting":
    case "article":
    case "newsarticle":
      return "blog_article";
    case "blog":
      return "blog_index";
    case "contactpage":
      return "contact";
    case "searchresultspage":
      return "search";
    default:
      return null;
  }
}
