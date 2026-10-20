"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useAnalytics } from "@/components/analytics-provider";
import { QuantityStepper } from "@/components/cart/quantity-stepper";
import { CartIcon } from "@/components/layout/icons";
import { Button } from "@/components/ui/primitives";
import { useLocale } from "@/i18n/use-locale";
import { cartStore, useCart } from "@/lib/cart/store";
import { href, routes } from "@/lib/routes";

/**
 * Ordering, on a product page: how many, „Добави в количката“, and „Поръчай“.
 *
 * Every order is sent from one form, the cart's (the owner's decision of
 * 19 October 2026, when an order came to need a name and a delivery). So the
 * page has two ways into it. „Добави в количката“, the page's one gold button,
 * stays on the page: the notice says it was added and offers the cart, and the
 * line under the button says how many of this product the cart now holds, so a
 * second press is a deliberate „one more“ and not an accident nobody sees.
 * „Поръчай“ is for this one product: it puts it in the cart unless it is there
 * already (so pressing it never doubles a line) and opens the cart's form.
 *
 * **Not drawn without JavaScript** (`noscript:hidden`, which is
 * `@media (scripting: none)`). A cart in the browser cannot work without a
 * script, and buttons that do nothing would be worse than none; the product
 * page offers the phone instead. The line under the buttons keeps its height
 * empty or full, so nothing moves when the page hydrates.
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
  const router = useRouter();
  const statusId = useId();
  const inCart = lines.find((line) => line.productId === productId)?.quantity ?? 0;

  return (
    <div className="noscript:hidden">
      <p className="font-display text-base font-semibold text-ink-900">Поръчайте</p>
      <p className="mt-1 text-sm text-ink-500">
        Поръчайте само този продукт или съберете всичко в количката и изпратете една заявка. Ще ви
        се обадим веднъж, за да потвърдим цялата поръчка.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm font-medium text-ink-900" aria-hidden>
          Количество
        </span>
        <QuantityStepper value={quantity} onChange={setQuantity} label="Количество" />
      </div>

      {/* Side by side from `sm`: the panel spans the column now. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Button
          type="button"
          variant="accent"
          size="lg"
          className="w-full"
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

        <Button
          type="button"
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() => {
            if (inCart === 0) {
              const { added } = cartStore.add({ productId, slug, name }, quantity);
              if (added) {
                analytics.track({
                  name: "add_to_cart",
                  productSlug: slug,
                  quantity,
                  source: "product_page",
                });
              }
            }
            router.push(href(locale, routes.cart));
          }}
        >
          Поръчай
        </Button>
      </div>

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
