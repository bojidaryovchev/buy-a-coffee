import { moneyFromDecimalString } from "@catalog/shared";
import { siteConfig } from "@/config/site";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { toPriceView } from "@/lib/catalog/format";
import type { PriceView } from "@/lib/catalog/types";

/**
 * The lines of an order and what they add up to.
 *
 * One implementation for every place a sum is shown: the cart page while the
 * customer is choosing, the mail to the shop and the mail to the customer, and
 * the order in the panel. Integer arithmetic on minor units, like every other
 * sum in the shop (`terms.ts`); prices stay exact decimal strings until they
 * are formatted.
 *
 * A line with no price ("Цена при запитване") is not a line worth nothing. It
 * is left out of the sum and counted, so every place that prints a sum can say
 * that it is a sum of the priced lines only — never present a partial figure
 * as the whole.
 *
 * Client-safe: the cart page adds up in the browser what the server priced.
 */

type Money = Pick<PriceView, "amount" | "currency">;

export interface OrderLine {
  /** Whatever name the reader of this sum should see. */
  readonly name: string;
  readonly quantity: number;
  /** Null when the product's price is said on the call. */
  readonly unitPrice: Money | null;
  /** Set when the line was reduced, as this line's reader is told it. */
  readonly reduction?: LineReduction;
}

/**
 * What a line's price was reduced from, worded for one of two readers.
 *
 *  - The **customer** is told what the shop showed them: the struck price
 *    beside the price and the badge's percentage — under a promotion, the
 *    lowest price of the 30 days before it, which is the only "before" the
 *    shop may announce. A line the page showed no reduction for carries none.
 *  - The **owner** is told what the promotion took off: the regular price,
 *    the promotion's own percentage and the name the owner gave it, so the
 *    margin given away can be read off the order. Never sent to a customer.
 */
export type LineReduction =
  | {
      readonly reader: "customer";
      /** The struck price, per unit. */
      readonly before: Money;
      /** The badge's figure; null when it rounded under one percent. */
      readonly percent: number | null;
    }
  | {
      readonly reader: "owner";
      /** The regular price, per unit: what the shop charges without the promotion. */
      readonly before: Money;
      readonly percent: number;
      /** The owner's own name for the promotion, as it was when the order came in. */
      readonly promotionName: string | null;
    };

export interface OrderSum {
  /** The priced lines, added up. Null when no line has a price. */
  readonly subtotal: PriceView | null;
  /** How many lines are left out of `subtotal` because they have no price. */
  readonly unpriced: number;
  /** Units across every line, priced or not. */
  readonly units: number;
}

/**
 * A line as it is stored (`order_inquiry_items`), as a sum line under `name`.
 *
 * A stored line is the owner's record, so the reduction it carries is the
 * owner's: the regular price, the promotion's percentage and its name, from
 * the snapshot taken when the order came in (`itemFor`). A line stored before
 * promotions existed, or that no promotion priced, has none.
 */
export function storedLine(
  item: {
    readonly quantity: number;
    readonly unitPrice: string | null;
    readonly currency: string | null;
    readonly regularUnitPrice?: string | null;
    readonly discountPercent?: number | null;
    readonly promotionName?: string | null;
  },
  name: string,
): OrderLine {
  const { unitPrice, currency, regularUnitPrice = null, discountPercent = null } = item;
  if (unitPrice === null || currency === null) {
    return { name, quantity: item.quantity, unitPrice: null };
  }
  const line: OrderLine = {
    name,
    quantity: item.quantity,
    unitPrice: { amount: unitPrice, currency },
  };
  if (regularUnitPrice === null || discountPercent === null) return line;
  return {
    ...line,
    reduction: {
      reader: "owner",
      before: { amount: regularUnitPrice, currency },
      percent: discountPercent,
      promotionName: item.promotionName ?? null,
    },
  };
}

/** Minor units as the decimal string `toPriceView` takes. */
function decimalOf(minor: bigint): string {
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}

/** The minor units of one unit price, or null when it is not a usable shop price. */
function unitMinor(price: OrderLine["unitPrice"]): bigint | null {
  // A price in another currency is not a price this sum can add.
  if (!price || price.currency !== siteConfig.currency) return null;
  const money = moneyFromDecimalString(price.amount, price.currency);
  return money && money.minor >= 0n ? money.minor : null;
}

/** What one line costs: the unit price times the quantity. Null without a price. */
export function lineTotal(
  unitPrice: OrderLine["unitPrice"],
  quantity: number,
  locale: Locale = DEFAULT_LOCALE,
): PriceView | null {
  const minor = unitMinor(unitPrice);
  if (minor === null || !Number.isInteger(quantity) || quantity < 0) return null;
  return toPriceView(decimalOf(minor * BigInt(quantity)), siteConfig.currency, locale);
}

