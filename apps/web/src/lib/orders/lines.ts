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

export interface OrderLine {
  /** Whatever name the reader of this sum should see. */
  readonly name: string;
  readonly quantity: number;
  /** Null when the product's price is said on the call. */
  readonly unitPrice: Pick<PriceView, "amount" | "currency"> | null;
}

export interface OrderSum {
  /** The priced lines, added up. Null when no line has a price. */
  readonly subtotal: PriceView | null;
  /** How many lines are left out of `subtotal` because they have no price. */
  readonly unpriced: number;
  /** Units across every line, priced or not. */
  readonly units: number;
}

/** A line as it is stored (`order_inquiry_items`), as a sum line under `name`. */
export function storedLine(
  item: {
    readonly quantity: number;
    readonly unitPrice: string | null;
    readonly currency: string | null;
  },
  name: string,
): OrderLine {
  return {
    name,
    quantity: item.quantity,
    unitPrice:
      item.unitPrice !== null && item.currency !== null
        ? { amount: item.unitPrice, currency: item.currency }
        : null,
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

/** "1 продукт" / "3 продукта". */
export function productCount(count: number): string {
  return count === 1 ? "1 продукт" : `${count} продукта`;
}

/**
 * The lines as text, one per line, for a plain-text message:
 * "2 × Lavazza Super Crema — 19,90 € за брой, 39,80 €", or "… — цена при
 * запитване". Then the sum, saying what it leaves out.
 */
export function orderLinesText(lines: readonly OrderLine[]): string[] {
  const rows = lines.map((line) => {
    const total = lineTotal(line.unitPrice, line.quantity);
    const unit = line.unitPrice
      ? toPriceView(line.unitPrice.amount, line.unitPrice.currency)
      : null;
    if (!total || !unit) return `${line.quantity} × ${line.name} — цена при запитване`;
    return line.quantity === 1
      ? `${line.quantity} × ${line.name} — ${total.formatted}`
      : `${line.quantity} × ${line.name} — ${unit.formatted} за брой, ${total.formatted}`;
  });
  return [...rows, "", sumSentence(orderSum(lines))];
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
