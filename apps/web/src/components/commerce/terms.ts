import { moneyFromDecimalString } from "@catalog/shared";
import {
  WEEK_DAYS,
  siteConfig,
  type CommerceConfig,
  type DayRange,
  type OpeningHoursRange,
  type PaymentMethod,
  type WeekDay,
} from "@/config/site";
import { toPriceView } from "@/lib/catalog/format";
import type { PriceView } from "@/lib/catalog/types";

/**
 * The commercial terms, read.
 *
 * `siteConfig.commerce` is what the business has said; this module is the only
 * place that decides what may be printed from it. Every reader below returns
 * `null` (or an empty list) for a value that is unset *or unusable* — a
 * negative fee, a threshold of zero, a return window shorter than the law
 * allows — so a typo in the config removes a sentence instead of publishing a
 * wrong one.
 *
 * Every function takes the config as an argument, defaulting to the real one.
 * That is for the tests, which need to see each surface with a term set, unset
 * and unconfirmed, and it is why nothing here reads `siteConfig.commerce`
 * behind the caller's back.
 *
 * The sentences live here too, not in the components. The legal page, the
 * delivery page, the product block and the FAQ all state the same few facts;
 * built once, they cannot contradict each other.
 */

/**
 * The withdrawal period the law gives every distance sale (Consumer Protection
 * Act, art. 50; Directive 2011/83/EU, art. 9). It holds whether or not the
 * shop has configured anything, which is why the legal text falls back to it
 * rather than going silent.
 */
export const STATUTORY_WITHDRAWAL_DAYS = 14;

/* --- Money -------------------------------------------------------------- */

function configuredAmount(amount: string | null, allowZero: boolean): PriceView | null {
  if (amount === null) return null;
  const money = moneyFromDecimalString(amount, siteConfig.currency);
  if (!money || money.minor < 0n || (!allowZero && money.minor === 0n)) return null;
  return toPriceView(money.amount, siteConfig.currency);
}

/** The free-delivery threshold, or null when there is no such offer. */
export function freeDeliveryThreshold(
  commerce: CommerceConfig = siteConfig.commerce,
): PriceView | null {
  // A threshold of zero is "delivery is always free", which is a fee of zero —
  // a different statement, made by the other field.
  return configuredAmount(commerce.freeDeliveryThreshold, false);
}

/** The delivery fee when delivery is not free. Zero is a real answer. */
export function deliveryFee(commerce: CommerceConfig = siteConfig.commerce): PriceView | null {
  return configuredAmount(commerce.deliveryFee, true);
}

const isZero = (price: PriceView): boolean => /^0+\.0+$/.test(price.amount);

export type FreeDeliveryGap =
  | { readonly qualifies: true }
  | { readonly qualifies: false; readonly remaining: PriceView | null };

/**
 * How far one unit of a product is from free delivery.
 *
 * Integer arithmetic on minor units, like every other sum in the shop.
 *
 * The offer is for orders *above* the threshold, and whether an order of
 * exactly that amount counts is the shop's call, not ours. So the boundary is
 * read against the customer: exactly on the threshold does not qualify, and
 * there is no distance left to report either — `remaining` is null and the
 * page says nothing rather than "add 0,00 €".
 *
 * Null when there is nothing to compare: no threshold, no price, or a price in
 * another currency (the two numbers would not be the same kind of thing).
 */
export function freeDeliveryGap(
  price: Pick<PriceView, "amount" | "currency"> | null,
  commerce: CommerceConfig = siteConfig.commerce,
): FreeDeliveryGap | null {
  const threshold = freeDeliveryThreshold(commerce);
  if (!threshold || !price || price.currency !== threshold.currency) return null;

  const priceMoney = moneyFromDecimalString(price.amount, price.currency);
  const thresholdMoney = moneyFromDecimalString(threshold.amount, threshold.currency);
  if (!priceMoney || !thresholdMoney || priceMoney.minor < 0n) return null;

  if (priceMoney.minor > thresholdMoney.minor) return { qualifies: true };

  const missing = thresholdMoney.minor - priceMoney.minor;
  if (missing === 0n) return { qualifies: false, remaining: null };

  const whole = missing / 100n;
  const cents = (missing % 100n).toString().padStart(2, "0");
  return { qualifies: false, remaining: toPriceView(`${whole}.${cents}`, threshold.currency) };
}

/**
 * What delivering one unit of this product costs, when that can be stated as a
 * single number: nothing above the threshold, the fee otherwise. Null when the
 * answer depends on a value nobody has supplied.
 */
export function deliveryCostFor(
  price: Pick<PriceView, "amount" | "currency"> | null,
  commerce: CommerceConfig = siteConfig.commerce,
): PriceView | null {
  if (!price || price.currency !== siteConfig.currency) return null;
  if (freeDeliveryGap(price, commerce)?.qualifies) return toPriceView("0.00", siteConfig.currency);
  return deliveryFee(commerce);
}

