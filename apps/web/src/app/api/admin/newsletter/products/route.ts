import { isSignedIn } from "@/lib/auth";
import { PICKER_RESULTS, toPickerProduct } from "@/lib/newsletter/picker";

/**
 * The composer's product picker: `?q=` against products on sale, by name,
 * brand or slug, ranked as the storefront's typeahead ranks them.
 *
 * A route rather than a server action for the reason the preview is one:
 * actions run one at a time per page, so a search still out when the owner
 * presses "Запази" would hold the save up behind it. A fetch runs alongside,
 * and the picker aborts the one it no longer needs.
 *
 * A route handler gets no layout, so the panel's session check is repeated
 * here. The catalog module is imported on the first real search, so the
 * route's own tests need no database.
 */

export async function GET(request: Request) {
  if (!(await isSignedIn())) {
    return Response.json({ error: "Сесията е изтекла. Влезте отново." }, { status: 401 });
  }
  const term = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 100);
  try {
    const { searchProductCards } = await import("@/lib/catalog/queries");
    const cards = await searchProductCards(term, PICKER_RESULTS);
    return Response.json(
      { products: cards.map(toPickerProduct) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "newsletter.product_search_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json(
      { error: "Търсенето не успя. Опитайте отново." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
