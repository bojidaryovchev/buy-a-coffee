import type { NextRequest } from "next/server";
import { MAX_CART_LINES, isProductId } from "@/lib/cart/cart";
import { toCartProductView, type CartProductView } from "@/lib/cart/view";
import { listProductsForOrder } from "@/lib/catalog/queries";
import { cartLimiter, clientFingerprint } from "@/lib/rate-limit";

/**
 * What the products in a cart are and cost, now: `GET /api/cart?ids=a,b,c`.
 *
 * The cart in the browser holds ids and quantities only. Its page asks here for
 * everything it prints — name, photograph, price, availability — so a price is
 * never the one the browser remembered from last week, and a product that has
 * been withdrawn since it was added comes back marked as such (`blocked`) to
 * be shown and left out of the order. An id that names nothing is simply
 * absent from the answer; the page says that product is gone.
 *
 * A route handler and not a server action for the reason the typeahead gives
 * (`api/search/suggest`): it is called from an effect, and an action would
 * queue behind the router. It reads only what product pages already publish,
 * minus the supplier's name, which `toCartProductView` does not carry.
 *
 * Never cached: the answer is a price, and this is the page the order is sent
 * from.
 */

export async function GET(request: NextRequest): Promise<Response> {
  const ids = [
    ...new Set(
      (request.nextUrl.searchParams.get("ids") ?? "")
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter(isProductId),
    ),
  ].slice(0, MAX_CART_LINES);

  // An empty cart is answered without touching the database or the limiter.
  if (ids.length === 0) return json({ products: [] });

  const { allowed, resetAt } = await cartLimiter.check(clientFingerprint(request.headers));
  if (!allowed) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
      },
    });
  }

  try {
    const found = await listProductsForOrder(ids);
    // In the order asked, so the page can draw the lines as the cart lists them.
    const products: CartProductView[] = ids.flatMap((id) => {
      const product = found.get(id);
      return product ? [toCartProductView(product.card, product.status)] : [];
    });
    return json({ products });
  } catch (error) {
    // The page says it could not load the cart and offers the phone; it does
    // not pretend the cart is empty.
    console.error(
      JSON.stringify({ level: "error", msg: "cart.quote_failed", error: String(error) }),
    );
    return new Response(JSON.stringify({ error: "unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}

function json(body: { products: CartProductView[] }): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
