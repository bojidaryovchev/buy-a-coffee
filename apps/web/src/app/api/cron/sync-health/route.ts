import { guardCron } from "@/lib/cron-auth";
import { runSyncHealthCheck } from "@/lib/sync-health-check";

/**
 * Daily watch on the catalog sync, from inside the storefront.
 *
 * The sync itself runs elsewhere (a scheduled workflow). The alarm lives here
 * so that it does not depend on the thing it monitors: the workflow can be
 * switched off, lose its secrets or stop being scheduled, and this still runs.
 *
 * Vercel calls it with GET and `Authorization: Bearer <CRON_SECRET>`; see
 * `lib/cron-auth.ts`. Never cached: an answer from yesterday is the one failure
 * this route cannot have.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refused = guardCron(request);
  if (refused) return refused;

  try {
    return Response.json(await runSyncHealthCheck(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    /* A 500 is the signal Vercel's cron log shows; the body is for whoever
       reads that log, and names nothing but the failure. */
    console.error(
      JSON.stringify({
        level: "error",
        msg: "cron.sync_health.failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ error: "sync_health_failed" }, { status: 500 });
  }
}
