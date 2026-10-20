import { absoluteUrl } from "@/config/site";

/**
 * How `/sitemap.xml` is cached, in one place: the route sets these headers,
 * `lib/seo/sitemap-copy.ts` keeps its copies by the tag, and
 * `lib/revalidate-shop.ts` expires it.
 *
 * **Drawn on request, kept by the CDN for an hour.** The function draws the
 * sitemap from the database (or hands out a draw at most a minute old; see
 * `sitemap-copy.ts`), and the CDN in front of it holds a copy:
 *
 *  - `CDN-Cache-Control: public, s-maxage=3600, stale-while-revalidate=600,
 *    stale-if-error=86400`. Fresh for an hour; for ten minutes after that the
 *    CDN still answers with the old copy while one request draws the new one;
 *    past that, a request waits for a fresh one. So a copy is never much more
 *    than seventy minutes old, however rarely the sitemap is fetched. The
 *    default for a prerendered route (`expire`, one year) would let a crawler
 *    that comes once a day read the copy drawn on its previous visit, every
 *    time. And for a day, an error from the function (the database down) is
 *    answered with the copy the CDN already holds. Vercel reads this header in
 *    preference to `Cache-Control`, and consumes the stale directives.
 *  - `Cache-Control: public, max-age=0, must-revalidate`: what a browser or a
 *    crawler is told, unchanged from what Next.js sends for a sitemap: never
 *    reuse a copy without asking.
 *  - `Vercel-Cache-Tag: <site>:sitemap`, the shop's own tag (`SITEMAP_TAG`,
 *    `buy-a-coffee.com:sitemap` in production). `revalidateShop()` and
 *    `/api/revalidate` expire it (`revalidateTag(SITEMAP_TAG, { expire: 0 })`),
 *    and Vercel documents `revalidateTag` among the ways its CDN cache is
 *    purged by tag, so the next request should draw the sitemap afresh. That is
 *    the one part local `next start` cannot show; confirm it on a preview
 *    (`docs/architecture.md`, "Catalog freshness"). Without it a change still
 *    arrives within the seventy minutes. A tag of our own rather than
 *    `revalidatePath("/sitemap.xml")`: that path's implicit tag also expires
 *    every cache entry the route reads, the kept copy included, and the kept
 *    copy is the one thing that must outlive a revalidation.
 *
 * **Named after the site.** The tag and the keys of the server's copies
 * (`sitemap-copy.ts`) carry the site's host: the data cache and the CDN's tags
 * may be shared by every project in the Vercel team, and another shop's
 * `sitemap` must neither purge nor stand in for this one's.
 *
 * Local `next start` has no CDN: there, every request reaches the function.
 */
export const SITEMAP_PATH = "/sitemap.xml";

/** The origin every URL in the sitemap is on: `NEXT_PUBLIC_SITE_URL`'s, as `absoluteUrl` writes them. */
export const SITEMAP_ORIGIN = (() => {
  try {
    return new URL(absoluteUrl("/")).origin;
  } catch {
    return "null";
  }
})();

/** The site's host (`buy-a-coffee.com`), which names the tag and the cache keys. */
export const SITEMAP_SITE = (() => {
  try {
    return new URL(SITEMAP_ORIGIN).host || "buy-a-coffee";
  } catch {
    return "buy-a-coffee";
  }
})();

/** The shop's tag for the sitemap: the CDN's copy and the server's "changed since" mark. */
export const SITEMAP_TAG = `${SITEMAP_SITE}:sitemap`;

/** Seconds the CDN serves its copy as fresh. */
export const SITEMAP_CDN_FRESH_SECONDS = 3600;
/** Seconds after that it may still serve it while one request draws a new one. */
export const SITEMAP_CDN_STALE_SECONDS = 600;
/** Seconds it may answer an error from the function with the copy it holds. */
export const SITEMAP_CDN_ON_ERROR_SECONDS = 86_400;
/** Seconds the CDN keeps a kept copy (served while the database is down) before asking again. */
export const SITEMAP_KEPT_CDN_SECONDS = 60;

const BROWSER = "public, max-age=0, must-revalidate";
const ON_ERROR = `stale-if-error=${SITEMAP_CDN_ON_ERROR_SECONDS}`;

export const SITEMAP_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/xml",
  "cache-control": BROWSER,
  "cdn-cache-control": `public, s-maxage=${SITEMAP_CDN_FRESH_SECONDS}, stale-while-revalidate=${SITEMAP_CDN_STALE_SECONDS}, ${ON_ERROR}`,
  "vercel-cache-tag": SITEMAP_TAG,
};

/**
 * The copy kept from the last good draw, served while the database cannot be
 * read: the CDN asks again within a minute, so the fresh one follows the
 * database back. (Every answer also says which copy it is, in
 * `x-sitemap-copy`: `drawn`, `recent` or `kept`.)
 */
export const KEPT_SITEMAP_HEADERS: Readonly<Record<string, string>> = {
  ...SITEMAP_HEADERS,
  "cdn-cache-control": `public, s-maxage=${SITEMAP_KEPT_CDN_SECONDS}, ${ON_ERROR}`,
};

/**
 * A query string names nothing here, and each one is a separate CDN entry, so
 * `/sitemap.xml?anything` is sent to `/sitemap.xml` without a draw.
 */
export const SITEMAP_REDIRECT_HEADERS: Readonly<Record<string, string>> = {
  location: SITEMAP_PATH,
  "cache-control": "public, max-age=3600",
};
