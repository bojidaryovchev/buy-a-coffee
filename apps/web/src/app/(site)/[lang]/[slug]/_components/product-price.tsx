import { Badge } from "@/components/ui/primitives";
import { promotionUntil } from "@/lib/catalog/promotion-days";
import type { ProductDetailView } from "@/lib/catalog/types";

type PricedProduct = Pick<
  ProductDetailView,
  "price" | "oldPrice" | "discountPercent" | "promotion" | "servingPrice" | "unitPrice"
>;

/**
 * The product page's price block (DESIGN.md, "Product page", 5): the price,
 * a reduction when there is one, what a cup and a kilogram cost, and, under
 * the shop's own promotion, what it is called and until when.
 *
 * Apart from the page so it can be rendered without a database.
 *
 * **A promotion says only what the badge may say.** The struck price under a
 * promotion is the lowest price of the 30 days before the reduction
 * (`price-sql.ts`; Directive 98/6/EC, Art. 6a, and the Consumer Protection
 * Act with it), and the page says so beside it. When that lowest price was
 * already at or under today's, there is no reduction to announce: the price
 * is the promotion's, and the page shows the price and nothing else — no
 * struck price, no badge, no name and no date, because each of them is a
 * claim of a reduction. A source's own struck price, outside a promotion, is
 * shown as before and gets no 30-day sentence: that figure is not ours to
 * vouch for. No countdown, ever: the last day, as a date, is the fact.
 */
export function ProductPrice({
  product,
  now = new Date(),
}: {
  product: PricedProduct;
  /** For the year of the last day: written out only when it is not this year. */
  now?: Date;
}) {
  const reduced = product.price !== null && product.oldPrice !== null;
  // Under one percent rounds to zero: the struck price says it, as on a card.
  const badge = reduced && product.discountPercent !== null && product.discountPercent >= 1;
  const promotion = reduced ? (product.promotion ?? null) : null;
  const until = promotion ? promotionUntil(promotion.endsAt, now) : null;
  // The owner's words as a sentence of their own: "Есенни дни." — not "дни!.".
  const label = promotion?.label
    ? /[.!?…]$/.test(promotion.label)
      ? promotion.label
      : `${promotion.label}.`
    : null;

  return (
    <div className="mt-5">
      {product.price ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {reduced && <span className="sr-only">Намалена цена </span>}
          <span
            className={`text-3xl font-semibold tabular-nums ${reduced ? "text-clay-600" : "text-ink-900"}`}
          >
            {product.price.formatted}
          </span>
          {reduced && product.oldPrice && (
            <>
              <span className="sr-only">Стара цена </span>
              <span className="text-lg text-ink-300 tabular-nums line-through">
                {product.oldPrice.formatted}
              </span>
              {badge && (
                <Badge tone="reduction" className="tabular-nums">
                  −{product.discountPercent}%
                </Badge>
              )}
            </>
          )}
        </p>
      ) : (
        <p className="text-lg text-ink-500">Цена при запитване — обадете ни се и ще ви я кажем.</p>
      )}

      {/*
        Directly under the pack price, not only in the facts table. Price
        indication rules want the unit price beside the selling price, and the
        price per cup is the number that makes a box of ten capsules comparable
        to a kilogram of beans — which is the question a customer is actually
        asking.
      */}
      {(product.servingPrice || product.unitPrice) && (
        <p className="mt-1 flex flex-wrap gap-x-4 text-sm font-medium text-pine-700 tabular-nums">
          {product.servingPrice && <span>{product.servingPrice.formatted}</span>}
          {product.unitPrice && <span>{product.unitPrice.formatted}</span>}
        </p>
      )}

      {promotion && (
        <div data-promotion className="mt-3 text-sm text-ink-700">
          {/* The promotion's words, when it has any, then one sentence for the
              date; the cart and the home band shorten it to a label. */}
          <p>
            {label && (
              <>
                <span className="font-semibold text-ink-900">{label}</span>{" "}
              </>
            )}
            {until && <span className="tabular-nums">{`Намалението важи ${until}.`}</span>}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Зачеркнатата цена е най-ниската ни цена за последните 30 дни преди намалението.
          </p>
        </div>
      )}
    </div>
  );
}
