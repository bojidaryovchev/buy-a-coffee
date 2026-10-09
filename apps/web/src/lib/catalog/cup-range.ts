import { compareDecimal, packServings, parseDecimal, pricePerServing } from "@catalog/shared";
import { siteConfig } from "@/config/site";
import { toPriceView } from "./format";

/**
 * The cheapest and the dearest cup among a set of products.
 *
 * A listing's meta description quotes this range, because a price per cup is
 * the one thing a search snippet of this shop can show that nobody else's can.
 * It is computed from the same two helpers a product card uses
 * (`packServings`, `pricePerServing`), on exact decimals, so the snippet can
 * never quote a figure the page under it does not show.
 *
 * Pure: `listing-facts.ts` does the reading, this does the arithmetic, and a
 * test covers it without a database.
 */

/** As much of a product as a per-cup price needs. */
export interface CupRangeRow {
  /** Retail price as an exact decimal string. */
  readonly price: string | null;
  readonly currency: string | null;
  readonly weightValue: string | null;
  readonly weightUnit: string | null;
}

export interface CupPrice {
  /** Exact decimal string at `SERVING_PRICE_SCALE`, for comparison only. */
  readonly amount: string;
  /** True when the cups were derived from weight: print it with "≈". */
  readonly estimated: boolean;
}

export interface CupRange {
  readonly cheapest: CupPrice;
  readonly dearest: CupPrice;
  readonly currency: string;
}

/**
 * The range over `rows`, or null when none of them has a per-cup price.
 *
 * Only the shop's own currency takes part: two currencies cannot be ranked
 * against each other, and a product priced in another is left out rather than
 * converted at a rate nobody chose.
 */
export function cupRangeOf(
  rows: readonly CupRangeRow[],
  currency: string = siteConfig.currency,
): CupRange | null {
  let cheapest: CupPrice | null = null;
  let dearest: CupPrice | null = null;

  for (const row of rows) {
    if ((row.currency ?? currency) !== currency) continue;
    const servings = packServings(row.weightValue, row.weightUnit);
    const amount = pricePerServing(row.price, servings);
    if (!amount || !servings) continue;

    const value = parseDecimal(amount);
    // A free cup is a missing price, not the cheapest coffee in the shop.
    if (value.unscaled <= 0n) continue;

    const cup: CupPrice = { amount, estimated: servings.estimated };
    if (!cheapest || compareDecimal(value, parseDecimal(cheapest.amount)) < 0) cheapest = cup;
    if (!dearest || compareDecimal(value, parseDecimal(dearest.amount)) > 0) dearest = cup;
  }

  return cheapest && dearest ? { cheapest, dearest, currency } : null;
}

/**
 * One range over several: the cheapest of the cheapest, the dearest of the
 * dearest. For a page that lists products from more than one read. Null when
 * none of them has a range; ranges in another currency are left out.
 */
export function cupRangeOfRanges(ranges: ReadonlyArray<CupRange | null>): CupRange | null {
  let merged: CupRange | null = null;
  for (const range of ranges) {
    if (!range) continue;
    if (!merged) {
      merged = range;
      continue;
    }
    if (range.currency !== merged.currency) continue;
    const amount = (cup: CupPrice) => parseDecimal(cup.amount);
    merged = {
      currency: merged.currency,
      cheapest:
        compareDecimal(amount(range.cheapest), amount(merged.cheapest)) < 0
          ? range.cheapest
          : merged.cheapest,
      dearest:
        compareDecimal(amount(range.dearest), amount(merged.dearest)) > 0
          ? range.dearest
          : merged.dearest,
    };
  }
  return merged;
}

/**
 * The one pack size every row shares, in pieces, or null when they differ,
 * when there are none, or when any pack is sold by weight.
 */
export function uniformPieceCount(rows: readonly CupRangeRow[]): number | null {
  const sizes = new Set<number>();
  for (const row of rows) {
    if (row.weightUnit !== "pc" || !row.weightValue) return null;
    const pieces = Number(row.weightValue);
    if (!Number.isInteger(pieces) || pieces <= 0) return null;
    sizes.add(pieces);
  }
  const [only] = [...sizes];
  return sizes.size === 1 && only !== undefined ? only : null;
}

/** "0,31 €", or "≈ 0,12 €" for a figure derived from weight (`PRODUCT.md`). */
function cupFigure(cup: CupPrice, currency: string): string | null {
  const price = toPriceView(cup.amount, currency);
  return price ? `${cup.estimated ? "≈ " : ""}${price.formatted}` : null;
}

/**
 * The range as a customer reads it: „от 0,19 € до 0,42 € на чаша“.
 *
 * One figure when both ends print the same, which is every listing with one
 * product and every listing whose packs differ only past the second decimal.
 * Each end carries its own "≈": on the home page the cheapest cup is beans by
 * weight and the dearest is a counted capsule.
 */
export function cupRangePhrase(range: CupRange | null): string | null {
  if (!range) return null;
  const from = cupFigure(range.cheapest, range.currency);
  const to = cupFigure(range.dearest, range.currency);
  if (!from || !to) return null;
  return from === to ? `${from} на чаша` : `от ${from} до ${to} на чаша`;
}
