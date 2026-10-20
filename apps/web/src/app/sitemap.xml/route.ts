import { resolveSitemap } from "next/dist/build/webpack/loaders/metadata/resolve-route-data";
import { sitemapEntries } from "@/lib/seo/sitemap";
import { SITEMAP_HEADERS } from "@/lib/seo/sitemap-cache";

/**
 * `/sitemap.xml`, drawn from the database on request and cached by the CDN
 * (`lib/seo/sitemap-cache.ts`).
 *
 * **Why a route and not `app/sitemap.ts`.** The metadata file was prerendered
 * at build and, on Vercel, never regenerated, whatever its `revalidate`. A
 * sitemap function that uses no request-time API is "cached by default"
 * (Next.js docs, `sitemap.xml`), so the build prerendered it, and the build
 * hands a prerendered route whose path is a metadata file's name
 * (`/sitemap.xml`, `/robots.txt`, `isStaticMetadataFile`) to the deployment
 * adapter as a plain static file: no ISR entry and no function
 * (`next/dist/build/adapter/build-complete.js`, "Skip static metadata routes
 * only when they are prerendered"). Vercel then served the build's copy from
 * its CDN until the next deploy, `revalidate = 3600` and
 * `revalidatePath("/sitemap.xml")` notwithstanding. `next start` does honour
 * the `revalidate`, which is why it never showed locally. The metadata route
 * also fixes its own `Cache-Control` (`public, max-age=0, must-revalidate`),
 * and Next.js adds `s-maxage` only to a response that has none, so a CDN was
 * never told how long it could keep it.
 *
 * Dynamic, then, which keeps it out of the prerender and so out of that
 * branch, and with the CDN's lifetime set here. The XML is Next.js's own
 * serialisation of the same entries (`resolveSitemap`, what the metadata route
 * called), so the document is unchanged byte for byte.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response(resolveSitemap(await sitemapEntries()), { headers: SITEMAP_HEADERS });
}
