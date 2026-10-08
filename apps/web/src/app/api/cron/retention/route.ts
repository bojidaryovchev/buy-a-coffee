import { guardCron } from "@/lib/cron-auth";
import { runRetention } from "@/lib/retention-run";

/**
 * Daily retention: delete what the privacy policy says we no longer keep.
 *
 * What counts as past retention, and why the rule leans towards keeping, is
 * written once in `lib/retention.ts`. This route is the guard and the response;
 * the response carries counts and nothing else.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refused = guardCron(request);
  if (refused) return refused;

  try {
    return Response.json(await runRetention(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "cron.retention.failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ error: "retention_failed" }, { status: 500 });
  }
}
