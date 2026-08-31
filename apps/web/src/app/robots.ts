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
 */
export default function robots(): MetadataRoute.Robots {
  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    process.env.NEXT_PUBLIC_ENVIRONMENT === "production" ||
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
