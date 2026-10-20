import { guardCron } from "@/lib/cron-auth";
import { createRateLimiter, sharedStore } from "@/lib/rate-limit";
import { readRevalidateRequest } from "@/lib/revalidate-request";
import { revalidateShop, revalidateShopPaths } from "@/lib/revalidate-shop";

/**
 * `POST /api/revalidate`: the catalog changed outside the app, so the pages
 * and the sitemap that show it are drawn afresh on their next visit instead
 * of when their timers run out.
 *
 * The sync and the copy scripts change the database directly — a GitHub
 * Actions job and a command on the owner's machine — and nothing in the app
 * hears about it. They call this when a run changed something
 * (`@catalog/shared/revalidate`).
 *
 * Behind `CRON_SECRET`, as the cron routes are (`lib/cron-auth.ts`): no secret
 * configured, 404; a missing or wrong bearer token, 401. The body is checked
 * strictly before anything happens (`lib/revalidate-request.ts`), and only
 * page routes and single pages are ever named, never the layout
 * (`lib/revalidate-shop.ts` says why). At most twenty calls in ten minutes:
 * a caller looping on it gets 429, not a shop regenerated over and over. The
 * counter is the shared table the forms use, and fails open, because a
 * refresh that does not happen is harmless and one that is refused while the
 * table is unreachable would only add an error to a failure.
 *
 * The answer says what was refreshed. Never cached.
 */
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({
  name: "revalidate",
  limit: 20,
  windowMs: 10 * 60_000,
  onStoreError: "allow",
  store: sharedStore,
});

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(request: Request): Promise<Response> {
  const refused = guardCron(request);
  if (refused) return refused;

  // One caller holds the secret, so one bucket.
  const rate = await limiter.check("storefront");
  if (!rate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { ...NO_STORE, "retry-after": String(retryAfter) } },
    );
  }

  const parsed = await readRevalidateRequest(request);
  if (!parsed.ok) {
    return Response.json(
      { error: parsed.error, ...(parsed.rejected ? { rejected: parsed.rejected } : {}) },
      { status: parsed.status, headers: NO_STORE },
    );
  }

  try {
    const { target } = parsed;
    const revalidated =
      target.scope === "catalog" ? revalidateShop() : revalidateShopPaths(target.paths);
    console.info(
      JSON.stringify({
        level: "info",
        msg: "revalidate.done",
        scope: target.scope,
        routes: revalidated.routes.length,
        paths: revalidated.paths.length,
      }),
    );
    return Response.json({ scope: target.scope, ...revalidated }, { headers: NO_STORE });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "revalidate.failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ error: "revalidate_failed" }, { status: 500, headers: NO_STORE });
  }
}
