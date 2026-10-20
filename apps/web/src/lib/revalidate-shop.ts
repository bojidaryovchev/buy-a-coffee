import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { SHIPPING_LOCALES, isShipping } from "@/i18n/config";
import { canonicalSegments, href, isReservedSlug, localeOfPath, productHref } from "@/lib/routes";
import { SITEMAP_PATH, SITEMAP_TAG } from "@/lib/seo/sitemap-cache";

/**
 * Make the shop's pages draw themselves afresh on their next visit: after a
 * promotion is saved, stopped or started (`lib/promotions/`), and after the
 * catalog changes outside the app (`/api/revalidate`, called by the sync and
 * the copy scripts).
 *
 * The shop's pages are regenerated every 300 seconds (`revalidate = 300`), so
 * without this a promotion saved, stopped or started would reach them within
 * five minutes, page by page, and the cart (which asks the server) could
 * disagree with the product page for that long.
 *
 * **Page by page, not the layout.** Invalidating the root layout
 * (`revalidatePath("/(site)/[lang]", "layout")`) does reach every page in one
 * call, and it was the first version of this file. But a route that prebuilds
 * its whole list and serves nothing else (`dynamicParams = false`: the
 * journal's articles, the machine pages) is drawn as a 404 by Next.js when it
 * is regenerated after that, and the 404 is then what is cached: one saved
 * promotion took every article and every machine page off the site
 * (`e2e/promotions.spec.ts` followed by `e2e/stitch.spec.ts` showed it). So
 * every page route under the layout is named here with `"page"`, and those two
 * are left to their own clocks — 300 seconds for a machine page, an hour for
 * an article, which quotes figures, not prices to the minute.
 * `test/promotion-revalidate.test.ts` holds the list to the app's folders, so
 * a new page cannot be forgotten and a new `dynamicParams = false` route cannot
 * slip in.
 *
 * Patterns are file paths, route group included, as Next.js builds its tags.
 * Two files outside the layout list what is reduced, so they are named on
 * their own: the sitemap, by its tag, expired at once
 * (`revalidateTag(SITEMAP_TAG, { expire: 0 })`; `lib/seo/sitemap-cache.ts`
 * says why a tag and what that reaches on Vercel), and `/llms.txt`, a
 * prerendered route, by its path. In a server action the pages are marked at
 * once; from a route handler (the cron, `/api/revalidate`) on their next
 * visit, which comes to the same thing for the reader.
 *
 * Every refresh here expires: the next visit to each page waits for a fresh
 * render instead of being served the old one while it is drawn (`"max"`).
 * That is what makes a saved promotion's price right at once, and it is the
 * cost of `/api/revalidate`'s catalog scope too: after a sync, the first
 * visitor to each page waits for its render (`docs/architecture.md`,
 * "Catalog freshness").
 *
 * Moved here from `lib/promotions/revalidate.ts`, which re-exports it, when
 * the catalog's own changes started using it too.
 */
const SHOP_ROOT = "/(site)/[lang]";

/** Every page route under the shop's layout that may be regenerated on demand. */
export const SHOP_PAGE_ROUTES = [
  "",
  "/[slug]",
  "/bezkofeinovo-kafe",
  "/biskvitki",
  "/blog",
  "/byuletin/otpisvane",
  "/dostavka-i-plashtane",
  "/izbor-na-kafe",
  "/izbor-na-kafe/rezultat",
  "/kafe-na-zarna-lavazza",
  "/kafe-za-vending-mashini",
  "/kategorii",
  "/kolichka",
  "/konsumativi",
  "/kontakti",
  "/lavazza-kapsuli",
  "/marki",
  "/marki/[slug]",
  "/nay-evtino-na-chasha",
  "/obshti-usloviya",
  "/poveritelnost",
  "/promotsii",
  "/tarsene",
  "/za-kafemashina",
] as const;

/**
 * The page routes left out, each because it sets `dynamicParams = false`
 * (see above). They follow a promotion on their own `revalidate`.
 */
export const SELF_TIMED_ROUTES = ["/blog/[slug]", "/za-kafemashina/[brand]"] as const;

/** The map of the shop for AI search: a prerendered route that lists what the sitemap lists. */
export const LLMS_PATH = "/llms.txt";

