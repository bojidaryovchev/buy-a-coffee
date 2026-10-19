import type { ProductDetailView } from "@/lib/catalog/types";
import { fitDescription } from "@/lib/seo/description";
import { TITLE_LIMIT, clipWords, fullTitle, titleLength } from "@/lib/seo/title";
import { CALLBACK_SENTENCE } from "../../../../../../content/order-callback";

/*
 * The product page's title and meta description, apart from the page so they
 * can be tested without a database: the page module imports the catalog
 * queries, and those open a connection when they load.
 */

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase("bg") + text.slice(1);

/**
 * The product's own words for its `<title>` and its share title: its whole
 * name, `<Brand> <Line> — <format>, <qty>`, while that fits a search result.
 *
 * A few names run past sixty characters by themselves („Bianchi Irish Cream
 * Aroma Espresso — капсули за Dolce Gusto, 16 бр.“, 67). Cut at the end, they
 * would lose the system and the size mid-word.
 *
 * **What tells two products apart is never given up.** One line is sold in
 * several formats and pack sizes — Lollo Caffè Classico in eight — so the
 * part after the dash, the system or format and the size, is what keeps their
 * titles apart. What gives way is, in order:
 *
 *  1. the word „капсули“, which the system's name implies
 *     („— Dolce Gusto, 16 бр.“);
 *  2. the end of the brand and line, cut at a word (`clipWords`), so the dash
 *     and everything after it stay whole.
 *
 * Only a name whose distinguishing part alone would leave no room for the
 * line is cut as a whole, at a word. Nothing returned is longer than sixty
 * characters. The page's heading and its description keep the whole name.
 */
export function productTitleWords(
  product: Pick<ProductDetailView, "name" | "title" | "detail">,
): string {
  if (titleLength(product.name) <= TITLE_LIMIT) return product.name;
  if (!product.title || !product.detail) return clipWords(product.name);

  const [format = "", ...rest] = lowerFirst(product.detail).split(", ");
  const pack = rest.join(", ");
  // The part that tells this pack from the line's others: system or format, and size.
  const distinguishing = `${format.replace(/^капсули (за )?/, "")}${pack ? `, ${pack}` : ""}`;
  const shortened = `${product.title} — ${distinguishing}`;
  if (titleLength(shortened) <= TITLE_LIMIT) return shortened;

  const room = TITLE_LIMIT - titleLength(` — ${distinguishing}`);
  const line = room >= MIN_LINE ? clipWords(product.title, room) : "";
  return line ? `${line} — ${distinguishing}` : clipWords(shortened);
}

/** Fewer characters than this of brand and line would no longer name the product. */
const MIN_LINE = 12;

/**
 * `<Brand> <Line> — <format>, <qty> | <shop>` (docs/seo.md §12), the shop's
 * name and then the product's words giving way while the whole is too long
 * for a result (`productTitleWords`).
 *
 * Absolute, and ended by `fullTitle`, which is the one place the separator
 * before the shop's name is spelled (`lib/seo/title.ts`).
 */
export function productPageTitle(
  product: Pick<ProductDetailView, "name" | "title" | "detail">,
): string {
  return fullTitle(productTitleWords(product));
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
  const what = product.detail ? `${title}: ${lowerFirst(product.detail)}` : title;
  const price = product.price
    ? `Цена ${[product.price.formatted, product.servingPrice?.formatted].filter(Boolean).join(", ")}.`
    : null;
  const orderable = product.status === "active" && product.availability !== "out_of_stock";
  const order = orderable ? CALLBACK_SENTENCE : null;
  // "16 бр." already ends the sentence; any other ending needs its full stop.
  return fitDescription(what.endsWith(".") ? what : `${what}.`, price, order);
}
