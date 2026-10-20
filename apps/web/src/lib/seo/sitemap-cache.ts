import { NEXT_CACHE_IMPLICIT_TAG_ID } from "next/dist/lib/constants";

/**
 * How `/sitemap.xml` is cached, in one place: the route sets these headers and
 * `lib/revalidate-shop.ts` purges by the tag.
 *
 * **Drawn on request, kept by the CDN for an hour.** The answer is generated
 * from the database every time the function runs (`dynamic = "force-dynamic"`
 * in the route), and the CDN in front of it holds a copy:
 *
 *  - `CDN-Cache-Control: public, s-maxage=3600, stale-while-revalidate=600`.
 *    Fresh for an hour; for ten minutes after that the CDN still answers with
 *    the old copy while one request draws the new one; past that, a request
 *    waits for a fresh one. So a copy is never more than seventy minutes old,
 *    however rarely the sitemap is fetched. The default for a prerendered route
 *    (`expire`, one year) would let a crawler that comes once a day read the
 *    copy drawn on its previous visit, every time. Vercel reads this header in
 *    preference to `Cache-Control`.
 *  - `Cache-Control: public, max-age=0, must-revalidate`: what a browser or a
 *    crawler is told, unchanged from what Next.js sends for a sitemap: never
 *    reuse a copy without asking.
 *  - `Vercel-Cache-Tag`: the tag `revalidatePath("/sitemap.xml")` expires
 *    (Next.js tags a path `_N_T_<path>`). The shop's revalidation already calls
 *    that after a promotion and after a sync (`/api/revalidate`), and Vercel
 *    documents `revalidatePath` and `revalidateTag` among the ways its CDN
 *    cache is purged by tag, so the next request should draw the sitemap
 *    afresh. That is the one part local `next start` cannot show; confirm it
 *    on a preview (`docs/architecture.md`, "Catalog freshness"). Without it a
 *    change still arrives within the seventy minutes.
 *
 * Local `next start` has no CDN: there, every request draws the sitemap.
 */
export const SITEMAP_PATH = "/sitemap.xml";

/** Seconds the CDN serves its copy as fresh. */
export const SITEMAP_CDN_FRESH_SECONDS = 3600;
/** Seconds after that it may still serve it while one request draws a new one. */
export const SITEMAP_CDN_STALE_SECONDS = 600;

/** The tag `revalidatePath(SITEMAP_PATH)` expires. */
export const SITEMAP_CACHE_TAG = `${NEXT_CACHE_IMPLICIT_TAG_ID}${SITEMAP_PATH}`;

export const SITEMAP_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/xml",
  "cache-control": "public, max-age=0, must-revalidate",
  "cdn-cache-control": `public, s-maxage=${SITEMAP_CDN_FRESH_SECONDS}, stale-while-revalidate=${SITEMAP_CDN_STALE_SECONDS}`,
  "vercel-cache-tag": SITEMAP_CACHE_TAG,
};
