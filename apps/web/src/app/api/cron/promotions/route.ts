import { guardCron } from "@/lib/cron-auth";
import { refreshPromotions } from "@/lib/promotions/refresh";
import { revalidateShop } from "@/lib/promotions/revalidate";

/**
 * Hourly, at five past (`vercel.json`): the promotions brought in line with
 * the catalog, and the shop refreshed when that moved a price.
 *
 * A promotion switches itself on and off in the price layer (`now()` in SQL),
 * so nothing here is needed for the price to be right in a fresh render.
 * What this does is everything that depends on time passing or on the sync:
 * a product that joined a promoted brand or category joins the promotion; one
 * taken off sale leaves it; a 30-day lowest price that was provisional while
 * its promotion had not started is settled at the start (`refresh.ts`). And
 * when a promotion started or ended since the last run, or a running one's
 * products or reference prices moved, every shop page is revalidated at once
 * (`revalidate.ts`) instead of page by page over the next five minutes.
 *
 * The response carries counts and nothing else.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refused = guardCron(request);
  if (refused) return refused;

  try {
    const report = await refreshPromotions(new Date());
    if (report.shopChanged) revalidateShop();
    return Response.json(
      { ...report, revalidated: report.shopChanged },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "cron.promotions.failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ error: "promotions_failed" }, { status: 500 });
  }
}
