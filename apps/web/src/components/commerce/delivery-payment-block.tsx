import Link from "next/link";
import type { ReactNode } from "react";
import { siteConfig, type CommerceConfig } from "@/config/site";
import {
  deliveryCostSentences,
  deliveryFee,
  deliveryTimeSentence,
  joinList,
  paymentMethods,
  productDeliveryLines,
  returnShippingSentence,
  returnWindowDays,
} from "@/components/commerce/terms";
import type { PriceView } from "@/lib/catalog/types";
import type { Locale } from "@/i18n/config";
import { href, routes } from "@/lib/routes";

/**
 * Delivery and payment, inside the order panel.
 *
 * The form asks for a phone number, and the questions a customer has before
 * giving one are "what will delivery cost me", "when", "how do I pay" and "can
 * I send it back". This answers them for this product: when the price is known
 * the delivery row says where one unit stands against the free-delivery
 * threshold, computed exactly.
 *
 * Specified in DESIGN.md, "Product page" → "Order panel". It is the panel's
 * second column from `sm` up and its first block on a phone, so the terms are
 * read before the number is typed and without scrolling past the form.
 *
 * Every row is a term the business has set. A row with nothing set is left
 * out — "we will tell you on the phone" is not a term — and with no row at all
 * the block renders nothing; `deliveryPaymentRows` lets the page know, so the
 * form can take the full width.
 */

type RowKey = "delivery" | "time" | "payment" | "returns";

export interface DeliveryPaymentRow {
  readonly key: RowKey;
  readonly term: string;
  /** One or more complete sentences. */
  readonly lines: readonly string[];
}

const upperFirst = (text: string): string => text.charAt(0).toLocaleUpperCase("bg") + text.slice(1);

/** The rows the block shows for one product, in order. Empty when nothing is set. */
export function deliveryPaymentRows(
  price: Pick<PriceView, "amount" | "currency"> | null,
  commerce: CommerceConfig = siteConfig.commerce,
): readonly DeliveryPaymentRow[] {
  const lines = productDeliveryLines(price, commerce);
  const rows: DeliveryPaymentRow[] = [];

  /*
   * With a fee configured, the full cost sentences are all figures. Without
   * one they end in "we tell you on the call", which is the absence of a term,
   * so only the free-delivery promise — when there is one — is printed.
   */
  const cost = deliveryFee(commerce)
    ? [...deliveryCostSentences(commerce)]
    : lines.promise
      ? [`${lines.promise}.`]
      : [];
  if (cost.length > 0) {
    rows.push({
      key: "delivery",
      term: "Доставка",
      lines: lines.standing ? [...cost, lines.standing] : cost,
    });
  }

  const time = deliveryTimeSentence(commerce);
  if (time) rows.push({ key: "time", term: "Срок", lines: [time] });

  const methods = paymentMethods(commerce);
  if (methods.length > 0) {
    rows.push({
      key: "payment",
      term: "Плащане",
      lines: [
        `${upperFirst(
          joinList(
            methods.map((method) => method.label),
            "или",
          ),
        )}.`,
      ],
    });
  }

  const days = returnWindowDays(commerce);
  if (days !== null) {
    const shipping = returnShippingSentence(commerce);
    rows.push({
      key: "returns",
      term: "Връщане",
      lines: [`${days} дни за отказ след получаването.`, ...(shipping ? [shipping] : [])],
    });
  }

  return rows;
}

/* 16 px line icons on a 16 px grid, in `currentColor`. Decorative: the term
   beside each one is the label. */
const ICONS: Record<RowKey, ReactNode> = {
  delivery: (
    <>
      <path d="M1.5 4h8v7h-8z" />
      <path d="M9.5 6.5h2.75L14.5 9v2h-5" />
      <circle cx="4.5" cy="12" r="1.25" />
      <circle cx="11.5" cy="12" r="1.25" />
    </>
  ),
  time: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.25 1.5" />
    </>
  ),
  payment: (
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1" />
      <path d="M1.5 6.5h13M4 10h2.5" />
    </>
  ),
  returns: (
    <>
      <path d="M5.5 3 2.5 6l3 3" />
      <path d="M2.5 6h7a4 4 0 0 1 0 8H6" />
    </>
  ),
};

function RowIcon({ name }: { name: RowKey }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0 text-pine-700"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

export function DeliveryPaymentBlock({
  locale,
  price,
  commerce = siteConfig.commerce,
  className,
}: {
  locale: Locale;
  price: PriceView | null;
  commerce?: CommerceConfig;
  /** Placement inside the order panel: which edge carries the divider. */
  className?: string;
}) {
  const rows = deliveryPaymentRows(price, commerce);
  if (rows.length === 0) return null;

  return (
    <aside
      aria-label="Доставка и плащане"
      className={["bg-paper-sunken p-4 sm:p-5", className].filter(Boolean).join(" ")}
    >
      <dl className="space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className="flex items-center gap-2 font-semibold text-ink-900">
              <RowIcon name={row.key} />
              {row.term}
            </dt>
            {/* Indented by the icon and its gap, so values align under terms. */}
            <dd className="mt-0.5 pl-6 text-ink-700">{row.lines.join(" ")}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm">
        <Link
          href={href(locale, routes.delivery)}
          className="inline-flex min-h-6 items-center text-pine-700 underline underline-offset-2 hover:no-underline"
        >
          Доставка и плащане
        </Link>
      </p>
    </aside>
  );
}
