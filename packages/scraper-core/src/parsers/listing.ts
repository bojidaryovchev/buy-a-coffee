import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { normalizeLabel, normalizeWhitespace } from "@catalog/shared";
import { isPriceOnlyText } from "./price.ts";

/**
 * Parser for server-rendered listing cards (`.product-item`).
 *
 * This is the independent fallback to the structured `FILTER_INIT` blob. If
 * the source ever stops shipping that blob, sync keeps working from HTML and
 * the confidence drop is what tells the circuit breaker something changed.
 *
 * Selectors are chosen to survive restyling: the card is found by a stable
 * class hook and its contents are identified by *shape* (which paragraph looks
 * like a price, which element carries the link) rather than by utility-class
 * chains, which change whenever the design does.
 */

export interface ListingCard {
  /** Source-relative product path, e.g. `/lavazza-super-crema/`. */
  readonly href: string | null;
  readonly name: string | null;
  readonly description: string | null;
  readonly priceText: string | null;
  readonly oldPriceText: string | null;
  readonly imageUrl: string | null;
  readonly imageAlt: string | null;
  /** `data-*` attributes the site uses to drive client-side filtering. */
  readonly dataAttributes: Record<string, string>;
}

export interface ListingParseResult {
  readonly cards: ListingCard[];
  /** Distinct `data-*` keys seen, used to describe filters. */
  readonly filterKeys: string[];
  /** Value sets per data attribute, for the filter inventory. */
  readonly filterValues: Record<string, string[]>;
  /** Cards the parser found but could not turn into a usable record. */
  readonly unparseableCount: number;
}

/** Extract the URL a card navigates to, from a link or an onclick handler. */
export function extractCardHref($: CheerioAPI, card: Cheerio<AnyNode>): string | null {
  const anchor = card.find("a[href]").first().attr("href");
  if (anchor && anchor.trim() && !anchor.trim().startsWith("#")) return anchor.trim();

  // Cards are also clickable via `onclick="window.location='/slug/'"`.
  const withOnclick = card.find("[onclick]").addBack("[onclick]").first().attr("onclick") ?? "";
  const match = withOnclick.match(/window\.location\s*=\s*['"]([^'"]+)['"]/);
  return match?.[1]?.trim() ?? null;
}

function textOf(el: Cheerio<AnyNode>): string {
  return normalizeWhitespace(el.text());
}

/**
 * Strict: the text must be a price and nothing else. A loose "contains a
 * currency symbol" test would classify "1 кг. €30.00" as the price and a money
 * parser would then read it as 1.00.
 */
function looksLikePrice(value: string): boolean {
  return isPriceOnlyText(value);
}

/** Struck-through text is how a superseded price is rendered. */
function isStruckThrough($: CheerioAPI, el: Cheerio<AnyNode>): boolean {
  const cls = el.attr("class") ?? "";
  if (/line-through/.test(cls)) return true;
  return el.closest("s, del, strike").length > 0;
}

export function parseListingCard($: CheerioAPI, element: AnyNode): ListingCard | null {
  const card = $(element);

  const dataAttributes: Record<string, string> = {};
  const attribs = (element as { attribs?: Record<string, string> }).attribs ?? {};
  for (const [key, value] of Object.entries(attribs)) {
    if (key.startsWith("data-")) dataAttributes[key.slice(5)] = value;
  }

  const href = extractCardHref($, card);

  const image = card.find("img").first();
  const imageUrl = image.attr("src")?.trim() ?? null;
  const imageAlt = image.attr("alt") ? normalizeLabel(image.attr("alt")) : null;

  const paragraphs = card
    .find("p, h2, h3")
    .toArray()
    .map((node) => ({ node, text: textOf($(node)) }))
    .filter((entry) => entry.text.length > 0);

  const priceEntries = paragraphs.filter((entry) => looksLikePrice(entry.text));
  const textEntries = paragraphs.filter((entry) => !looksLikePrice(entry.text));

  let priceText: string | null = null;
  let oldPriceText: string | null = null;
  for (const entry of priceEntries) {
    if (isStruckThrough($, $(entry.node))) oldPriceText ??= entry.text;
    else priceText ??= entry.text;
  }
  // A struck price with no companion is left as the old price only: promoting
  // it to the current price would advertise a price the shop is not charging.

  // The alt text mirrors the product name exactly on this site, which makes it
  // a better name source than positional guessing when both are available.
  const name = imageAlt || textEntries[0]?.text || null;
  const description =
    textEntries.length > 1
      ? (textEntries[textEntries.length - 1]?.text ?? null)
      : imageAlt && textEntries[0]
        ? textEntries[0].text
        : null;

  if (!href && !name) return null;

  return {
    href,
    name,
    description: description === name ? null : description,
    priceText,
    oldPriceText,
    imageUrl,
    imageAlt,
    dataAttributes,
  };
}

/** Parse every `.product-item` card on a listing page. */
export function parseListingPage(html: string): ListingParseResult {
  const $ = cheerio.load(html);
  const cards: ListingCard[] = [];
  let unparseableCount = 0;

  const filterValues: Record<string, Set<string>> = {};

  $(".product-item").each((_, element) => {
    const card = parseListingCard($, element);
    if (!card) {
      unparseableCount += 1;
      return;
    }
    cards.push(card);
    for (const [key, value] of Object.entries(card.dataAttributes)) {
      (filterValues[key] ??= new Set()).add(value);
    }
  });

  return {
    cards,
    filterKeys: Object.keys(filterValues).sort(),
    filterValues: Object.fromEntries(
      Object.entries(filterValues).map(([key, values]) => [key, [...values].sort()]),
    ),
    unparseableCount,
  };
}

/**
 * Filter controls rendered in the sidebar, with the URL parameter each one
 * writes to. The mapping between a control and its parameter is recovered from
 * the page's own filter script, so it reflects real behaviour.
 */
export interface FilterControl {
  readonly key: string;
  readonly label: string | null;
  readonly urlParam: string | null;
  readonly multiValue: boolean;
  readonly values: Array<{ value: string; label: string | null; count: number | null }>;
}

const FILTER_PARAM_PATTERN = /params\.set\(\s*['"]([a-z_]+)['"]\s*,\s*_active([A-Za-z]+)/g;
const MULTI_VALUE_PATTERN = /_active([A-Za-z]+)\s*\.join\(\s*['"],['"]\s*\)/g;

/** Recover the filter/URL-parameter contract from the page's inline script. */
export function parseFilterContract(html: string): Array<{
  urlParam: string;
  stateName: string;
  multiValue: boolean;
}> {
  const multi = new Set<string>();
  for (const match of html.matchAll(MULTI_VALUE_PATTERN)) {
    if (match[1]) multi.add(match[1].toLowerCase());
  }
  const out: Array<{ urlParam: string; stateName: string; multiValue: boolean }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(FILTER_PARAM_PATTERN)) {
    const urlParam = match[1];
    const stateName = match[2];
    if (!urlParam || !stateName || seen.has(urlParam)) continue;
    seen.add(urlParam);
    out.push({ urlParam, stateName, multiValue: multi.has(stateName.toLowerCase()) });
  }
  return out;
}
