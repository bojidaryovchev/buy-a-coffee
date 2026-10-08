import Link from "next/link";
import { siteConfig, type CommerceConfig } from "@/config/site";
import { productDeliveryLines } from "@/components/commerce/terms";
import type { PriceView } from "@/lib/catalog/types";

/**
 * Delivery and payment, beside the order form.
 *
 * The form asks for a phone number, and the two questions a customer has
 * before giving one are "what will delivery cost me" and "how do I pay". This
 * answers both in three lines, for this product: when the price is known it
 * says where one unit stands against the free-delivery threshold, computed
 * exactly.
 *
 * Deliberately not a heading and not a table — a short list, compact enough to
 * sit above the form on a phone without pushing the form off the screen.
 * Renders nothing when neither a threshold nor a payment method is configured;
 * the form's own copy already says delivery is arranged on the call.
 */
export function DeliveryPaymentBlock({
  price,
  commerce = siteConfig.commerce,
}: {
  price: PriceView | null;
  commerce?: CommerceConfig;
}) {
  const lines = productDeliveryLines(price, commerce);
  if (!lines.promise && !lines.payment) return null;

  return (
    <aside
      aria-label="Доставка и плащане"
      className="mb-3 rounded-md border border-line bg-paper-sunken px-4 py-3 text-sm text-ink-700"
    >
      <ul className="space-y-1">
        {lines.promise && (
          <li>
            <strong className="font-semibold text-ink-900">{lines.promise}.</strong>
            {lines.standing && <> {lines.standing}</>}
          </li>
        )}
        {lines.payment && <li>{lines.payment}.</li>}
        <li>
          Доставката уговаряме по телефона, когато ви се обадим за потвърждение.{" "}
          <Link
            href="/delivery"
            className="font-medium whitespace-nowrap text-pine-700 underline underline-offset-2 hover:no-underline"
          >
            Доставка и плащане
          </Link>
        </li>
      </ul>
    </aside>
  );
}
