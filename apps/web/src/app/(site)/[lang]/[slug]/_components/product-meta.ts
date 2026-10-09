import type { ProductDetailView } from "@/lib/catalog/types";
import { fullTitle } from "@/lib/seo/title";
import { CALLBACK_SENTENCE } from "../../../../../../content/order-callback";

/*
 * The product page's title and meta description, apart from the page so they
 * can be tested without a database: the page module imports the catalog
 * queries, and those open a connection when they load.
 */

/**
 * `<Brand> <Line> — <format>, <qty> | <shop>` (docs/seo.md §12).
 *
 * Absolute, and ended by `fullTitle`, which is the one place the separator
 * before the shop's name is spelled (`lib/seo/title.ts`).
 */
export function productPageTitle(product: Pick<ProductDetailView, "name">): string {
  return fullTitle(product.name);
}

/**
 * The meta description: what it is, what it costs, what a cup costs, and how
 * it is ordered.
 *
 * The price per cup and the callback are the two things this shop's snippet
 * can say that nobody else's can (docs/seo.md §12), so they go where a search
 * result shows them, ahead of prose. Every figure is the one the page prints,
 * taken from the same view: nothing here is typed in.
 *
 * A clause with nothing behind it is left out, never defaulted: no price, no
 * price clause; a pack with no known number of cups, no per-cup clause; a
 * product that cannot be ordered today, no invitation to order it.
 */
export function productMetaDescription(product: ProductDetailView): string {
  const title = product.title ?? product.name;
  const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase("bg") + text.slice(1);
  const what = product.detail ? `${title}: ${lowerFirst(product.detail)}` : title;
  const price = product.price
    ? `Цена ${[product.price.formatted, product.servingPrice?.formatted].filter(Boolean).join(", ")}.`
    : null;
  const orderable = product.status === "active" && product.availability !== "out_of_stock";
  const order = orderable ? CALLBACK_SENTENCE : null;
  // "16 бр." already ends the sentence; any other ending needs its full stop.
  return [what.endsWith(".") ? what : `${what}.`, price, order].filter(Boolean).join(" ");
}
