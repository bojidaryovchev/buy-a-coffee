"use client";

import Link from "next/link";
import { CartIcon } from "@/components/layout/icons";
import { cx } from "@/components/ui/primitives";
import { fill, plural } from "@/i18n/fill";
import { cartUnits } from "@/lib/cart/cart";
import { useCart } from "@/lib/cart/store";

/**
 * The cart in the header: an icon, and how many units are in it.
 *
 * A link to the cart page, always — with an empty cart too, where the page says
 * so and points back to the shelves. The count is the browser's and is not
 * known on the server, so the page is sent without it and the badge appears
 * once the cart is read. It sits over the icon's corner, outside the flow, so
 * its arrival moves nothing. Squared like every badge here (DESIGN.md, "Shape":
 * nothing is circular), pine with paper text, the primary button's pairing.
 *
 * The words come from the frame's dictionary and are passed in: this is a
 * client component and the dictionaries stay on the server.
 */
export function CartLink({
  href,
  label,
  count,
  className,
}: {
  readonly href: string;
  /** "Количка". */
  readonly label: string;
  /** "{count} брой" / "{count} броя", read after the label. */
  readonly count: { readonly one: string; readonly many: string };
  readonly className?: string;
}) {
  const { lines } = useCart();
  const units = cartUnits(lines);

  return (
    <Link
      href={href}
      className={cx(
        "relative inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-sm text-ink-700 transition-colors hover:bg-paper-sunken hover:text-ink-900",
        className,
      )}
    >
      <CartIcon />
      <span className="sr-only">
        {label}
        {units > 0 && `, ${fill(plural(count, units), { count: units })}`}
      </span>
      {units > 0 && (
        <span
          aria-hidden
          className="absolute top-0.5 right-0 min-w-5 rounded-xs bg-pine-900 px-1 text-center text-2xs leading-5 font-semibold text-paper tabular-nums"
        >
          {units > 99 ? "99+" : units}
        </span>
      )}
    </Link>
  );
}
