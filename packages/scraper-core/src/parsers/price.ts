import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { normalizeWhitespace } from "@catalog/shared";

/**
 * Locating a price in HTML.
 *
 * The naive approach — "find any element whose text contains a currency
 * symbol" — is actively dangerous here. On a product page the price sits in a
 * flex row next to the pack size:
 *
 *     <div><span>1 кг.</span><div/><span>€30.00</span></div>
 *
 * A containment test matches the *parent* first, yielding "1 кг. €30.00".
 * Feeding that to a money parser produces €1.00, because the leading "1" is
 * the first number in the string. A silent 30x price error is far worse than
 * no price at all.
 *
 * Two rules prevent it:
 *   1. an element only qualifies if its own text is a price and nothing else;
 *   2. a currency marker is required, so "16" or "8 от 10" cannot qualify.
 */

const CURRENCY_MARKER = String.raw`€|\$|£|EUR|BGN|USD|лв\.?`;

/** Text that is a price and nothing else. */
export const PRICE_ONLY_PATTERN = new RegExp(
  String.raw`^\s*(?:${CURRENCY_MARKER})?\s*\d[\d\s�.,']*\s*(?:${CURRENCY_MARKER})?\s*$`,
  "iu",
);

/** Loose test: does this text mention a currency at all? */
export const CONTAINS_CURRENCY_PATTERN = new RegExp(`(?:${CURRENCY_MARKER})`, "iu");

/**
 * True when `text` is exactly a price: a number, a currency marker, nothing
 * else. `"€"` alone fails (no digits) and `"1 кг. €30.00"` fails (extra text).
 */
export function isPriceOnlyText(text: string): boolean {
  const value = normalizeWhitespace(text);
  if (!value) return false;
  if (!/\d/.test(value)) return false;
  if (!CONTAINS_CURRENCY_PATTERN.test(value)) return false;
  return PRICE_ONLY_PATTERN.test(value);
}

export interface FoundPrices {
  readonly priceText: string | null;
  readonly oldPriceText: string | null;
  /** Every price-only text found, in document order. */
  readonly candidates: string[];
}

function isStruckThrough($: CheerioAPI, node: Cheerio<AnyNode>): boolean {
  if (/line-through/.test(node.attr("class") ?? "")) return true;
  return node.closest("s, del, strike").length > 0;
}

/**
 * Find the current and superseded price within `scope`.
 *
 * Only leaf-most qualifying elements are considered, so a wrapper that happens
 * to contain a price cannot win over the element that *is* the price.
 */
export function findPrices($: CheerioAPI, scope: Cheerio<AnyNode>): FoundPrices {
  const candidates: Array<{ text: string; struck: boolean }> = [];

  scope.find("span, p, b, strong, del, s, ins, div, td, li").each((_, element) => {
    const node = $(element);
    const text = normalizeWhitespace(node.text());
    if (!isPriceOnlyText(text)) return;
    // Skip a node whose own price text merely comes from a descendant.
    const childHasSamePrice = node
      .children()
      .toArray()
      .some((child) => normalizeWhitespace($(child).text()) === text);
    if (childHasSamePrice) return;
    candidates.push({ text, struck: isStruckThrough($, node) });
  });

  let priceText: string | null = null;
  let oldPriceText: string | null = null;
  for (const candidate of candidates) {
    if (candidate.struck) oldPriceText ??= candidate.text;
    else priceText ??= candidate.text;
  }

  return { priceText, oldPriceText, candidates: candidates.map((c) => c.text) };
}