/** What one call refreshed, for the caller's log. */
export interface ShopRevalidation {
  /** Route patterns refreshed as pages, every URL they serve included. */
  readonly routes: readonly string[];
  /** Single URL paths refreshed, each that one page only. */
  readonly paths: readonly string[];
  /** The files outside the layout refreshed with them: the sitemap, and for the whole shop `/llms.txt`. */
  readonly files: readonly string[];
}

/**
 * The sitemap at once: the CDN's copy and the server's "changed since" mark.
 *
 * Whether `{ expire: 0 }` deletes the CDN's copy on Vercel, as the
 * single-argument form does ("Delete, regenerate in the foreground" in
 * Vercel's purge docs), is checked on the preview (`docs/architecture.md`,
 * "Checking it on Vercel"). If it does not, the switch is this one line, the
 * form Next.js 16 deprecates but still runs:
 *
 *     // @ts-expect-error: the deprecated single-argument form, which deletes
 *     revalidateTag(SITEMAP_TAG);
 */
function expireSitemap(): void {
  revalidateTag(SITEMAP_TAG, { expire: 0 });
}

/** Every page of the shop, route by route, the sitemap and `/llms.txt`. */
export function revalidateShop(): ShopRevalidation {
  const routes = SHOP_PAGE_ROUTES.map((route) => `${SHOP_ROOT}${route}`);
  for (const route of routes) revalidatePath(route, "page");
  revalidatePath(LLMS_PATH);
  expireSitemap();
  return { routes, paths: [], files: [SITEMAP_PATH, LLMS_PATH] };
}

/**
 * These pages only, and the sitemap. Each path is one URL (`/bg/<slug>`),
 * which `revalidatePath` without a type refreshes and nothing else: never a
 * layout. Every path must have passed `checkShopPath`.
 */
export function revalidateShopPaths(paths: readonly string[]): ShopRevalidation {
  const unique = [...new Set(paths)];
  for (const path of unique) revalidatePath(path);
  expireSitemap();
  return { routes: [], paths: unique, files: [SITEMAP_PATH] };
}

/** Each shipping locale's address for a product slug. */
export function productPaths(slug: string): string[] {
  return SHIPPING_LOCALES.map((locale) => productHref(locale, { slug }));
}

export type ShopPathVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /**
       * `malformed`: not a lower-case path of plain segments. `locale`: no
       * shipping locale in front. `not_canonical`: an alias the proxy would
       * redirect. `self_timed`: a `dynamicParams = false` page (see above).
       * `unknown_route`: no page of the shop has that shape.
       */
      readonly reason: "malformed" | "locale" | "not_canonical" | "self_timed" | "unknown_route";
    };

/** A path of the shop: `/<locale>` and up to four plain lower-case segments. */
const SHOP_PATH = /^\/[a-z]{2}(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,4}$/;
const MAX_PATH_LENGTH = 200;

/** A product slug as the catalog allocates them (`@catalog/shared/product-slug`). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 120;

/** A route pattern (`/marki/[slug]`) as a matcher for the canonical path below the locale. */
const matcher = (route: string) =>
  new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+").replace(/[-.]/g, "\\$&")}$`);
const PAGE_MATCHERS = SHOP_PAGE_ROUTES.map(matcher);
const SELF_TIMED_MATCHERS = SELF_TIMED_ROUTES.map(matcher);

/**
 * Whether a URL path names one page of the shop that may be regenerated on
 * demand. The rules are the list above: a page under the layout, never one of
 * the self-timed routes.
 */
export function checkShopPath(path: string): ShopPathVerdict {
  if (path.length > MAX_PATH_LENGTH || !SHOP_PATH.test(path))
    return { ok: false, reason: "malformed" };
  const locale = localeOfPath(path);
  if (!locale || !isShipping(locale)) return { ok: false, reason: "locale" };

  const segments = path.split("/").slice(2);
  const canonical = canonicalSegments(locale, segments);
  const below = canonical.length > 0 ? `/${canonical.join("/")}` : "";
  if (href(locale, below || "/") !== path) return { ok: false, reason: "not_canonical" };
  if (SELF_TIMED_MATCHERS.some((pattern) => pattern.test(below))) {
    return { ok: false, reason: "self_timed" };
  }
  return PAGE_MATCHERS.some((pattern) => pattern.test(below))
    ? { ok: true }
    : { ok: false, reason: "unknown_route" };
}

/** Whether a string is a product slug the shop could have allocated. */
export function isProductSlug(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && SLUG.test(slug) && !isReservedSlug(slug);
}
