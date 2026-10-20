import { moneyFromDecimalString } from "@catalog/shared";
import { sofiaDaysBefore } from "./days";

/**
 * The price a reduction is announced against: the lowest price the shop
 * charged for the product in the 30 days before the reduction began for it.
 *
 * This is the legally sensitive part of a promotion. Directive 98/6/EC,
 * Art. 6a (the "Omnibus" rule, in the Bulgarian Consumer Protection Act since
 * 2022) says an announced reduction must show "the prior price": the lowest
 * price applied during at least 30 days before the reduction. A struck price
 * above that is a false claim, so wherever the history is uncertain this
 * module errs low — a smaller badge, or none — and where there is no history
 * to vouch for a price, it claims nothing at all (`null`: the shop then sells
 * at the promotion's price with no struck price and no badge,
 * `lib/catalog/price-sql.ts`).
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
 *    `sync_changes` — but only in the changes that carry it: a change
 *    recorded for something else (`catalog:link` moving a product writes
 *    `{ name, sourceKey, … }` and no price) says nothing about the price and
 *    is passed over. The price at an instant is the `after` of the last
 *    change at or before it that carries one, or — before the first such —
 *    the `before` of the first change after it that carries one, or, for a
 *    product never priced by a change, its current price. The prices in
 *    effect during the window are the one at its start and every price a
 *    change set within it.
 *  - Any other promotion that priced the product during the window. Its own
 *    history of prices is not reconstructed: the window's lowest regular price
 *    less that promotion's percentage is added as if it had been charged,
 *    which can only be lower than what was.
 *
 * And no claim without the whole window: a product the shop has had for less
 * than 30 days, or one that had no price when the window opened, has no
 * 30-day lowest price, so its reference is null.
 *
 * The window is 30 calendar days on Sofia's clock (`sofiaDaysBefore`), not
 * 720 hours: across the October change it is an hour longer.
 */

/** The look-back the law sets, in days. */
export const REFERENCE_WINDOW_DAYS = 30;

/** When the window ending at `referenceAt` opens: the same Sofia time, 30 days earlier. */
export function referenceWindowStart(referenceAt: number): number {
  return sofiaDaysBefore(referenceAt, REFERENCE_WINDOW_DAYS).getTime();
}

/** One change the sync recorded, as far as the price goes. */
export interface PriceChange {
  /** When the sync wrote it, in epoch milliseconds. */
  readonly at: number;
  /**
   * `before.currentPrice`: a price, null for "no price", or absent
   * (`undefined`) when that side of the change does not carry the price.
   */
  readonly before?: string | null;
  /** `after.currentPrice`, likewise. */
  readonly after?: string | null;
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
  /** The product's changes, in the order they were made. */
  readonly changes: readonly PriceChange[];
  /** `products.current_price`, for a product no change ever priced. */
  readonly currentPrice: string | null;
  /** `products.retail_price_override`. */
  readonly override: string | null;
  /** `products.first_seen_at`, epoch milliseconds: when the shop first had it. */
  readonly firstSeenAt: number | null;
  /** Every other promotion's time on the product; those outside the window are ignored. */
  readonly earlier: readonly PromotionInterval[];
}

/** Why a reference is what it is. */
export type ReferenceOutcome =
  | { readonly price: string; readonly reason: "ok" }
  /** The shop has had the product for less than the window. */
  | { readonly price: null; readonly reason: "new" }
  /** It had no price when the window opened, or none at all. */
  | { readonly price: null; readonly reason: "noPrice" };

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
 * The regular prices of `[start, end]`, in cents: the one in effect at
 * `start` (null when there was none, or nothing says what it was), and every
 * price set after it, up to `end`. Changes must be in the order they were
 * made; those that do not carry the price are passed over.
 */
