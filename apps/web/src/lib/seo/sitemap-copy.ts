import "server-only";
import { unstable_cache } from "next/cache";
import { resolveSitemap } from "next/dist/build/webpack/loaders/metadata/resolve-route-data";
import { sitemapEntries } from "./sitemap";
import { SITEMAP_ORIGIN, SITEMAP_SITE, SITEMAP_TAG } from "./sitemap-cache";

/**
 * Which sitemap the function hands out: a fresh draw from the database, a draw
 * at most a minute old, or — while the database cannot be read — the copy kept
 * from the last good draw.
 *
 * **Fresh by default.** Every time the CDN asks (once an hour per region, and
 * after a purge), the sitemap is drawn from the database. A server-side cache
 * that answered for an hour and refreshed in the background would stack on
 * the CDN's hour: the CDN would refill from a copy already an hour old, and a
 * rarely fetched sitemap would always be one visit behind. So the server keeps
 * draws for two narrower jobs only.
 *
 * **Reuse, for a minute.** Requests the CDN does not answer — another region,
 * or the request headers Next.js lists in `Vary` for every app route (`rsc`,
 * `next-router-*`), which a route cannot take back — share one draw: a draw
 * in progress is joined, and one that began less than `REUSE_MS` ago is handed
 * out again, unless the sitemap was declared changed since it began. So no
 * stream of odd requests can make the database draw it more than once a
 * minute per instance. (Query strings never get here: the route redirects
 * them.)
 *
 * **The kept copy, when the database is down.** Every good draw is also kept
 * in Next.js's data cache (`unstable_cache`, the cache for non-`fetch` data
 * without Cache Components, which persists across requests, instances and
 * deployments). When a draw fails, or takes longer than `DRAW_TIMEOUT_MS`
 * (a database that does not answer must not hold every request), the kept
 * copy is handed out instead, and the route says so (`x-sitemap-copy: kept`)
 * and lets the CDN keep it only a minute. Not a copy older than
 * `MAX_KEPT_AGE_MS`, a week: a sitemap that old says more that is wrong than
 * right, and the CDN's own copy (`stale-if-error`) answers instead. Not one
 * whose first `<loc>` is on another site's origin either: the data cache may
 * be shared by every project in the Vercel team. Without a copy to stand in,
 * the route answers 503. The kept copy carries no tag: a revalidation must
 * make the next request draw afresh, and must not throw away the one copy
 * that stands in when that draw fails.
 *
 * **"Changed since".** `revalidateTag(SITEMAP_TAG, { expire: 0 })` — what
 * `revalidateShop()` and `/api/revalidate` call — expires a small entry under
 * that tag holding the moment it was computed. The first request after it
 * computes it anew, so it is later than every draw that began before the
 * revalidation, and those draws are not reused.
 */

export interface DrawnSitemap {
  readonly xml: string;
  /** When the draw began, in epoch milliseconds. */
  readonly drawnAt: number;
}

export interface SitemapCopy extends DrawnSitemap {
  /** A fresh draw, a draw at most `REUSE_MS` old, or the kept copy of the last good one. */
  readonly source: "drawn" | "recent" | "kept";
  /** Why the database could not be read, when the kept copy stands in. */
  readonly failure?: string;
}

/** Where the copies live. The default is Next.js's data cache; tests pass their own. */
export interface SitemapCopyStore {
  /** When the sitemap was last declared changed, in epoch milliseconds. */
  changedAt(): Promise<number>;
  /** The copy of the last good draw, or null when there is none. */
  readKept(): Promise<DrawnSitemap | null>;
  /** Keep this draw as the last good one. */
  keep(drawn: DrawnSitemap): Promise<void>;
}

/** How long a draw is handed out again without asking the database. */
export const REUSE_MS = 60_000;
/** How long a draw may take before the kept copy stands in for it. */
export const DRAW_TIMEOUT_MS = 5_000;
/** The oldest kept copy that may stand in: past it, the CDN's own copy answers (`stale-if-error`). */
export const MAX_KEPT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SitemapCopyOptions {
  readonly now?: () => number;
  /** `DRAW_TIMEOUT_MS` unless a test says otherwise. */
  readonly drawTimeoutMs?: number;
  /** `MAX_KEPT_AGE_MS` unless a test says otherwise. */
  readonly maxKeptAgeMs?: number;
  /**
   * The site's origin. A kept copy whose first `<loc>` is on another one is
   * some other project's, from a cache the Vercel team shares, and is not
   * handed out.
   */
  readonly origin?: string;
}

/**
 * No sitemap to hand out: the draw failed, and there was no kept copy to stand
 * in (`none`), or one from another site (`foreign`), or one past
 * `MAX_KEPT_AGE_MS` (`too_old`). The route answers 503, and the CDN, for a day,
 * with the copy it holds.
 */
