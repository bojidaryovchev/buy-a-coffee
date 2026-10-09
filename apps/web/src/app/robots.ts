import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/config/site";
import { SHIPPING_LOCALES } from "@/i18n/config";
import { href, routes } from "@/lib/routes";

/**
 * robots.txt
 *
 * Search results and filtered listings are disallowed: they are unbounded
 * permutations of the same products, and letting a crawler walk them wastes
 * its budget on near-duplicate pages instead of the products themselves.
 *
 * A staging deployment blocks everything, because the single most expensive
 * SEO accident is a staging site getting indexed alongside production.
 *
 * On a host that tells us which environment we are in, that answer wins
 * outright. On Vercel `VERCEL_ENV` is `production` only for the production
 * deployment, so previews block crawlers with nothing to configure — and an
 * env var scoped to Preview by mistake cannot re-open them, which is the
 * failure this check exists to prevent. `NEXT_PUBLIC_ENVIRONMENT` is the
 * fallback for hosts that provide no such signal.
 *
 * Paths are built through `href`, one per shipping locale — `/bg/tarsene`,
 * `/bg/izbor-na-kafe/rezultat` — so a slug change or a new locale cannot leave
 * this file guarding a URL nobody serves. The pre-locale paths (`/search`,
 * `/wizard/result`) are deliberately not disallowed: they answer 308 now, and
 * a crawler has to be allowed to fetch a redirect to learn where it leads.
 * The query-string rules match under any path, the locale prefix included.
 */
export default function robots(): MetadataRoute.Robots {
  const hostEnvironment = process.env.VERCEL_ENV;
  const isProduction = hostEnvironment
    ? hostEnvironment === "production"
    : process.env.NEXT_PUBLIC_ENVIRONMENT === "production" ||
      (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENVIRONMENT === undefined);

  if (!isProduction) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          ...SHIPPING_LOCALES.map((locale) => href(locale, routes.search)),
          "/api/",
          "/media/",
          /* Belt to the layout's braces. `(admin)/layout.tsx` sets `noindex`,
             which is the directive that actually keeps a page out of the index
             — robots.txt only stops the fetch, and a URL linked from anywhere
             can be indexed without ever being fetched. This line is still worth
             having on a path that answers with a password form. */
          "/admin",
          "/admin/",
          // Filtered and sorted permutations of listings.
          "/*?brand=",
          "/*?strength=",
          "/*?decaf=",
          "/*?aromas=",
          "/*?category=",
          "/*?sort=",
          "/*?page=",
          // The wizard's answer permutations. The unanswered wizard and the
          // machine pages stay crawlable; every answered state is the same
          // page with different state, exactly like a filtered listing.
          ...SHIPPING_LOCALES.map((locale) => href(locale, routes.wizardResult)),
          "/*?brew=",
          "/*?system=",
          "/*?taste=",
          "/*?volume=",
          "/*?budget=",
          "/*?requirements=",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    /* No `host`. It is a Yandex directive that Google and Bing ignore, this was
       the last copy of it across the four repos, and a robots.txt line no major
       crawler reads is a line that can only ever be wrong. The canonicals
       already say which origin is authoritative. */
  };
}
