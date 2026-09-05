import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/config/site";

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
          "/search",
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
          "/wizard/result",
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
    host: absoluteUrl("/").replace(/\/$/, ""),
  };
}
