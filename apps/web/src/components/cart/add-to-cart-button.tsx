"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAnalytics } from "@/components/analytics-provider";
import { CartIcon } from "@/components/layout/icons";
import { buttonClasses } from "@/components/ui/primitives";
import { useLocale } from "@/i18n/use-locale";
import { cartStore, useHydrated } from "@/lib/cart/store";
import { prepareBeanFlight } from "@/lib/motion/bean-flight";
import { productHref } from "@/lib/routes";

/**
 * „Добави“ on a product card: one unit of the product into the cart.
 *
 * A link until the page is hydrated, a button after. The cart lives in the
 * browser and needs JavaScript; without it — or in the moment before it runs —
 * the control is the link the card's quick order always was, to the order panel
 * on the product page (`#order`), where the phone form works with no script at
 * all. With JavaScript it is a real `<button>`, announced as one, and a press
 * adds to the cart without leaving the listing. The two are drawn with the same
 * classes, so nothing moves when one becomes the other.
 *
 * The label is „Добави“ with a cart beside it: on a wide card the button sits
 * beside the price, where the long label would push it to its own line. The
 * accessible name is always the long one, with the product's name after it.
 *
 * A press sends a bean from the button to the header's cart
 * (`prepareBeanFlight`), measured before the cart changes and flown after.
 *
 * It is a sibling of the card's product link, never a descendant, for the
 * reason `ProductCard` gives.
 */
export function AddToCartButton({
  productId,
  slug,
  name,
  className,
}: {
  readonly productId: string;
  readonly slug: string;
  /** The product's whole name: read after the label, and shown in the notice. */
  readonly name: string;
  readonly className?: string;
}) {
  const hydrated = useHydrated();
  const locale = useLocale();
  const analytics = useAnalytics();
  const classes = buttonClasses({ variant: "secondary", size: "sm", className });

  const label: ReactNode = (
    <>
      <CartIcon className="h-4 w-4" />
      <span aria-hidden>Добави</span>
      <span className="sr-only">Добави в количката: {name}</span>
    </>
  );

  if (!hydrated) {
    return (
      <Link
        href={productHref(locale, { slug }, "#order")}
        // The name link above already prefetches this product's page.
        prefetch={false}
        className={classes}
      >
        {label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      onClick={(event) => {
        const launch = prepareBeanFlight(event.currentTarget);
        const { added } = cartStore.add({ productId, slug, name }, 1);
        if (added) {
          launch?.();
          analytics.track({ name: "add_to_cart", productSlug: slug, quantity: 1, source: "card" });
        }
      }}
    >
      {label}
    </button>
  );
}
