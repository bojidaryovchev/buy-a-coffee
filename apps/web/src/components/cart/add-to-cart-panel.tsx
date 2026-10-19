"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useAnalytics } from "@/components/analytics-provider";
import { QuantityStepper } from "@/components/cart/quantity-stepper";
import { CartIcon } from "@/components/layout/icons";
import { Button } from "@/components/ui/primitives";
import { useLocale } from "@/i18n/use-locale";
import { cartStore, useCart } from "@/lib/cart/store";
import { href, routes } from "@/lib/routes";

/**
 * The cart, on a product page: how many, and „Добави в количката“.
 *
 * The page's one gold button, above the quick order. Adding does not leave the
 * page: the notice says it was added and offers the cart, and the line under
 * the button says how many of this product the cart now holds, so a second
 * press is a deliberate „one more“ and not an accident nobody sees.
 *
 * **Not drawn without JavaScript** (`noscript:hidden`, which is
 * `@media (scripting: none)`). A cart in the browser cannot work without a
 * script, and a stepper and a button that do nothing would be worse than none;
 * the quick order below is a plain form and is the whole order panel then. With
 * JavaScript it is in the server's HTML from the start, so the form below it
 * does not move when the page hydrates. The line under the button keeps its
 * height empty or full, for the same reason.
 */
export function AddToCartPanel({
  productId,
  slug,
  name,
}: {
  readonly productId: string;
  readonly slug: string;
  readonly name: string;
}) {
  const [quantity, setQuantity] = useState(1);
  const { lines } = useCart();
  const locale = useLocale();
  const analytics = useAnalytics();
  const statusId = useId();
  const inCart = lines.find((line) => line.productId === productId)?.quantity ?? 0;

  return (
    <div className="noscript:hidden">
      <p className="font-display text-base font-semibold text-ink-900">Добавете в количката</p>
      <p className="mt-1 text-sm text-ink-500">
        Съберете всичко, което искате, и изпратете една заявка. Ще ви се обадим веднъж, за цялата
        поръчка.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium text-ink-900" aria-hidden>
          Количество
        </span>
        <QuantityStepper value={quantity} onChange={setQuantity} label="Количество" />
      </div>

      <Button
        type="button"
        variant="accent"
        size="lg"
        className="mt-3 w-full"
        aria-describedby={statusId}
        onClick={() => {
          const { added } = cartStore.add({ productId, slug, name }, quantity);
          if (added) {
            analytics.track({
              name: "add_to_cart",
              productSlug: slug,
              quantity,
              source: "product_page",
            });
            setQuantity(1);
          }
        }}
      >
        <CartIcon className="h-5 w-5" />
        Добави в количката
      </Button>

      {/* Its height is kept whether or not the product is in the cart. */}
      <p id={statusId} className="mt-2 min-h-6 text-sm text-ink-700">
        {inCart > 0 && (
          <>
            В количката: <span className="tabular-nums">{inCart} бр.</span>{" "}
            <Link
              href={href(locale, routes.cart)}
              className="whitespace-nowrap text-pine-700 underline underline-offset-2 hover:no-underline"
            >
              Към количката
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
