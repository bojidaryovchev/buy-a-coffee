import {
  type Decimal,
  divideDecimal,
  formatDecimal,
  parseDecimal,
  rescale,
  stripTrailingZeros,
} from "./decimal.ts";

/**
 * Servings per pack, and price per serving.
 *
 * Pack price is a misleading way to compare coffee and the catalog proves it:
 * 100 capsules at EUR 33.25 is EUR 0.33 a cup, while 16 capsules at EUR 5.60 is
 * EUR 0.35 — the cheaper-looking box costs more per cup. Across the catalog the
 * per-cup spread is roughly EUR 0.09 to EUR 0.54, a factor of five that pack
 * price hides completely.
 *
 * Piece counts are exact. Ground weight is not: how much coffee a shot uses is
 * a property of the machine and the drinker, not of the pack, so anything
 * derived from grams is marked `estimated` and must be presented as an
 * approximation. Quietly rounding an estimate into a hard number would be the
 * dishonest version of this feature.
 *
 * Arithmetic is exact throughout, for the same reason as everywhere else in
 * this package: these values are compared and sorted, and float drift would
 * make the ordering non-deterministic at the margins.
 */

/**
 * Grams of coffee in one serving.
 *
 * The Italian espresso convention, and what the bean packs in this catalog are
 * sold against. It is deliberately a single constant rather than a per-product
 * field: the source publishes nothing about dose, so a per-product value would
 * be invented precision.
 */
export const GRAMS_PER_SERVING = 7;

/** Fraction digits kept on a per-serving price. */
export const SERVING_PRICE_SCALE = 4;

export interface PackServings {
  /** Exact servings as a decimal string, e.g. "142.8571" or "100". */
  readonly exact: string;
  /** Whole servings, for display. Rounded down: never promise a part-cup. */
  readonly whole: number;
  /**
   * True when the count was derived from weight at `GRAMS_PER_SERVING` rather
   * than read from an explicit piece count. Display must say so.
   */
  readonly estimated: boolean;
}

const SERVING_DIVISOR: Decimal = parseDecimal(String(GRAMS_PER_SERVING));

/**
 * Servings in a pack, from the normalised weight columns.
 *
 * Returns null for a pack we cannot reason about — no size, a zero size, or a
 * unit that is not coffee by piece or by weight — rather than guessing.
 */
export function packServings(
  weightValue: string | null | undefined,
  weightUnit: string | null | undefined,
): PackServings | null {
  if (!weightValue || !weightUnit) return null;

  let quantity: Decimal;
  try {
    quantity = parseDecimal(weightValue);
  } catch {
    return null;
  }
  if (quantity.unscaled <= 0n) return null;

  if (weightUnit === "pc") {
    const whole = Number(rescale(quantity, 0).unscaled);
    if (!Number.isSafeInteger(whole) || whole <= 0) return null;
    return { exact: stripTrailingZeros(formatDecimal(quantity)), whole, estimated: false };
  }

  if (weightUnit === "g") {
    const servings = divideDecimal(quantity, SERVING_DIVISOR, SERVING_PRICE_SCALE);
    const whole = Math.floor(Number(formatDecimal(servings)));
    if (!Number.isFinite(whole) || whole <= 0) return null;
    return { exact: stripTrailingZeros(formatDecimal(servings)), whole, estimated: true };
  }

  // Millilitres are a syrup or a bottle, not a number of coffees.
  return null;
}

/**
 * Price of one serving, as an exact decimal string at `SERVING_PRICE_SCALE`.
 *
 * Four fraction digits are kept on purpose. Two would collapse EUR 0.094 and
 * EUR 0.099 a cup into the same number and make the cheapest products sort
 * arbitrarily against each other; display rounds afterwards.
 */
export function pricePerServing(
  price: string | null | undefined,
  servings: PackServings | null,
): string | null {
  if (!price || !servings) return null;

  let amount: Decimal;
  let divisor: Decimal;
  try {
    amount = parseDecimal(price);
    divisor = parseDecimal(servings.exact);
  } catch {
    return null;
  }
  if (amount.unscaled < 0n || divisor.unscaled <= 0n) return null;

  return formatDecimal(divideDecimal(amount, divisor, SERVING_PRICE_SCALE));
}
