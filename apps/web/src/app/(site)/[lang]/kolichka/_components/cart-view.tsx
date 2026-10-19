"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CartOrderForm } from "@/components/forms/cart-order-form";
import { DeliveryPaymentBlock } from "@/components/commerce/delivery-payment-block";
import { QuantityStepper } from "@/components/cart/quantity-stepper";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";
import { ProductImage } from "@/components/catalog/product-image";
import { CartIcon, CloseIcon } from "@/components/layout/icons";
import {
  AvailabilityBadge,
  ButtonLink,
  EmptyState,
  buttonClasses,
} from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import type { Locale } from "@/i18n/config";
import type { CartLine } from "@/lib/cart/cart";
import { cartStore, useCart } from "@/lib/cart/store";
import type { CartProductView } from "@/lib/cart/view";
import { lineTotal, orderSum, productCount } from "@/lib/orders/lines";
import { href, productHref, routes } from "@/lib/routes";

/**
 * The cart page's body: the lines, what they add up to, and the order form.
 *
 * Everything here comes from two places, and neither is trusted for the
 * other's job. The browser's cart says which products and how many
 * (`useCart`); the server says what each product is and costs today
 * (`/api/cart`). A price is never read from storage, and what the customer
 * sees beside the form is what the server would charge if the button were
 * pressed now — the action prices the order again anyway.
 *
 * A line the shop cannot take any more (withdrawn, gone from the catalog, or
 * out of stock today) stays on the page with the reason, and is left out of
 * the sum and the order, so nothing disappears without a word.
 *
 * States, in the order a visit meets them: reading the cart (the server sent
 * none), asking the server, the cart, and after the order the answer. An
 * empty cart says so and points back to the shelves. Nothing here works
 * without JavaScript, because the cart is in the browser; the page says that
 * in a `<noscript>` and offers the phone and the product pages' quick order.
 */

type Quote =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      /** Every id the answer was asked about: those it does not hold are gone. */
      readonly asked: ReadonlySet<string>;
      /** The `round` it was asked in. */
      readonly round: number;
      readonly products: ReadonlyMap<string, CartProductView>;
    }
  | { readonly status: "failed" };

interface Placed {
  readonly message: string;
  readonly reference?: string;
  readonly lines: ReadonlyArray<{ readonly title: string; readonly quantity: number }>;
}

const PHONE_LINK =
  "whitespace-nowrap text-pine-700 underline underline-offset-2 hover:no-underline";
/** The same link on a caution wash, in ink: pine on `caution-100` is not a measured pairing. */
const PHONE_LINK_ON_CAUTION =
  "font-medium whitespace-nowrap text-ink-900 underline underline-offset-2 hover:no-underline";

