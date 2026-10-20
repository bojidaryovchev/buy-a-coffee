import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { promotionProducts, type PromotionTargets } from "@catalog/db/schema";
import { uuidArray, type Executor } from "./history";
import type { PromotionInterval } from "./reference";

/**
 * Which products a promotion covers, and the rows that say so.
 *
 * The owner's choice is kept as it was made (`promotions.targets`: whole
 * brands, whole categories, single products, exclusions), and resolved here
 * into `promotion_products`, one row per product, at every refresh. So a
 * product the sync brings into a promoted brand joins at the next refresh,
 * and one the sync takes off sale leaves.
 *
 * A row is history once the promotion has started: it says the product was
 * sold at the reduced price from `added_at`, which the next promotion's 30-day
 * lowest price is computed from. So a product that leaves a started promotion
 * keeps its row, with `removed_at`; only before the start is a row simply
 * deleted.
 */

/**
 * The products that `targets` cover: chosen one by one, by brand, or by
 * category — a category covering every category below it — less the
 * exclusions, which win over everything.
 *
 * Every product the shop still has a page for, `missing` included: the sync
 * marks a product `missing` after one run that did not find it, and most are
 * back by the next (`lib/catalog/product-status.ts`). Its page stays up, so it
 * should show the promotion's price like the rest; and were it to leave and
 * come back, its 30-day lowest price would be taken again from its return,
 * when this promotion's own price is part of the history — and the badge
 * would go for nothing. Only `removed` products leave.
 *
 * One statement with its own aliases throughout.
 */
export async function resolveTargets(
  executor: Executor,
  targets: PromotionTargets,
): Promise<string[]> {
  const rows = (await executor.execute(sql`
    with recursive covered(id) as (
      select c.id from categories c where c.id = any(${uuidArray(targets.categoryIds)})
      union
      select child.id from categories child join covered on child.parent_id = covered.id
    )
    select p.id
    from products p
    where p.status in ('active', 'missing')
      and (
        p.id = any(${uuidArray(targets.productIds)})
        or p.brand_id = any(${uuidArray(targets.brandIds)})
        or exists (
          select 1
          from product_categories pc
          join covered on covered.id = pc.category_id
          where pc.product_id = p.id
        )
      )
      and not (p.id = any(${uuidArray(targets.excludedProductIds)}))
    order by p.id
  `)) as unknown as Array<{ id: string }>;
  return rows.map((row) => String(row.id));
}

export interface MembershipChange {
  /** New rows. */
  readonly joined: readonly string[];
  /** Rows of a started promotion that were stamped `removed_at`. */
  readonly left: readonly string[];
  /** Rows of a promotion that has not started, deleted. */
  readonly dropped: readonly string[];
  /**
   * Rows that had left and match again, with the time they had spent in the
   * promotion before they left: that stretch was sold at this promotion's
   * price, and the reference computed for the return must count it.
   */
  readonly rejoined: ReadonlyMap<string, PromotionInterval>;
}

export interface MembershipPromotion {
  readonly id: string;
  readonly percentOff: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Bring a promotion's rows in line with the products it covers now.
 *
 *  - A product that matches and has no row joins: `added_at` now.
 *  - A row whose product no longer matches leaves: `removed_at` now, if the
 *    promotion has started; deleted, if it has not.
 *  - A row that had left and matches again returns: `removed_at` cleared,
 *    `added_at` now, and its reference price is computed afresh from now.
 *
 * For a running or upcoming promotion only; an ended one is history and its
 * rows are never touched.
 */
export async function syncMembership(
  executor: Executor,
  promotion: MembershipPromotion,
  matching: readonly string[],
  now: Date,
): Promise<MembershipChange> {
  const rows = await executor
    .select({
      productId: promotionProducts.productId,
      addedAt: promotionProducts.addedAt,
      removedAt: promotionProducts.removedAt,
    })
    .from(promotionProducts)
    .where(eq(promotionProducts.promotionId, promotion.id));

  const wanted = new Set(matching);
  const existing = new Map(rows.map((row) => [row.productId, row]));
  const started = promotion.startsAt.getTime() <= now.getTime();

  const joined = matching.filter((id) => !existing.has(id));
  const leaving = rows.filter((row) => row.removedAt === null && !wanted.has(row.productId));
  const returning = rows.filter((row) => row.removedAt !== null && wanted.has(row.productId));

  if (joined.length > 0) {
    await executor
      .insert(promotionProducts)
      .values(joined.map((productId) => ({ promotionId: promotion.id, productId, addedAt: now })))
      .onConflictDoNothing();
  }

  const leavingIds = leaving.map((row) => row.productId);
  if (leavingIds.length > 0) {
    const these = and(
      eq(promotionProducts.promotionId, promotion.id),
      inArray(promotionProducts.productId, leavingIds),
    );
    if (started) {
      await executor.update(promotionProducts).set({ removedAt: now }).where(these);
    } else {
      await executor.delete(promotionProducts).where(these);
    }
  }

  const rejoined = new Map<string, PromotionInterval>();
  if (returning.length > 0) {
    for (const row of returning) {
      const from = Math.max(promotion.startsAt.getTime(), row.addedAt.getTime());
      const to = Math.min(promotion.endsAt.getTime(), (row.removedAt as Date).getTime());
      if (from < to) {
        rejoined.set(row.productId, { percentOff: promotion.percentOff, from, to });
      }
    }
    await executor
      .update(promotionProducts)
      .set({
        removedAt: null,
        addedAt: now,
        referencePrice: null,
        referenceAt: null,
        referenceFinal: false,
      })
      .where(
        and(
          eq(promotionProducts.promotionId, promotion.id),
          inArray(
            promotionProducts.productId,
            returning.map((row) => row.productId),
          ),
        ),
      );
  }

  return {
    joined,
    left: started ? leavingIds : [],
    dropped: started ? [] : leavingIds,
    rejoined,
  };
}
