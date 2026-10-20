import { isSignedIn } from "@/lib/auth";
import { PROMOTION_PICKER_RESULTS, toPromotionPickerProduct } from "@/lib/promotions/picker";

/**
 * The promotion editor's product search: `?q=` against products on sale, by
 * name, brand or address, ranked as the storefront's typeahead ranks them —
 * the newsletter picker's search (`searchProductCards`), answered with ids.
 *
 * A route rather than a server action, for the newsletter's reason: actions
 * run one at a time per page, and a search still out must not hold up
 * "Запази". A route handler gets no layout, so the session is checked here.
 * The catalog module is imported on the first real search, so the route's
 * own tests need no database.
 */

export async function GET(request: Request) {
  if (!(await isSignedIn())) {
    return Response.json({ error: "Сесията е изтекла. Влезте отново." }, { status: 401 });
  }
  const term = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 100);
  try {
    const { searchProductCards } = await import("@/lib/catalog/queries");
    const cards = await searchProductCards(term, PROMOTION_PICKER_RESULTS);
    return Response.json(
      { products: cards.map(toPromotionPickerProduct) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "promotions.product_search_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json(
      { error: "Търсенето не успя. Опитайте отново." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