export function orderSum(lines: readonly OrderLine[], locale: Locale = DEFAULT_LOCALE): OrderSum {
  let total = 0n;
  let priced = 0;
  let unpriced = 0;
  let units = 0;
  for (const line of lines) {
    units += line.quantity;
    const minor = unitMinor(line.unitPrice);
    if (minor === null) {
      unpriced += 1;
      continue;
    }
    total += minor * BigInt(line.quantity);
    priced += 1;
  }
  return {
    subtotal: priced > 0 ? toPriceView(decimalOf(total), siteConfig.currency, locale) : null,
    unpriced,
    units,
  };
}

/**
 * What the reductions took off, line by line and added up: each reduced
 * line's price before, less its price, times its quantity. Null when nothing
 * was reduced.
 *
 * For the customer that is what the cart and the confirmation call
 * „Спестявате“, against the struck prices the shop showed; for the owner,
 * against the regular prices, what the promotions cost the margin. Exact, in
 * minor units, like the sum; a line whose two prices are not both shop prices
 * adds nothing, and neither does one whose price "before" is not above it.
 */
export function orderSavings(
  lines: readonly OrderLine[],
  locale: Locale = DEFAULT_LOCALE,
): PriceView | null {
  let saved = 0n;
  for (const line of lines) {
    if (!line.reduction || !Number.isInteger(line.quantity) || line.quantity < 0) continue;
    const now = unitMinor(line.unitPrice);
    const before = unitMinor(line.reduction.before);
    if (now === null || before === null || before <= now) continue;
    saved += (before - now) * BigInt(line.quantity);
  }
  return saved > 0n ? toPriceView(decimalOf(saved), siteConfig.currency, locale) : null;
}

/**
 * A reduced line's note, for its reader: "вместо 9,95 €, −10%" for the
 * customer; "−10% · Есенна кампания, редовна 9,95 €" for the owner. Null for
 * a line with no reduction.
 */
export function reductionNote(line: OrderLine): string | null {
  const reduction = line.reduction;
  if (!reduction) return null;
  const before = toPriceView(reduction.before.amount, reduction.before.currency);
  if (!before) return null;
  if (reduction.reader === "customer") {
    return reduction.percent === null
      ? `вместо ${before.formatted}`
      : `вместо ${before.formatted}, −${reduction.percent}%`;
  }
  const promotion = reduction.promotionName
    ? `−${reduction.percent}% · ${reduction.promotionName}`
    : `−${reduction.percent}%`;
  return `${promotion}, редовна ${before.formatted}`;
}

/**
 * The saving, as its reader is told it: "Спестявате 2,00 €" to the
 * customer, "Отстъпка по промоции: 2,00 €" to the owner. Null when there is
 * none. The lines of one list are all for one reader.
 */
export function savingsSentence(lines: readonly OrderLine[]): string | null {
  const saved = orderSavings(lines);
  if (!saved) return null;
  const owner = lines.some((line) => line.reduction?.reader === "owner");
  return owner ? `Отстъпка по промоции: ${saved.formatted}` : `Спестявате ${saved.formatted}`;
}

/** "1 продукт" / "3 продукта". */
export function productCount(count: number): string {
  return count === 1 ? "1 продукт" : `${count} продукта`;
}

/**
 * The lines as text, one per line, for a plain-text message:
 * "2 × Lavazza Super Crema — 19,90 € за брой, 39,80 €", or "… — цена при
 * запитване", with a reduced line's note after its unit price in brackets.
 * Then the sum, saying what it leaves out, and what the reductions took off.
 */
export function orderLinesText(lines: readonly OrderLine[]): string[] {
  const rows = lines.map((line) => {
    const total = lineTotal(line.unitPrice, line.quantity);
    const unit = line.unitPrice
      ? toPriceView(line.unitPrice.amount, line.unitPrice.currency)
      : null;
    if (!total || !unit) return `${line.quantity} × ${line.name} — цена при запитване`;
    const note = reductionNote(line);
    const noted = note ? ` (${note})` : "";
    return line.quantity === 1
      ? `${line.quantity} × ${line.name} — ${total.formatted}${noted}`
      : `${line.quantity} × ${line.name} — ${unit.formatted} за брой${noted}, ${total.formatted}`;
  });
  const saved = savingsSentence(lines);
  return [...rows, "", sumSentence(orderSum(lines)), ...(saved ? [saved] : [])];
}

/**
 * "Сума на продуктите: 39,80 €", with what it does not include. Worded for
 * either reader, the shop or the customer: both mails print it.
 */
export function sumSentence(sum: OrderSum): string {
  if (!sum.subtotal) return "Всички продукти са с цена при запитване.";
  if (sum.unpriced === 0) return `Сума на продуктите: ${sum.subtotal.formatted}`;
  return `Сума на продуктите: ${sum.subtotal.formatted}, без ${productCount(sum.unpriced)} с цена при запитване`;
}