export class SitemapUnavailable extends Error {
  constructor(
    /** Why the draw failed. */
    readonly failure: string,
    readonly kept: "none" | "foreign" | "too_old",
    /** When the refused kept copy was drawn, epoch milliseconds. */
    readonly keptDrawnAt: number | null,
  ) {
    super(`sitemap unavailable: ${failure} (kept copy: ${kept})`);
    this.name = "SitemapUnavailable";
  }
}

/** The origin of a sitemap's first `<loc>`, or null. */
export function firstLocOrigin(xml: string): string | null {
  const loc = /<loc>([^<]+)<\/loc>/.exec(xml)?.[1];
  if (!loc) return null;
  try {
    return new URL(loc.replace(/&amp;/g, "&")).origin;
  } catch {
    return null;
  }
}

/** A draw that takes longer than `ms` counts as failed; it is not waited for. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the draw took longer than ${ms} ms`)), ms);
    // Never what keeps the process alive.
    (timer as { unref?: () => void }).unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createSitemapCopies(
  store: SitemapCopyStore,
  draw: () => Promise<string>,
  options: SitemapCopyOptions = {},
): () => Promise<SitemapCopy> {
  const now = options.now ?? Date.now;
  const drawTimeoutMs = options.drawTimeoutMs ?? DRAW_TIMEOUT_MS;
  const maxKeptAgeMs = options.maxKeptAgeMs ?? MAX_KEPT_AGE_MS;
  let recent: DrawnSitemap | null = null;
  let inFlight: { readonly startedAt: number; readonly drawn: Promise<DrawnSitemap> } | null = null;

  return async function currentSitemap(): Promise<SitemapCopy> {
    // Unknown means "changed": draw rather than hand out something old.
    const changedAt = await store.changedAt().catch(() => Number.POSITIVE_INFINITY);
    const at = now();
    if (recent && recent.drawnAt >= changedAt && at - recent.drawnAt < REUSE_MS) {
      return { ...recent, source: "recent" };
    }

    // Join a draw in progress, unless it began before the last change. One
    // that times out is given up on, so the next request starts afresh rather
    // than queueing behind a database that does not answer.
    let flight = inFlight;
    if (!flight || flight.startedAt < changedAt) {
      const startedAt = at;
      const drawn = withTimeout(draw(), drawTimeoutMs).then(async (xml): Promise<DrawnSitemap> => {
        const result = { xml, drawnAt: startedAt };
        if (!recent || startedAt >= recent.drawnAt) recent = result;
        // Best effort: a copy not kept costs nothing until the database fails.
        await store.keep(result).catch(() => undefined);
        return result;
      });
      const started = { startedAt, drawn };
      flight = started;
      inFlight = started;
      const done = () => {
        if (inFlight === started) inFlight = null;
      };
      drawn.then(done, done);
    }

    try {
      return { ...(await flight.drawn), source: "drawn" };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      const kept = await store.readKept().catch(() => null);
      if (!kept) throw new SitemapUnavailable(failure, "none", null);
      if (options.origin && firstLocOrigin(kept.xml) !== options.origin) {
        throw new SitemapUnavailable(failure, "foreign", kept.drawnAt);
      }
      if (now() - kept.drawnAt > maxKeptAgeMs) {
        throw new SitemapUnavailable(failure, "too_old", kept.drawnAt);
      }
      return { ...kept, source: "kept", failure };
    }
  };
}

const NOTHING_KEPT = "no sitemap has been kept";

/**
 * The "changed since" mark. Computed once and kept until its tag is expired;
 * no database involved.
 */
const changedAt = unstable_cache(
  async () => Date.now(),
  ["sitemap.xml", SITEMAP_SITE, "changed-at"],
  {
    tags: [SITEMAP_TAG],
  },
);

/**
 * The kept copy, one entry under one key. The cache is written by computing,
 * so writing means calling it with the draw to keep; reading, with nothing,
 * so that a missing entry fails instead of being filled. `revalidate: 1`
 * makes any entry over a second old stale: a call returns it at once and
 * computes the replacement in the background, which is how a new draw takes
 * the old one's place, and a failed computation (a read) leaves the entry as
 * it was. The function's source is part of the key, so both calls share it;
 * the site's host is too, for a data cache shared by the projects of a team.
 */
const keptCopy = (latest: DrawnSitemap | null) =>
  unstable_cache(
    async (): Promise<DrawnSitemap> => {
      if (latest === null) throw new Error(NOTHING_KEPT);
      return latest;
    },
    ["sitemap.xml", SITEMAP_SITE, "kept-copy"],
    { revalidate: 1 },
  );

export const nextDataCacheStore: SitemapCopyStore = {
  changedAt: () => changedAt(),
  readKept: () => keptCopy(null)().catch(() => null),
  keep: async (drawn) => {
    await keptCopy(drawn)();
  },
};

/** The sitemap as Next.js writes a generated one, from the live catalog. */
export const drawSitemap = async (): Promise<string> => resolveSitemap(await sitemapEntries());

export const currentSitemap = createSitemapCopies(nextDataCacheStore, drawSitemap, {
  origin: SITEMAP_ORIGIN,
});