export function regularPricesInWindow(
  input: Pick<ReferenceInput, "changes" | "currentPrice" | "override">,
  start: number,
  end: number,
): { readonly atStart: bigint | null; readonly within: readonly bigint[] } {
  const override = toCents(input.override);
  if (override !== null) return { atStart: override, within: [] };

  let opening: PriceChange | undefined;
  let firstAfter: PriceChange | undefined;
  for (const change of input.changes) {
    if (change.at <= start) {
      if (change.after !== undefined) opening = change;
    } else if (change.before !== undefined) {
      firstAfter = change;
      break;
    }
  }
  const atStart = opening
    ? toCents(opening.after)
    : firstAfter
      ? toCents(firstAfter.before)
      : toCents(input.currentPrice);

  const within: bigint[] = [];
  for (const change of input.changes) {
    if (change.at > start && change.at <= end && change.after !== undefined) {
      const cents = toCents(change.after);
      if (cents !== null) within.push(cents);
    }
  }
  return { atStart, within };
}

/** Does `[from, to)` share any time with `[start, end]`, up to but not at `end`? */
function overlaps(interval: PromotionInterval, start: number, end: number): boolean {
  return interval.from < interval.to && interval.from < end && interval.to > start;
}

const lowestOf = (values: readonly bigint[]): bigint =>
  values.reduce((low, cents) => (cents < low ? cents : low));

/** The 30-day lowest price for one product, and why it is that, or why there is none. */
export function referenceOutcome(input: ReferenceInput): ReferenceOutcome {
  const end = input.referenceAt;
  const start = referenceWindowStart(end);
  if (input.firstSeenAt !== null && input.firstSeenAt > start)
    return { price: null, reason: "new" };

  const { atStart, within } = regularPricesInWindow(input, start, end);
  if (atStart === null) return { price: null, reason: "noPrice" };

  const lowestRegular = lowestOf([atStart, ...within]);
  let lowest = lowestRegular;
  for (const interval of input.earlier) {
    if (!overlaps(interval, start, end)) continue;
    const charged = reducedCents(lowestRegular, interval.percentOff);
    if (charged < lowest) lowest = charged;
  }
  return { price: fromCents(lowest), reason: "ok" };
}

/** The 30-day lowest price for one product, or null when nothing vouches for one. */
export function referencePrice(input: ReferenceInput): string | null {
  return referenceOutcome(input).price;
}

/**
 * How low a settled reference must come, once its promotion has run a while:
 * the lowest price the shop charged for the product under another promotion
 * since T, or null when there was none.
 *
 * A settled reference never rises, but the shop's own later prices can make
 * it untrue. A product in this promotion at 10% that a 30% promotion took
 * over for a week was sold at the deeper price; when the 30% one ends and
 * this one prices it again, "10% off" against the price before both would be
 * a claim against a price that is no longer the lowest of the last 30 days.
 *
 * Only a promotion with a larger percentage counts: while this one ran, the
 * shop charged the larger reduction, so a smaller or equal one never set a
 * price below this one's. As for earlier promotions, its price is taken as
 * the lowest regular price since T less its percentage.
 */
export function settledReferenceFloor(input: {
  readonly referenceAt: number;
  readonly now: number;
  readonly percentOff: number;
  readonly changes: readonly PriceChange[];
  readonly currentPrice: string | null;
  readonly override: string | null;
  readonly others: readonly PromotionInterval[];
}): bigint | null {
  const deeper = input.others.filter(
    (interval) =>
      interval.percentOff > input.percentOff && overlaps(interval, input.referenceAt, input.now),
  );
  if (deeper.length === 0) return null;
  const { atStart, within } = regularPricesInWindow(input, input.referenceAt, input.now);
  const prices = [...(atStart === null ? [] : [atStart]), ...within];
  if (prices.length === 0) return null;
  const lowestRegular = lowestOf(prices);
  return lowestOf(deeper.map((interval) => reducedCents(lowestRegular, interval.percentOff)));
}

/** T: the promotion's start, or the moment the product joined a running one. */
export function referenceInstant(startsAt: Date, addedAt: Date): Date {
  return addedAt.getTime() > startsAt.getTime() ? addedAt : startsAt;
}
