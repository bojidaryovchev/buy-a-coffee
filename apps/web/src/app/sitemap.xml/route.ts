import { NEXT_RSC_UNION_QUERY } from "next/dist/client/components/app-router-headers";
import { connection } from "next/server";
import {
  KEPT_SITEMAP_HEADERS,
  SITEMAP_HEADERS,
  SITEMAP_REDIRECT_HEADERS,
} from "@/lib/seo/sitemap-cache";
import { SitemapUnavailable, currentSitemap, type SitemapCopy } from "@/lib/seo/sitemap-copy";

const HOUR_MS = 60 * 60 * 1000;
/** How old a copy is, in hours, for a log line someone will read during an outage. */
const ageInHours = (drawnAt: number | null) =>
  drawnAt === null ? null : Math.round(((Date.now() - drawnAt) / HOUR_MS) * 10) / 10;

/**
 * `/sitemap.xml`, drawn from the database on request and cached by the CDN
 * (`lib/seo/sitemap-cache.ts`); while the database cannot be read, the copy
 * kept from the last good draw (`lib/seo/sitemap-copy.ts`).
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
 * A route handler is not cached by default (Next.js docs, "Route Handlers"),
 * which keeps it out of the prerender and so out of that branch; `connection()`
 * says so in the code. Not `dynamic = "force-dynamic"`: that sets every cache
 * read in the route to no-store, `unstable_cache` included, and the kept copy
 * lives there. The XML is Next.js's own serialisation of the same entries
 * (`resolveSitemap`, what the metadata route called), so the document is
 * unchanged byte for byte.
 */
export async function GET(request: Request): Promise<Response> {
  await connection();

  // `/sitemap.xml?anything` is the same document under a CDN key of its own.
  // Except Next.js's own `_rsc`: it answers a request carrying an `rsc` header
  // with a 307 to `?_rsc=<hash of the headers>` before the route runs, and
  // sending that back here would be a loop. Such a request is served, and the
  // draw it is handed is the shared one (`sitemap-copy.ts`).
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => key !== NEXT_RSC_UNION_QUERY)) {
    return new Response(null, { status: 308, headers: SITEMAP_REDIRECT_HEADERS });
  }

  let copy: SitemapCopy;
  try {
    copy = await currentSitemap();
  } catch (error) {
    if (!(error instanceof SitemapUnavailable)) throw error;
    // Nothing of ours may stand in: no kept copy, another site's, or one past a
    // week. A 503 the CDN answers, for a day, with the copy it holds.
    console.error(
      JSON.stringify({
        level: "error",
        msg: "sitemap.unavailable",
        kept: error.kept,
        keptFrom: error.keptDrawnAt === null ? null : new Date(error.keptDrawnAt).toISOString(),
        keptAgeHours: ageInHours(error.keptDrawnAt),
        error: error.failure,
      }),
    );
    return new Response("Service Unavailable", {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "60" },
    });
  }

  // Which copy this is: a fresh draw, one at most a minute old, or the kept one.
  const which = { "x-sitemap-copy": copy.source };
  if (copy.source === "kept") {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "sitemap.draw_failed",
        served: "kept",
        keptFrom: new Date(copy.drawnAt).toISOString(),
        keptAgeHours: ageInHours(copy.drawnAt),
        error: copy.failure,
      }),
    );
    return new Response(copy.xml, { headers: { ...KEPT_SITEMAP_HEADERS, ...which } });
  }
  return new Response(copy.xml, { headers: { ...SITEMAP_HEADERS, ...which } });
}
