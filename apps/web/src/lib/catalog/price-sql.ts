import { sql, type SQL } from "drizzle-orm";
import { products, promotionProducts, promotions, syncChanges } from "@catalog/db/schema";

/**
 * The shop's price layer, in SQL: the one definition of what a product costs.
 *
 * Every reader of a price selects these expressions — cards, the product page,
 * the cart, the order, sorting and filtering by price, the promotions page, the
 * sitemap, the newsletter — so a promotion that starts is the price everywhere
 * at once, without a write. Nothing outside this file may spell the price out.
 *
 *  - `regularPrice` is what the shop charges without a promotion: a pinned
 *    `retail_price_override`, else the source's price.
 *  - A promotion is running for a product when the product is in it (and has
 *    not left it), it has started, it has not ended, and nobody stopped it.
 *    `now()` is the statement's start, so one query sees one answer. A product
 *    in two running promotions takes the larger reduction.
 *  - `retailPrice` takes the reduction off and rounds **down** to the cent, so
 *    the badge never reads one percent less than the owner chose.
 *  - `retailOldPrice` is the struck price. Under a promotion it is the lowest
 *    price of the 30 days before the reduction (`promotion_products`), and
 *    never above the regular price now: a price that fell since only makes the
 *    claim smaller. Without one it is the source's own struck price, as before.
 *    A reader shows it only when it is above `retailPrice`.
 */

/** The price without any promotion. */
export const regularPrice = sql<
  string | null
>`coalesce(${products.retailPriceOverride}, ${products.currentPrice})`;

/*
 * The product a subquery below belongs to, written out rather than as
 * `${products.id}`: in the select list of a query over `products` alone,
 * Drizzle renders that as a bare "id", which inside the subquery means the
 * subquery's own row — the promotion's id, the sync change's id — and the
 * subquery silently matches nothing (docs/architecture.md, "One trap worth
 * knowing about"). Nothing aliases `products`, so the table name is the name.
 */
const outerProductId = sql.raw(`"products"."id"`);

/** One field of the promotion pricing the product now, or null. */
function runningPromotion(
  field: "p.id" | "p.percent_off" | "p.label" | "p.ends_at" | "pp.reference_price",
) {
  return sql`(
    select ${sql.raw(field)}
    from ${promotionProducts} pp
    join ${promotions} p on p.id = pp.promotion_id
    where pp.product_id = ${outerProductId}
      and pp.removed_at is null
      and p.stopped_at is null
      and p.starts_at <= now()
      and p.ends_at > now()
    order by p.percent_off desc, p.starts_at asc, p.id asc
    limit 1
  )`;
}

export const promotionId = sql<string | null>`${runningPromotion("p.id")}`;
export const promotionPercent = sql<number | null>`${runningPromotion("p.percent_off")}`;
/** The words the shop shows beside the reduction, if the owner gave any. */
export const promotionLabel = sql<string | null>`${runningPromotion("p.label")}`;
export const promotionEndsAt = sql<string | Date | null>`${runningPromotion("p.ends_at")}`;
const promotionReference = runningPromotion("pp.reference_price");

/** The price the customer pays. */
export const retailPrice = sql<string | null>`coalesce(
  (floor(${regularPrice} * (100 - ${promotionPercent})) / 100)::numeric(12, 2),
  ${regularPrice}
)`;

/** The struck price, before any check that it is a reduction at all. */
export const retailOldPrice = sql<string | null>`case
  when ${promotionPercent} is not null then least(${promotionReference}, ${regularPrice})
  else coalesce(${products.retailOldPriceOverride}, ${products.oldPrice})
end`;

/** The product is shown reduced: the promotions page, its count, the badge. */
export const isReduced = sql<boolean>`(${retailOldPrice} is not null and ${retailOldPrice} > ${retailPrice})`;

/**
 * A catalog sync that creates more products than this at once is an import —
 * the first catalog, or a new part of the source taken in — not products the
 * source has just started selling. On production the first run created 110
 * and the run that took in vending consumables 98; ordinary runs create a few.
 */
export const BULK_IMPORT_SIZE = 25;

/** How long a product counts as new, for the badge and the monthly letter. */
export const NEW_ARRIVAL_DAYS = 30;

/**
 * The product arrived at or after `since` and did not come with an import:
 * the sync run that created it created at most `BULK_IMPORT_SIZE` products.
 * A product the sync never recorded creating (a seed, a test) is not new.
 */
export function isNewArrival(since: SQL): SQL<boolean> {
  return sql<boolean>`(${products.firstSeenAt} >= ${since} and exists (
    select 1 from ${syncChanges} created
    where created.product_id = ${outerProductId}
      and created.change_type = 'created'
      and (
        select count(*) from ${syncChanges} batch
        where batch.sync_run_id = created.sync_run_id and batch.change_type = 'created'
      ) <= ${sql.raw(String(BULK_IMPORT_SIZE))}
  ))`;
}

/** New in the last `NEW_ARRIVAL_DAYS`. */
export const isRecentArrival = isNewArrival(
  sql`now() - ${sql.raw(`interval '${NEW_ARRIVAL_DAYS} days'`)}`,
);
