import { DEFAULT_LOCALE } from "@/i18n/config";
import { getArticle, getMovedArticle } from "@/lib/journal";
import { href, productHref, routes } from "@/lib/routes";

/**
 * The URLs the shop served before it had locales, and where each one lives
 * now.
 *
 * buy-a-coffee.com was live with English, unprefixed routes — `/products/<slug>`,
 * `/categories/<slug>`, `/wizard` — and every one of them may be indexed,
 * bookmarked or printed in a mail. Each answers a **308** to its Bulgarian
 * equivalent (permanent, and method-preserving, so a stale form post still
 * lands), with its query string intact: a filtered listing or a search keeps
 * its filters and its term. Pure, so every pattern is tested without a server.
 *
 * **One hop where the answer is known without asking anyone.** An article
 * that has been retitled lists the slugs it used to have, in the repository,
 * as plain data (`previousSlugs`). `/journal/<old slug>` therefore goes
 * straight to the article's current address, not to `/bg/blog/<old slug>` for
 * the article route to redirect a second time: a chain of two permanent
 * redirects is one more than a crawler needs to follow and one more than a
 * link's weight survives intact.
 *
 * Nothing imported here may need a database. The proxy loads this module for
 * every request it handles, and the journal's registry is files, not rows.
 *
 * Old category slugs need the catalog to answer — `/categories/kapsuli` becomes
 * `/bg/kafe-kapsuli` through the category's source key — so that one pattern
 * is answered by a route handler, `app/categories/[slug]/route.ts`, with the
 * database in reach. Everything else is answered here, by the proxy, without
 * one.
 */

export type LegacyAnswer =
  /** 308 to this path (query string added by the caller). */
  | { readonly type: "redirect"; readonly pathname: string }
  /** An old category URL: the route handler looks the slug up. */
  | { readonly type: "category"; readonly slug: string };

type Pattern = (rest: readonly string[]) => string | null;

const exact =
  (path: string): Pattern =>
  (rest) =>
    rest.length === 0 ? href(DEFAULT_LOCALE, path) : null;

const withSlug =
  (index: string, item: (slug: string) => string): Pattern =>
  (rest) => {
    if (rest.length === 0) return href(DEFAULT_LOCALE, index);
    const [slug] = rest;
    return rest.length === 1 && slug ? item(slug) : null;
  };

/**
 * The slug an article is published at today, for a slug it has or once had.
 *
 * A current slug always wins over a retired one, as it does on the article
 * route. A slug the journal has never used is passed through unchanged: the
 * redirect then leads to a 404, as it always did, rather than this module
 * deciding what exists.
 */
function currentArticleSlug(slug: string): string {
  if (getArticle(slug)) return slug;
  return getMovedArticle(slug)?.slug ?? slug;
}

/** First legacy segment → how the rest of the path maps. */
const LEGACY: Readonly<Record<string, Pattern>> = {
  products: (rest) => {
    const [slug] = rest;
    return rest.length === 1 && slug ? productHref(DEFAULT_LOCALE, { slug }) : null;
  },
  brands: withSlug(routes.brands, (slug) => href(DEFAULT_LOCALE, routes.brand(slug))),
  journal: withSlug(routes.journal, (slug) =>
    href(DEFAULT_LOCALE, routes.article(currentArticleSlug(slug))),
  ),
  wizard: (rest) => {
    const [first, slug, ...more] = rest;
    if (first === undefined) return href(DEFAULT_LOCALE, routes.wizard);
    if (first === "result" && slug === undefined) return href(DEFAULT_LOCALE, routes.wizardResult);
    if (first !== "machines" || more.length > 0) return null;
    return href(DEFAULT_LOCALE, slug ? routes.machineBrand(slug) : routes.machines);
  },
  newsletter: (rest) =>
    rest.length === 1 && rest[0] === "unsubscribe"
      ? href(DEFAULT_LOCALE, routes.unsubscribe)
      : null,
  search: exact(routes.search),
  promotions: exact(routes.promotions),
  vending: exact(routes.vending),
  consumables: exact(routes.consumables),
  delivery: exact(routes.delivery),
  contact: exact(routes.contact),
  privacy: exact(routes.privacy),
  terms: exact(routes.terms),
  cookies: exact(routes.cookies),
};

/**
 * Where a pre-locale URL went, or null when the path is not one.
 *
 * `/categories` itself is a plain redirect; `/categories/<slug>` is handed to
 * the route handler. Anything deeper than a pattern allows is not a URL the
 * shop ever served and is left to 404.
 */
export function legacyAnswer(pathname: string): LegacyAnswer | null {
  const [first, ...rest] = pathname.split("/").filter(Boolean);
  if (first === undefined) return null;

  if (first === "categories") {
    if (rest.length === 0)
      return { type: "redirect", pathname: href(DEFAULT_LOCALE, routes.categories) };
    const [slug] = rest;
    return rest.length === 1 && slug ? { type: "category", slug } : null;
  }

  const pattern = Object.hasOwn(LEGACY, first) ? LEGACY[first] : undefined;
  const target = pattern?.(rest) ?? null;
  return target ? { type: "redirect", pathname: target } : null;
}