export function CartView({ locale }: { locale: Locale }) {
  const { ready, lines } = useCart();
  const [quote, setQuote] = useState<Quote>({ status: "loading" });
  const [placed, setPlaced] = useState<Placed | null>(null);
  /** Bumped to ask the server again about products it has already answered for. */
  const [round, setRound] = useState(0);

  const ids = useMemo(() => [...new Set(lines.map((line) => line.productId))].sort(), [lines]);
  const idsKey = ids.join(",");

  /*
   * The server is asked when it has not been asked about a product in the
   * cart yet, or when the page wants a fresh answer (`round`: after a failure,
   * or when the action refused the cart). Not when a quantity changes and not
   * when a line is removed: the answer already holds what the page needs, so
   * neither costs a request or flashes the skeleton.
   */
  const needed =
    quote.status === "loading" ||
    (quote.status === "ready" && (quote.round !== round || ids.some((id) => !quote.asked.has(id))));
  const request = needed && ready && idsKey !== "" ? `${idsKey}|${round}` : "";

  useEffect(() => {
    if (!request) return;
    const [forIds = "", forRound = "0"] = request.split("|");
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/cart?ids=${forIds}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { products: CartProductView[] };
        setQuote({
          status: "ready",
          asked: new Set(forIds.split(",")),
          round: Number(forRound),
          products: new Map(data.products.map((product) => [product.id, product])),
        });
      } catch {
        if (!controller.signal.aborted) setQuote({ status: "failed" });
      }
    })();
    return () => controller.abort();
  }, [request]);

  const products = quote.status === "ready" ? quote.products : null;
  /*
   * Whether every line can be drawn. A product the server was asked about and
   * did not return is gone from the catalog; one it has not been asked about
   * yet (another tab has just added it) is not known, and the page waits for
   * the answer rather than calling it gone.
   */
  const known = quote.status === "ready" && ids.every((id) => quote.asked.has(id));
  const orderable = useMemo(
    () =>
      products
        ? lines.filter((line) => {
            const product = products.get(line.productId);
            return product !== undefined && product.blocked === null;
          })
        : [],
    [lines, products],
  );
  const sum = useMemo(
    () =>
      orderSum(
        orderable.map((line) => ({
          name: line.productId,
          quantity: line.quantity,
          unitPrice: products?.get(line.productId)?.price ?? null,
        })),
        locale,
      ),
    [orderable, products, locale],
  );

  const onPlaced = useCallback(
    (answer: { message: string; reference?: string }) => {
      setPlaced({
        ...answer,
        lines: orderable.map((line) => ({
          title: products?.get(line.productId)?.name ?? "",
          quantity: line.quantity,
        })),
      });
      // Sent: the cart has done its job, and nothing is left in the browser.
      cartStore.clear();
    },
    [orderable, products],
  );
  const onCartRefused = useCallback(() => setRound((count) => count + 1), []);

  if (placed) return <PlacedView placed={placed} locale={locale} />;

  if (!ready) return <Skeleton count={1} />;

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={<CartIcon className="mb-4 h-10 w-10 text-ink-300" />}
        title="Количката е празна"
        description="Изберете кафе от каталога и го добавете тук — или ни се обадете и ще поръчаме заедно."
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href={href(locale, routes.categories)}>Към каталога</ButtonLink>
            <ButtonLink href={href(locale, routes.machines)} variant="secondary">
              Намери по машина
            </ButtonLink>
          </div>
        }
      />
    );
  }

  if (quote.status === "failed") {
    return (
      <div className="rounded-md border border-line bg-caution-100 p-4 md:p-5" role="alert">
        <h2 className="font-display text-lg font-semibold text-caution">
          Не успяхме да заредим количката
        </h2>
        <p className="mt-1 text-sm text-ink-700">
          Продуктите ви са запазени. Опитайте отново след малко или ни се обадете на{" "}
          <a href={`tel:${siteConfig.contact.phoneHref}`} className={PHONE_LINK_ON_CAUTION}>
            {siteConfig.contact.phone}
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => {
            setQuote({ status: "loading" });
            setRound((count) => count + 1);
          }}
          className={buttonClasses({ variant: "secondary", className: "mt-4" })}
        >
          Опитайте отново
        </button>
      </div>
    );
  }

  if (!products || !known) return <Skeleton count={lines.length} />;

  const leftOut = lines.length - orderable.length;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-10">
      <section aria-labelledby="cart-lines-heading" className="min-w-0">
        <h2 id="cart-lines-heading" className="sr-only">
          Продуктите в количката
        </h2>
        <ul className="divide-y divide-line rounded-md border border-line bg-paper-raised">
          {lines.map((line) => (
            <CartLineRow
              key={line.productId}
              line={line}
              product={products.get(line.productId) ?? null}
              locale={locale}
            />
          ))}
        </ul>
        {leftOut > 0 && (
          <p className="mt-3 rounded-sm bg-caution-100 px-3 py-2 text-sm text-caution">
            {leftOut === 1
              ? "1 продукт няма да влезе в заявката. Можете да го махнете от количката."
              : `${leftOut} продукта няма да влязат в заявката. Можете да ги махнете от количката.`}
          </p>
        )}
      </section>

      <aside aria-label="Сума и поръчка" className="grid gap-6 lg:sticky lg:top-44">
        <div className="overflow-hidden rounded-md border border-line bg-paper-raised">
          <div className="p-4 sm:p-5">
            <p className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-ink-700">
                Сума на продуктите{" "}
                <span className="whitespace-nowrap text-ink-500 tabular-nums">
                  ({sum.units} бр.)
                </span>
              </span>
              {sum.subtotal ? (
                <span className="text-xl font-semibold text-ink-900 tabular-nums">
                  {sum.subtotal.formatted}
                </span>
              ) : (
                <span className="text-sm text-ink-500">При запитване</span>
              )}
            </p>
            {sum.unpriced > 0 && sum.subtotal && (
              <p className="mt-1 text-xs text-ink-500">
                Без {productCount(sum.unpriced)} с цена при запитване — цената ще ви кажем по
                телефона.
              </p>
            )}
            <p className="mt-2 text-xs text-ink-500">
              Доставката и крайната сума потвърждаваме по телефона. На сайта нищо не се плаща.
            </p>
          </div>
          <DeliveryPaymentBlock
            locale={locale}
            price={sum.subtotal}
            basis="order"
            className="border-t border-line"
          />
        </div>

        {orderable.length > 0 ? (
          <CartOrderForm
            lines={orderable.map(({ productId, quantity }) => ({ productId, quantity }))}
            onPlaced={onPlaced}
            onCartRefused={onCartRefused}
          />
        ) : (
          <div className="rounded-md border border-line bg-paper-raised p-4 sm:p-5">
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Няма какво да изпратим
            </h2>
            <p className="mt-1 text-sm text-ink-700">
              Нищо от количката не може да бъде поръчано в момента. Обадете ни се на{" "}
              <a href={`tel:${siteConfig.contact.phoneHref}`} className={PHONE_LINK}>
                {siteConfig.contact.phone}
              </a>{" "}
              и ще ви предложим подобно кафе.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function CartLineRow({
  line,
  product,
  locale,
}: {
  line: CartLine;
  product: CartProductView | null;
  locale: Locale;
}) {
  const link = productHref(locale, { slug: product?.slug ?? line.slug });
  const total = product?.blocked === null ? lineTotal(product.price, line.quantity, locale) : null;
  const remove = (
    <button
      type="button"
      onClick={() => cartStore.remove(line.productId)}
      className={buttonClasses({ variant: "ghost", size: "sm", className: "-ml-3" })}
    >
      <CloseIcon className="h-4 w-4" />
      Премахни
      <span className="sr-only">: {product?.name ?? "продукта"}</span>
    </button>
  );

  return (
    <li className="flex gap-3 p-4 sm:gap-4">
      <Link
        href={link}
        tabIndex={-1}
        aria-hidden
        // `self-start`: a flex row would stretch the well to the row's height.
        className="relative block aspect-square w-16 shrink-0 self-start overflow-hidden rounded-sm border border-line bg-well sm:w-20"
      >
        {product?.image ? (
          <ProductImage
            src={product.image.url}
            alt=""
            fill
            sizes="80px"
            className="object-contain"
          />
        ) : (
          <ImagePlaceholder />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        {product ? (
          <>
            <h3 className="font-sans text-sm font-medium tracking-normal text-ink-900 sm:text-base">
              {/* Padding on an inline link widens the target and moves no line. */}
              <Link href={link} className="py-2.5 underline-offset-2 hover:underline">
                {product.title}
              </Link>
            </h3>
            {product.detail && (
              <p className="text-sm text-ink-500 tabular-nums">{product.detail}</p>
            )}
          </>
        ) : (
          <h3 className="font-sans text-sm font-medium tracking-normal text-ink-900 sm:text-base">
            Продукт, който вече не е в каталога
          </h3>
        )}

        {product?.blocked === null ? (
          <>
            {product.availability !== "in_stock" && (
              <div className="mt-1.5 flex">
                <AvailabilityBadge availability={product.availability} />
              </div>
            )}
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-sm tabular-nums">
              {product.price ? (
                <span className="text-ink-700">{product.price.formatted} за брой</span>
              ) : (
                <span className="text-ink-500">Цена при запитване</span>
              )}
              {product.servingPrice && (
                <span className="text-xs font-medium text-pine-700">{product.servingPrice}</span>
              )}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <QuantityStepper
                value={line.quantity}
                onChange={(quantity) => cartStore.setQuantity(line.productId, quantity)}
                label={`Количество: ${product.name}`}
              />
              <p className="text-base font-semibold text-ink-900 tabular-nums">
                {total ? (
                  total.formatted
                ) : (
                  <span className="text-sm font-normal text-ink-500">При запитване</span>
                )}
              </p>
            </div>
            <div className="mt-1">{remove}</div>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-sm text-caution">
              {product?.blocked === "out_of_stock"
                ? "В момента е изчерпан и няма да влезе в заявката."
                : "Вече не го предлагаме и няма да влезе в заявката."}
            </p>
            <div className="mt-1">{remove}</div>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * While the cart is read and its products asked for: the boxes of the lines,
 * so nothing moves when they arrive (DESIGN.md, "Loading").
 */
function Skeleton({ count }: { count: number }) {
  return (
    <div aria-busy="true" className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:gap-10">
      <span className="sr-only" role="status">
        Зарежда се…
      </span>
      <ul className="divide-y divide-line rounded-md border border-line bg-paper-raised">
        {Array.from({ length: Math.max(1, Math.min(count, 6)) }, (_, index) => (
          <li key={index} className="flex gap-3 p-4 sm:gap-4">
            <div className="skeleton aspect-square w-16 shrink-0 sm:w-20" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-5 w-3/4" />
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton mt-3 h-11 w-36" />
            </div>
          </li>
        ))}
      </ul>
      <div className="skeleton hidden h-64 lg:block" />
    </div>
  );
}

function PlacedView({ placed, locale }: { placed: Placed; locale: Locale }) {
  return (
    <div className="max-w-2xl">
      <div role="status" className="rounded-md border border-pine-500 bg-pine-100 p-5">
        <h2 className="font-display text-xl font-semibold text-pine-900">Заявката е получена</h2>
        {placed.reference && (
          <p className="mt-1 text-sm text-ink-700">
            Референция: <span className="font-semibold tabular-nums">{placed.reference}</span>
          </p>
        )}
        <p className="mt-2 text-base text-ink-700">{placed.message}</p>
      </div>

      {placed.lines.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold text-ink-900">Какво поискахте</h2>
          <ul className="mt-2 space-y-1 text-sm text-ink-700">
            {placed.lines.map((line) => (
              <li key={line.title}>
                <span className="tabular-nums">{line.quantity} × </span>
                {line.title}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 text-sm text-ink-500">
        Искате да промените нещо? Обадете ни се на{" "}
        <a href={`tel:${siteConfig.contact.phoneHref}`} className={PHONE_LINK}>
          {siteConfig.contact.phone}
        </a>{" "}
        и кажете референцията.
      </p>
      <div className="mt-6">
        <ButtonLink href={href(locale, routes.home)} variant="secondary">
          Към началната страница
        </ButtonLink>
      </div>
    </div>
  );
}
