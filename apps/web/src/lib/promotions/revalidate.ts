import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Make the shop's pages draw their prices afresh on their next visit.
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
 * The sitemap is outside the layout and lists what is reduced, so it is named
 * on its own. In a server action the pages are marked at once; from a route
 * handler (the cron) on their next visit, which comes to the same thing for the
 * reader.
 */
const SHOP_ROOT = "/(site)/[lang]";

/** Every page route under the shop's layout that may be regenerated on demand. */
export const SHOP_PAGE_ROUTES = [
  "",
  "/[slug]",
  "/aromatizirano-kafe",
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

export function revalidateShop(): void {
  for (const route of SHOP_PAGE_ROUTES) revalidatePath(`${SHOP_ROOT}${route}`, "page");
  revalidatePath("/sitemap.xml");
}
