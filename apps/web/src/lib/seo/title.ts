import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

/**
 * How every storefront `<title>` ends: the page's own words, a bar, the shop's
 * name — while that fits in a search result.
 *
 * **The one place that decides it.** The market study writes its titles with a
 * bar before the name (`docs/seo.md` §12), and a bar is the right separator
 * for a second reason: the titles themselves use a dash („Кафе на зърна — цена
 * за кг и на чаша“), and a second dash before the name would read as a third
 * clause.
 *
 * **Sixty characters, and the name is what gives way.** Google cuts a title at
 * about 600 px, roughly sixty characters, and it cuts from the end — so a long
 * title ending in the shop's name lost the name and part of the page's own
 * words with it („Rema Caffè Fortissimo — капсули за Nespresso, 20 бр. |
 * Buy…“). The page's words are what is searched; the name is shown above the
 * result anyway, from the `WebSite` structured data. So the name is added only
 * while the whole title stays within `TITLE_LIMIT`, and a page whose own words
 * already run past it is held to it by `test/metadata-quality.test.ts`.
 *
 * A page reaches this through `pageTitle`: an absolute title, built here. The
 * layout's template, `TITLE_TEMPLATE`, always appends the name, because a
 * template cannot measure; it is the fallback for a page that sets no title of
 * its own, and every storefront page sets one.
 *
 * Nothing else may spell the separator. The admin panel has a template of its
 * own and is not a storefront page.
 */

/** Characters a title may run to before a search result cuts it. */
export const TITLE_LIMIT = 60;

const SHOP_SUFFIX = ` | ${siteConfig.name}`;

/** Counted as a reader counts: one per character, not per UTF-16 unit. */
export const titleLength = (text: string): number => [...text].length;

/**
 * Text cut to at most `limit` characters at a word boundary, with nothing
 * left dangling: no trailing comma, dash, colon or opening bracket, and no
 * bracket left open. The last resort of a title that has nothing else to give
 * up; whole words or nothing, never a word cut in two.
 */
export function clipWords(text: string, limit: number = TITLE_LIMIT): string {
  const characters = [...text];
  if (characters.length <= limit) return text;
  let cut = characters.slice(0, limit).join("");
  // Mid-word unless the next character is a space: back to the last space.
  if (!/\s/.test(characters[limit] ?? " ")) cut = cut.slice(0, Math.max(0, cut.lastIndexOf(" ")));
  const tidy = (value: string) => value.replace(/[\s,.;:—–\-/(]+$/u, "");
  cut = tidy(cut);
  const open = (cut.match(/\(/g) ?? []).length;
  const closed = (cut.match(/\)/g) ?? []).length;
  if (open > closed) cut = tidy(cut.slice(0, cut.lastIndexOf("(")));
  return cut;
}

/** The page's words and the shop's name, whatever the length. */
export const withShopName = (text: string): string => `${text}${SHOP_SUFFIX}`;

/** A title as a search result prints it: with the shop's name while it fits. */
export const fullTitle = (text: string): string =>
  titleLength(withShopName(text)) <= TITLE_LIMIT ? withShopName(text) : text;

/** A page's `title`: absolute, so the layout's template does not add the name again. */
export function pageTitle(text: string): NonNullable<Metadata["title"]> {
  return { absolute: fullTitle(text) };
}

/** The same ending as Next's `title.template`: `%s` is the page's own title. */
export const TITLE_TEMPLATE = withShopName("%s");
