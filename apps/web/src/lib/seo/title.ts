import { siteConfig } from "@/config/site";

/**
 * How every storefront `<title>` ends: the page's own words, a bar, the shop's
 * name.
 *
 * **The one place that decides it.** The market study writes its titles with a
 * bar before the name (`docs/seo.md` §12), and a bar is the right separator
 * for a second reason: the titles themselves use a dash („Кафе на зърна — цена
 * за кг и на чаша“), and a second dash before the name would read as a third
 * clause.
 *
 * A page reaches this in one of two ways, and both give the same result:
 *
 *  - it sets a plain `title` and the storefront layout's template, built from
 *    `TITLE_TEMPLATE` below, appends the name (landings, the journal, product
 *    pages, the wizard, the legal pages);
 *  - it sets an absolute title through `pageTitle` in `listing-meta.ts`, which
 *    calls `fullTitle` (listings, brands, the index pages).
 *
 * Nothing else may spell the separator. The admin panel has a template of its
 * own and is not a storefront page.
 */

/** A title as a search result prints it. */
export const fullTitle = (text: string): string => `${text} | ${siteConfig.name}`;

/** The same, as Next's `title.template`: `%s` is the page's own title. */
export const TITLE_TEMPLATE = fullTitle("%s");
