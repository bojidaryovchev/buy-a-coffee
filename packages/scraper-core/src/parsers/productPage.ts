import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { normalizeLabel, normalizeWhitespace } from "@catalog/shared";
import { findPrices } from "./price.ts";

/**
 * Product detail page parser.
 *
 * Two traps on this site shape the implementation:
 *
 *  1. Every detail block is rendered twice — once for desktop, once for
 *     mobile. Naive extraction doubles every attribute list and heading, so
 *     everything here de-duplicates.
 *  2. The related-products carousel contains other products' prices. Reading
 *     "the first price in <main>" would attribute a neighbour's price to this
 *     product, which is exactly wrong for the products that have no price of
 *     their own. The related section is therefore excluded before any price is
 *     read.
 */

const CURRENCY_PATTERN = /(?:€|\$|£|лв\.?|EUR|BGN|USD)\s*[\d.,]+|[\d.,]+\s*(?:€|\$|£|лв\.?|EUR|BGN)/i;

/** Attribute labels observed on the source, mapped to stable keys. */
const ATTRIBUTE_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^наличност$/iu, "availability"],
  [/^интензивност$/iu, "intensity"],
  [/^интензитет$/iu, "intensity"],
  [/^тегло$/iu, "weight"],
  [/^вид$/iu, "type"],
  [/^опаковка$/iu, "packaging"],
  [/^произход$/iu, "origin"],
  [/^състав$/iu, "composition"],
];

export interface ProductPageBreadcrumb {
  readonly label: string;
  readonly href: string | null;
}

export interface ProductPageRelated {
  readonly href: string;
  readonly name: string | null;
  readonly priceText: string | null;
  readonly imageUrl: string | null;
}

export interface ProductPageQuickOrder {
  readonly present: boolean;
  /** Endpoint the page's own script posts to, when discoverable. */
  readonly endpoint: string | null;
  readonly external: boolean;
  readonly fields: Array<{ name: string | null; type: string | null; required: boolean; label: string | null }>;
  readonly submitLabel: string | null;
}

export interface ProductPageParseResult {
  readonly name: string | null;
  readonly descriptionText: string | null;
  readonly descriptionHtml: string | null;
  readonly priceText: string | null;
  readonly oldPriceText: string | null;
  readonly availabilityText: string | null;
  readonly weightText: string | null;
  /** Normalised label -> value, e.g. `{ intensity: "8 от 10" }`. */
  readonly attributes: Record<string, string>;
  /** Attribute rows exactly as rendered, for auditing. */
  readonly rawAttributeRows: string[];
  readonly breadcrumbs: ProductPageBreadcrumb[];
  readonly categoryHref: string | null;
  readonly imageUrls: string[];
  readonly primaryImageUrl: string | null;
  readonly primaryImageAlt: string | null;
  readonly related: ProductPageRelated[];
  readonly quickOrder: ProductPageQuickOrder;
  /** 0..1 signal of how much of the expected shape was recognised. */
  readonly confidence: number;
}

