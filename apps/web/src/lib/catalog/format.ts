import { moneyFromDecimalString } from "@catalog/shared";
import { siteConfig } from "@/config/site";
import type { PriceView } from "./types";

/**
 * Money formatting.
 *
 * There is exactly one formatter in the application. Prices arrive from
 * PostgreSQL as exact decimal *strings* and stay strings all the way to the
 * DOM — they are never parsed into a JavaScript number, because
 * `Number("0.1") + Number("0.2")` is the classic way a shop starts charging
 * the wrong amount.
 */

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string, locale: string): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    // An unknown currency or locale must not take a page down.
    formatter = new Intl.NumberFormat("en", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  formatterCache.set(key, formatter);
  return formatter;
}

/**
 * Build a displayable price from a stored decimal string.
 *
 * `Intl.NumberFormat` needs a number, so the conversion happens exactly here,
 * at the last possible moment, purely for display. The authoritative `amount`
 * that travels with the view model remains the exact string.
 */
export function toPriceView(
  amount: string | null | undefined,
  currency: string | null | undefined,
  locale: string = siteConfig.locale,
): PriceView | null {
  if (amount === null || amount === undefined || amount === "") return null;

  const money = moneyFromDecimalString(amount, currency ?? siteConfig.currency);
  if (!money) return null;

  const resolvedCurrency = money.currency ?? siteConfig.currency;
  const asNumber = Number(money.amount);
  const formatted = Number.isFinite(asNumber)
    ? formatterFor(resolvedCurrency, locale).format(asNumber)
    : `${money.amount} ${resolvedCurrency}`;

  return { amount: money.amount, currency: resolvedCurrency, formatted };
}

/**
 * Discount percentage, computed with integer arithmetic on minor units.
 * Returns null unless the old price is genuinely higher.
 */
export function discountPercent(
  current: string | null | undefined,
  old: string | null | undefined,
): number | null {
  const currentMoney = current ? moneyFromDecimalString(current, "EUR") : null;
  const oldMoney = old ? moneyFromDecimalString(old, "EUR") : null;
  if (!currentMoney || !oldMoney) return null;
  if (oldMoney.minor <= currentMoney.minor || oldMoney.minor === 0n) return null;

  const saved = oldMoney.minor - currentMoney.minor;
  return Number((saved * 100n) / oldMoney.minor);
}

/** Short, human label for an availability state. */
export function availabilityLabel(availability: string): string {
  switch (availability) {
    case "in_stock":
      return "В наличност";
    case "out_of_stock":
      return "Изчерпан";
    case "preorder":
      return "Може да се поръча";
    default:
      return "Наличност при запитване";
  }
}

/** schema.org availability URL for structured data. */
export function availabilitySchemaUrl(availability: string): string {
  switch (availability) {
    case "in_stock":
      return "https://schema.org/InStock";
    case "out_of_stock":
      return "https://schema.org/OutOfStock";
    case "preorder":
      return "https://schema.org/PreOrder";
    default:
      return "https://schema.org/LimitedAvailability";
  }
}

/**
 * Price per cup, formatted.
 *
 * Kept at four decimals internally so the cheapest products sort against each
 * other correctly, and rounded to the customary two only here, at the last
 * moment, exactly like every other price in the shop.
 *
 * The label always says "на чаша" because the number is meaningless without
 * it, and an estimated figure says so: for ground coffee the number of cups in
 * a bag depends on the machine and the drinker, not on the bag.
 */
export function toPerServingView(
  pricePerServing: string | null | undefined,
  currency: string | null | undefined,
  options: { readonly estimated?: boolean } = {},
): { readonly formatted: string; readonly estimated: boolean } | null {
  const price = toPriceView(pricePerServing, currency);
  if (!price) return null;

  const estimated = options.estimated === true;
  return {
    formatted: `${estimated ? "≈ " : ""}${price.formatted} на чаша`,
    estimated,
  };
}

/**
 * Bulgarian plural for a counted noun.
 *
 * "1 продукта" is wrong in a way that makes a page look machine-generated, and
 * Bulgarian splits on one versus many rather than on the English rule, so
 * `count === 1` is the whole decision.
 */
export function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
