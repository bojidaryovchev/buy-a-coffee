import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Make every shop page draw its prices afresh on its next visit.
 *
 * The shop's pages are regenerated every 300 seconds (`revalidate = 300`), so
 * without this a promotion saved, stopped or started would reach them within
 * five minutes, page by page, and the cart (which asks the server) could
 * disagree with the product page for that long.
 *
 * Next.js tags every cached page with its route's layouts (soft tags,
 * `_N_T_/…/layout`, built from the route's file path, route groups included).
 * The shop's root layout is `app/(site)/[lang]/layout.tsx`, and invalidating
 * its tag invalidates every page beneath it, in every locale, at once:
 * `revalidatePath("/(site)/[lang]", "layout")` — the pattern and `"layout"`,
 * since the path has a dynamic segment. Not `revalidatePath("/", "layout")`:
 * there is no `app/layout.tsx` here, and that tag also covers the admin.
 * The sitemap is outside the layout and lists what is reduced, so it is named
 * on its own.
 *
 * In a server action the pages are marked at once; from a route handler (the
 * cron) on their next visit, which comes to the same thing for the reader.
 */
export const SHOP_ROOT_LAYOUT = "/(site)/[lang]";

export function revalidateShop(): void {
  revalidatePath(SHOP_ROOT_LAYOUT, "layout");
  revalidatePath("/sitemap.xml");
}