function textOf(el: Cheerio<AnyNode>): string {
  return normalizeWhitespace(el.text());
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Split `<main>` into the product region and the related-products region.
 * Falls back to a heading scan when the section structure changes.
 */
export function splitProductRegions($: CheerioAPI): {
  detail: Cheerio<AnyNode>;
  related: Cheerio<AnyNode>;
} {
  const main = $("main").first();
  const scope = main.length > 0 ? main : $("body");
  const sections = scope.children("section");

  if (sections.length >= 2) {
    return { detail: sections.first(), related: sections.slice(1) };
  }

  // Fallback: everything after a heading that introduces related products.
  const relatedHeading = scope
    .find("h2, h3, p")
    .filter((_, el) => /свързани продукти|related products/iu.test($(el).text()))
    .first();

  if (relatedHeading.length > 0) {
    const container = relatedHeading.closest("section").length
      ? relatedHeading.closest("section")
      : relatedHeading.parent();
    return { detail: scope, related: container };
  }
  return { detail: scope, related: $([] as unknown as AnyNode[]) };
}

function parseAttributeRows(rows: readonly string[]): {
  attributes: Record<string, string>;
  availability: string | null;
  weight: string | null;
} {
  const attributes: Record<string, string> = {};
  let availability: string | null = null;
  let weight: string | null = null;

  for (const row of rows) {
    const separator = row.indexOf(":");
    if (separator === -1) continue;
    const label = normalizeLabel(row.slice(0, separator));
    const value = normalizeLabel(row.slice(separator + 1));
    if (!label || !value) continue;

    const mapped = ATTRIBUTE_LABELS.find(([pattern]) => pattern.test(label))?.[1];
    const key = mapped ?? label.toLowerCase();
    if (attributes[key] === undefined) attributes[key] = value;
    if (mapped === "availability") availability ??= value;
    if (mapped === "weight") weight ??= value;
  }
  return { attributes, availability, weight };
}

function parseQuickOrder($: CheerioAPI, html: string): ProductPageQuickOrder {
  const inputs = $('input[type="tel"], input[id*="phone"]');
  const button = $('button[id*="buy"], button[onclick*="submitPhone"]').first();

  // The flow is script-driven, so the endpoint lives in the inline JS.
  const endpointMatch = html.match(
    /(?:INTENTS_URL|intentsUrl)\s*=\s*['"]([^'"]+)['"]|fetch\(\s*['"]([^'"]+\/api\/[^'"]+)['"]/,
  );
  const endpoint = endpointMatch?.[1] ?? endpointMatch?.[2] ?? null;

  let external = false;
  if (endpoint) {
    try {
      external = new URL(endpoint).hostname.length > 0;
    } catch {
      external = false;
    }
  }

  const fields = inputs
    .toArray()
    .map((el) => {
      const input = $(el);
      const id = input.attr("id") ?? null;
      const label = id ? textOf($(`label[for="${id}"]`)) || null : null;
      return {
        name: input.attr("name") ?? id,
        type: input.attr("type") ?? null,
        required: input.attr("required") !== undefined,
        label: label ?? input.attr("placeholder") ?? null,
      };
    })
    // Desktop and mobile render the same field twice.
    .filter((field, index, all) => all.findIndex((f) => f.type === field.type) === index);

  return {
    present: inputs.length > 0,
    endpoint,
    external,
    fields,
    submitLabel: button.length > 0 ? textOf(button) || null : null,
  };
}

/**
 * Breadcrumbs are the block(s) rendered before the first <section> of <main>.
 *
 * Scanning all of <main> for anchors and spans would sweep up the pack-size
 * and price spans as if they were crumbs, so the boundary is structural.
 * Desktop and mobile render the same trail twice; it is de-duplicated by label.
 */
export function parseBreadcrumbs($: CheerioAPI): ProductPageBreadcrumb[] {
  const main = $("main").first();
  const scope = main.length > 0 ? main : $("body");

  const containers: AnyNode[] = [];
  for (const child of scope.children().toArray()) {
    const tag = (child as { tagName?: string }).tagName?.toLowerCase();
    if (tag === "section") break;
    if (tag === "div" || tag === "nav") containers.push(child);
  }

  const crumbs: ProductPageBreadcrumb[] = [];
  const seen = new Set<string>();
  for (const container of containers) {
    $(container)
      .find("a, span")
      .each((_, element) => {
        const node = $(element);
        // Skip wrappers whose text merely comes from a nested crumb.
        if (node.children("a, span").length > 0) return;
        const label = normalizeLabel(node.text());
        if (!label || label.length > 160 || seen.has(label)) return;
        seen.add(label);
        crumbs.push({ label, href: node.attr("href")?.trim() || null });
      });
  }
  return crumbs;
}

export function parseProductPage(html: string): ProductPageParseResult {
  const $ = cheerio.load(html);
  const { detail, related } = splitProductRegions($);

  const name = uniqueInOrder($("h1").toArray().map((el) => normalizeLabel($(el).text())))[0] ?? null;

  const rawAttributeRows = uniqueInOrder(detail.find("li").toArray().map((el) => textOf($(el))));
  const { attributes, availability, weight } = parseAttributeRows(rawAttributeRows);

  // Prices are read only from the detail region, never from related products,
  // and only from elements whose text is a price and nothing else.
  const { priceText, oldPriceText } = findPrices($, detail);

  const descriptionNode = detail
    .find("p")
    .filter((_, el) => {
      const text = textOf($(el));
      if (text.length < 24) return false;
      if (CURRENCY_PATTERN.test(text)) return false;
      // Skip the consent/marketing boilerplate around the order widget.
      return !/политика за поверителност|ще ви се обадим|нужен е само/iu.test(text);
    })
    .first();

  const descriptionText = descriptionNode.length > 0 ? textOf(descriptionNode) : null;
  const descriptionHtml = descriptionNode.length > 0 ? (descriptionNode.html() ?? null) : null;

  const breadcrumbs = parseBreadcrumbs($);
  // The deepest linked crumb is the product's category; the first one is the
  // shop root, which tells us nothing.
  const linkedCrumbs = breadcrumbs.filter((crumb) => crumb.href && crumb.href !== "/");
  const categoryHref = linkedCrumbs[linkedCrumbs.length - 1]?.href ?? null;

  const primaryImage = detail.find("img[id*='main-product-img']").first();
  const detailImages = uniqueInOrder(
    detail
      .find("img")
      .toArray()
      .map((el) => $(el).attr("src")?.trim() ?? "")
      .filter((src) => src.length > 0 && !src.endsWith(".svg")),
  );
  const primaryImageUrl = primaryImage.attr("src")?.trim() ?? detailImages[0] ?? null;
  const primaryImageAlt = primaryImage.attr("alt")
    ? normalizeLabel(primaryImage.attr("alt"))
    : (name ?? null);

  const relatedItems: ProductPageRelated[] = [];
  const seenRelated = new Set<string>();
  related.find("[onclick*='window.location'], a[href]").each((_, el) => {
    const node = $(el);
    const onclick = node.attr("onclick") ?? "";
    const href =
      onclick.match(/window\.location\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? node.attr("href") ?? "";
    if (!href || href.startsWith("#") || seenRelated.has(href)) return;
    seenRelated.add(href);
    const card = node.closest("div").length > 0 ? node.closest("div") : node;
    const image = card.find("img").first();
    const priceNode = card
      .find("p, span")
      .filter((_, priceEl) => CURRENCY_PATTERN.test(textOf($(priceEl))))
      .first();
    relatedItems.push({
      href,
      name: image.attr("alt") ? normalizeLabel(image.attr("alt")) : null,
      priceText: priceNode.length > 0 ? textOf(priceNode) : null,
      imageUrl: image.attr("src")?.trim() ?? null,
    });
  });

  const quickOrder = parseQuickOrder($, html);

  const signals = [
    name !== null,
    rawAttributeRows.length > 0,
    primaryImageUrl !== null,
    breadcrumbs.length > 0,
    descriptionText !== null,
    quickOrder.present,
  ];
  const confidence = signals.filter(Boolean).length / signals.length;

  return {
    name,
    descriptionText,
    descriptionHtml,
    priceText,
    oldPriceText,
    availabilityText: availability,
    weightText: weight,
    attributes,
    rawAttributeRows,
    breadcrumbs,
    categoryHref,
    imageUrls: primaryImageUrl ? uniqueInOrder([primaryImageUrl, ...detailImages]) : detailImages,
    primaryImageUrl,
    primaryImageAlt,
    related: relatedItems,
    quickOrder,
    confidence,
  };
}
