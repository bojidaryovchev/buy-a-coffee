import { NEXT_RSC_UNION_QUERY } from "next/dist/client/components/app-router-headers";
import { connection } from "next/server";
import {
  KEPT_SITEMAP_HEADERS,
  SITEMAP_HEADERS,
  SITEMAP_REDIRECT_HEADERS,
} from "@/lib/seo/sitemap-cache";
import { currentSitemap } from "@/lib/seo/sitemap-copy";

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

  const copy = await currentSitemap();
  // Which copy this is: a fresh draw, one at most a minute old, or the kept one.
  const which = { "x-sitemap-copy": copy.source };
  if (copy.source === "kept") {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "sitemap.draw_failed",
        served: "kept",
        keptFrom: new Date(copy.drawnAt).toISOString(),
        error: copy.failure,
      }),
    );
    return new Response(copy.xml, { headers: { ...KEPT_SITEMAP_HEADERS, ...which } });
  }
  return new Response(copy.xml, { headers: { ...SITEMAP_HEADERS, ...which } });
}