/* --- Time --------------------------------------------------------------- */

function validRange(range: DayRange): boolean {
  return (
    Number.isInteger(range.min) &&
    Number.isInteger(range.max) &&
    range.min >= 0 &&
    range.max >= range.min
  );
}

/** Delivery time, or null unless both halves are present and make sense. */
export function deliveryTime(
  commerce: CommerceConfig = siteConfig.commerce,
): NonNullable<CommerceConfig["deliveryTime"]> | null {
  const time = commerce.deliveryTime;
  if (!time || !validRange(time.dispatch) || !validRange(time.transit)) return null;
  // A parcel that spends no time with the courier was not sent by courier.
  if (time.transit.max === 0) return null;
  return time;
}

const businessDays = (count: number): string =>
  count === 1 ? "1 работен ден" : `${count} работни дни`;

function formatDayRange(range: DayRange): string {
  return range.min === range.max
    ? businessDays(range.max)
    : `${range.min}–${businessDays(range.max)}`;
}

/* --- Payment ------------------------------------------------------------ */

export interface PaymentMethodView {
  readonly id: PaymentMethod;
  /** Short, for a list: "наложен платеж". */
  readonly label: string;
  /** Completes "Плащате …". */
  readonly phrase: string;
}

const PAYMENT_METHODS: Readonly<Record<PaymentMethod, Omit<PaymentMethodView, "id">>> = {
  cash_on_delivery: {
    label: "наложен платеж",
    phrase: "в брой при получаване на пратката (наложен платеж)",
  },
  card_on_delivery: {
    label: "карта при получаване",
    phrase: "с карта при получаване на пратката",
  },
  bank_transfer: {
    label: "банков превод",
    phrase: "предварително с банков превод",
  },
};

/** The accepted payment methods, in the configured order, without repeats. */
export function paymentMethods(
  commerce: CommerceConfig = siteConfig.commerce,
): readonly PaymentMethodView[] {
  const seen = new Set<string>();
  const views: PaymentMethodView[] = [];
  for (const id of commerce.paymentMethods) {
    const known = PAYMENT_METHODS[id] as (typeof PAYMENT_METHODS)[PaymentMethod] | undefined;
    if (!known || seen.has(id)) continue;
    seen.add(id);
    views.push({ id, ...known });
  }
  return views;
}

/* --- Returns ------------------------------------------------------------ */

/**
 * The return window the shop has configured, or null.
 *
 * Anything under the statutory minimum is treated as unset: a shorter period
 * is not a term the shop is allowed to offer, so it must not be printed.
 */
export function returnWindowDays(commerce: CommerceConfig = siteConfig.commerce): number | null {
  const days = commerce.returnWindowDays;
  if (days === null || !Number.isInteger(days) || days < STATUTORY_WITHDRAWAL_DAYS) return null;
  return days;
}

/**
 * The withdrawal period a customer actually has: the configured window, and
 * the statutory one when nothing usable is configured. Unlike the other
 * readers this never returns null, because the right exists by law whether or
 * not anyone filled in the config.
 */
export function withdrawalDays(commerce: CommerceConfig = siteConfig.commerce): number {
  return returnWindowDays(commerce) ?? STATUTORY_WITHDRAWAL_DAYS;
}

/* --- Opening hours ------------------------------------------------------ */

/** The days a range covers, Monday first. Empty for a range that runs backwards. */
export function daysInRange(range: Pick<OpeningHoursRange, "from" | "to">): readonly WeekDay[] {
  const from = WEEK_DAYS.indexOf(range.from);
  const to = WEEK_DAYS.indexOf(range.to);
  return from < 0 || to < from ? [] : WEEK_DAYS.slice(from, to + 1);
}

/* --- Sentences ---------------------------------------------------------- */

