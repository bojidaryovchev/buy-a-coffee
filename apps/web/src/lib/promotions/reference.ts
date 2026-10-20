import { moneyFromDecimalString } from "@catalog/shared";

/**
 * The price a reduction is announced against: the lowest price the shop
 * charged for the product in the 30 days before the reduction began for it.
 *
 * This is the legally sensitive part of a promotion. Directive 98/6/EC,
 * Art. 6a (the "Omnibus" rule, in the Bulgarian Consumer Protection Act since
 * 2022) says an announced reduction must show "the prior price": the lowest
 * price applied during at least 30 days before the reduction. A struck price
 * above that is a false claim, so wherever the history is uncertain this
 * module errs low: a smaller badge, or none, never a larger one.
 *
 * Pure: the history goes in (`lib/promotions/history.ts` reads it), a decimal
 * string comes out. Money stays exact — minor units in a BigInt, as
 * everywhere in the shop — and is never a float.
 *
 * What counts as "the price the shop charged":
 *
 *  - The regular price. With a `retail_price_override` the shop charges that,
 *    whatever the source does, so it is the regular price throughout (the
 *    override's own history is not kept; it is taken as constant).
 *    Otherwise it is the source's price, which the sync records in
 *    `sync_changes`: the price at an instant is the `after` of the last change
 *    at or before it, or — before the first change we have — the `before` of
 *    the first one after it, or, for a product never changed, its current
 *    price. The prices in effect during the window are the one at its start
 *    and every price a change set within it.
 *  - Any other promotion that priced the product during the window. Its own
 *    history of prices is not reconstructed: the window's lowest regular price
 *    less that promotion's percentage is added as if it had been charged,
 *    which can only be lower than what was.
 */

/** The look-back the law sets. */
export const REFERENCE_WINDOW_DAYS = 30;
export const REFERENCE_WINDOW_MS = REFERENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** One change to the source's price, as `sync_changes` recorded it. */
export interface PriceChange {
  /** When the sync wrote it, in epoch milliseconds. */
  readonly at: number;
  /** `before.currentPrice`: null when the product had no price, or did not exist yet. */
  readonly before: string | null;
  /** `after.currentPrice`: null when the product has no price. */
  readonly after: string | null;
}

/** A stretch of time during which a promotion priced the product. */
export interface PromotionInterval {
  readonly percentOff: number;
  /** Inclusive, epoch milliseconds. */
  readonly from: number;
  /** Exclusive, epoch milliseconds. */
  readonly to: number;
}

export interface ReferenceInput {
  /** T: when the reduction began for the product, epoch milliseconds. */
  readonly referenceAt: number;
  /** The product's price changes, in the order they were made. */
  readonly changes: readonly PriceChange[];
  /** `products.current_price`, for a product the sync never changed. */
  readonly currentPrice: string | null;
  /** `products.retail_price_override`. */
  readonly override: string | null;
  /** Every other promotion's time on the product; those outside the window are ignored. */
  readonly earlier: readonly PromotionInterval[];
}

/** Exact cents, or null for an absent or unreadable price. */
export function toCents(amount: string | null | undefined): bigint | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const money = moneyFromDecimalString(amount, null);
  return money && money.minor >= 0n ? money.minor : null;
}

export function fromCents(cents: bigint): string {
  const whole = cents / 100n;
  const fraction = cents % 100n;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

/**
 * `percentOff` taken off `cents`, rounded down to the cent: what the price
 * layer charges (`retailPrice` in `lib/catalog/price-sql.ts`). 9.95 € at 10%
 * is 8.95 €, so the badge never reads one percent less than the owner chose.
 */
export function reducedCents(cents: bigint, percentOff: number): bigint {
  return (cents * BigInt(100 - percentOff)) / 100n;
}

/** The same, on decimal strings: "9.95", 10 → "8.95". Null in, null out. */
export function promotionPrice(regular: string | null, percentOff: number): string | null {
  const cents = toCents(regular);
  return cents === null ? null : fromCents(reducedCents(cents, percentOff));
}

/**
 * The regular prices in effect at some moment of the window `[start, end]`,
 * in cents. Changes must be in the order they were made.
 */
export function regularPricesInWindow(
  input: Pick<ReferenceInput, "changes" | "currentPrice" | "override">,
  start: number,
  end: number,
): bigint[] {
  const override = toCents(input.override);
  if (override !== null) return [override];

  const prices: bigint[] = [];
  const keep = (amount: string | null) => {
    const cents = toCents(amount);
    if (cents !== null) prices.push(cents);
  };

  if (input.changes.length === 0) {
    keep(input.currentPrice);
    return prices;
  }

  // The price at the window's start.
  let lastBefore: PriceChange | undefined;
  let firstAfter: PriceChange | undefined;
  for (const change of input.changes) {
    if (change.at <= start) lastBefore = change;
    else {
      firstAfter = change;
      break;
    }
  }
  if (lastBefore) keep(lastBefore.after);
  else if (firstAfter) keep(firstAfter.before);

  // And every price set within it.
  for (const change of input.changes) {
    if (change.at > start && change.at <= end) keep(change.after);
  }
  return prices;
}

/** Does `[from, to)` share any time with the window `[start, end]`? */
function overlaps(interval: PromotionInterval, start: number, end: number): boolean {
  return interval.from < interval.to && interval.from < end && interval.to > start;
}

/**
 * The 30-day lowest price for one product: a decimal string with two places,
 * or null when the product had no price at all in the window (there is then
 * nothing a reduction could be announced against).
 */
export function referencePrice(input: ReferenceInput): string | null {
  const end = input.referenceAt;
  const start = end - REFERENCE_WINDOW_MS;
  const regular = regularPricesInWindow(input, start, end);
  if (regular.length === 0) return null;

  let lowest = regular.reduce((low, cents) => (cents < low ? cents : low));
  const lowestRegular = lowest;
  for (const interval of input.earlier) {
    if (!overlaps(interval, start, end)) continue;
    const charged = reducedCents(lowestRegular, interval.percentOff);
    if (charged < lowest) lowest = charged;
  }
  return fromCents(lowest);
}

/** T: the promotion's start, or the moment the product joined a running one. */
export function referenceInstant(startsAt: Date, addedAt: Date): Date {
  return addedAt.getTime() > startsAt.getTime() ? addedAt : startsAt;
}
