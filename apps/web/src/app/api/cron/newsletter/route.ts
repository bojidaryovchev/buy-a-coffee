import { guardCron } from "@/lib/cron-auth";
import { runNewsletterCron } from "@/lib/newsletter/cron";

/**
 * The newsletter's daily job: the month's draft, prepared once and mailed to
 * the owner as a link, and any send that stopped, picked up. Nothing goes to
 * the list that the owner did not send. `lib/newsletter/cron.ts` says what
 * each step decides; this route is the guard and the response, which carries
 * counts and nothing else.
 *
 * A resumed send runs here, in the request, for up to the sender's own
 * 200-second budget, so the function is given the five minutes the
 * campaign page's actions have.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const refused = guardCron(request);
  if (refused) return refused;

  try {
    return Response.json(await runNewsletterCron(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "cron.newsletter.failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ error: "newsletter_failed" }, { status: 500 });
  }
}