/** "a", "a и b", "a, b и c" — or with another conjunction. */
export function joinList(items: readonly string[], conjunction = "и"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

const ASK_ON_THE_CALL = "ви казваме по телефона, когато потвърждаваме поръчката";

/** What delivery costs, in as many sentences as the config can support. */
export function deliveryCostSentences(
  commerce: CommerceConfig = siteConfig.commerce,
): readonly string[] {
  const threshold = freeDeliveryThreshold(commerce);
  const fee = deliveryFee(commerce);

  if (fee && isZero(fee)) return ["Доставката е безплатна."];
  if (threshold) {
    return [
      `Доставката е безплатна за поръчки над ${threshold.formatted}.`,
      fee
        ? `За поръчки до тази сума доставката струва ${fee.formatted}.`
        : `За поръчки до тази сума цената на доставката ${ASK_ON_THE_CALL}.`,
    ];
  }
  return [fee ? `Доставката струва ${fee.formatted}.` : `Цената на доставката ${ASK_ON_THE_CALL}.`];
}

/** How long delivery takes, or null when that is not known. */
export function deliveryTimeSentence(
  commerce: CommerceConfig = siteConfig.commerce,
): string | null {
  const time = deliveryTime(commerce);
  if (!time) return null;

  const dispatch =
    time.dispatch.max === 0
      ? "в деня на потвърждаването"
      : `до ${businessDays(time.dispatch.max)} след потвърждаването`;
  return `Предаваме пратката на куриера ${dispatch}, а доставката отнема ${formatDayRange(time.transit)}.`;
}

/** Which couriers carry the parcels, or null when none is named. */
export function couriersSentence(commerce: CommerceConfig = siteConfig.commerce): string | null {
  const couriers = commerce.couriers.map((name) => name.trim()).filter(Boolean);
  return couriers.length > 0 ? `Пратките изпращаме с ${joinList(couriers)}.` : null;
}

/** How an order is paid for, or null when no method is configured. */
export function paymentSentence(commerce: CommerceConfig = siteConfig.commerce): string | null {
  const methods = paymentMethods(commerce);
  if (methods.length === 0) return null;
  return `Плащате ${joinList(
    methods.map((method) => method.phrase),
    "или",
  )}.`;
}

/** Who pays to send a return back, or null while that is undecided. */
export function returnShippingSentence(
  commerce: CommerceConfig = siteConfig.commerce,
): string | null {
  switch (commerce.returnShippingPaidBy) {
    case "merchant":
      return "Разходите за връщането на стоката са за наша сметка.";
    case "customer":
      return "Преките разходи за връщането на стоката са за ваша сметка.";
    default:
      return null;
  }
}

/* --- Short forms for the storefront ------------------------------------- */

/**
 * The announcement bar's promise, or null when there is none to make. The bar
 * exists to carry the free-delivery offer; without a threshold it has nothing
 * to announce and is not rendered at all.
 */
export function freeDeliveryPromise(commerce: CommerceConfig = siteConfig.commerce): string | null {
  const threshold = freeDeliveryThreshold(commerce);
  return threshold ? `Безплатна доставка за поръчки над ${threshold.formatted}` : null;
}

export interface ProductDeliveryLines {
  /** "Безплатна доставка за поръчки над 49,00 €", or null. */
  readonly promise: string | null;
  /** Where one unit of this product stands against the threshold, or null. */
  readonly standing: string | null;
  /** "Плащане: наложен платеж или банков превод", or null. */
  readonly payment: string | null;
}

/**
 * What the block beside the order form says for one product.
 *
 * `standing` reports a distance, not an instruction: "add 12,10 € more" would
 * promise free delivery at exactly the threshold, which the offer ("above")
 * does not say.
 */
export function productDeliveryLines(
  price: Pick<PriceView, "amount" | "currency"> | null,
  commerce: CommerceConfig = siteConfig.commerce,
): ProductDeliveryLines {
  const gap = freeDeliveryGap(price, commerce);
  const methods = paymentMethods(commerce);

  let standing: string | null = null;
  if (gap?.qualifies) {
    standing = "Един брой от този продукт вече е над тази сума.";
  } else if (gap?.remaining) {
    standing = `С един брой от този продукт до тази сума остават ${gap.remaining.formatted}.`;
  }

  return {
    promise: freeDeliveryPromise(commerce),
    standing,
    payment:
      methods.length > 0
        ? `Плащане: ${joinList(
            methods.map((method) => method.label),
            "или",
          )}`
        : null,
  };
}

/* --- Completeness ------------------------------------------------------- */

/**
 * The terms a customer must be able to read before ordering, and which are
 * still missing. `check:launch` prints these.
 *
 * Two fields are deliberately not on the list. A shop need not offer free
 * delivery at all, so an unset threshold is an answer, not a gap; and it need
 * not name its couriers. What it cannot leave open is what delivery costs, how
 * long it takes, how an order is paid for and how a return works.
 */
export function unsetTerms(commerce: CommerceConfig = siteConfig.commerce): readonly string[] {
  const missing: string[] = [];
  if (!deliveryFee(commerce)) {
    missing.push("commerce.deliveryFee — what delivery costs when it is not free");
  }
  if (!deliveryTime(commerce)) {
    missing.push("commerce.deliveryTime — days to dispatch and days in transit");
  }
  if (paymentMethods(commerce).length === 0) {
    missing.push("commerce.paymentMethods — how an order is paid for");
  }
  if (returnWindowDays(commerce) === null) {
    missing.push(
      `commerce.returnWindowDays — days to withdraw from an order (at least ${STATUTORY_WITHDRAWAL_DAYS})`,
    );
  }
  if (commerce.returnShippingPaidBy === null) {
    missing.push("commerce.returnShippingPaidBy — who pays to send a return back");
  }
  if (commerce.freeDeliveryThreshold !== null && !freeDeliveryThreshold(commerce)) {
    missing.push("commerce.freeDeliveryThreshold — set, but not a usable amount");
  }
  return missing;
}
