import "server-only";
import { and, asc, desc, gt, inArray, lte, or, sql } from "drizzle-orm";
import { products, syncChanges } from "@catalog/db/schema";
import type { Database } from "@catalog/db";
import type { PriceChange, PromotionInterval } from "./reference";

/**
 * What `referencePrice` needs to know about a set of products, read in four
 * queries however many products there are: their prices now, the source's
 * price changes, and every promotion's time on each of them.
 *
 * Every query here is a plain select over one table, or written out with its
 * own aliases, so no column reference can bind to the wrong row (the trap in
 * docs/architecture.md, "One trap worth knowing about").
 */

/** The database, or a transaction on it: everything here runs in either. */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface ProductPrices {
  readonly currentPrice: string | null;
  readonly override: string | null;
  /** Epoch milliseconds. */
  readonly firstSeenAt: number | null;
}

/** A promotion's time on one product, with which promotion it was. */
export interface MemberInterval extends PromotionInterval {
  readonly promotionId: string;
}

export interface PriceHistory {
  readonly prices: ReadonlyMap<string, ProductPrices>;
  /** Per product, in the order they were made. */
  readonly changes: ReadonlyMap<string, readonly PriceChange[]>;
  /** Per product, every promotion it has been in. */
  readonly intervals: ReadonlyMap<string, readonly MemberInterval[]>;
}

/** A `uuid[]` parameter: one value, not a list of them. */
export const uuidArray = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`;

/** Epoch milliseconds of a timestamp column, as a number. */
const epochMs = (column: unknown) => sql<number>`(extract(epoch from ${column}) * 1000)::float8`;

/** Does this side of a change carry the price at all (`{ name, … }` alone does not)? */
const carries = (side: unknown) => sql<boolean>`coalesce(${side} ? 'currentPrice', false)`;

/**
 * The history of `productIds` that any window starting at or after
 * `windowStart` can need: every change after it that carries the price on
 * either side, and the last change at or before it that carries one after
 * (the price in effect when such a window opens). A change that carries no
 * price — `catalog:link` moving a product writes its name and address only —
 * is never read, so it cannot stand for "no price".
 */
export async function loadPriceHistory(
  executor: Executor,
  productIds: readonly string[],
  windowStart: Date,
): Promise<PriceHistory> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return { prices: new Map(), changes: new Map(), intervals: new Map() };

  const changeColumns = {
    productId: syncChanges.productId,
    at: epochMs(syncChanges.createdAt),
    hasBefore: carries(syncChanges.before),
    before: sql<string | null>`${syncChanges.before} ->> 'currentPrice'`,
    hasAfter: carries(syncChanges.after),
    after: sql<string | null>`${syncChanges.after} ->> 'currentPrice'`,
  };

  const [priceRows, recent, opening, memberRows] = await Promise.all([
    executor
      .select({
        id: products.id,
        currentPrice: products.currentPrice,
        override: products.retailPriceOverride,
        firstSeenAt: epochMs(products.firstSeenAt),
      })
      .from(products)
      .where(inArray(products.id, ids)),
    executor
      .select(changeColumns)
      .from(syncChanges)
      .where(
        and(
          inArray(syncChanges.productId, ids),
          gt(syncChanges.createdAt, windowStart),
          or(carries(syncChanges.before), carries(syncChanges.after)),
        ),
      )
      .orderBy(asc(syncChanges.createdAt), asc(syncChanges.id)),
    executor
      .selectDistinctOn([syncChanges.productId], changeColumns)
      .from(syncChanges)
      .where(
        and(
          inArray(syncChanges.productId, ids),
          lte(syncChanges.createdAt, windowStart),
          carries(syncChanges.after),
        ),
      )
      .orderBy(asc(syncChanges.productId), desc(syncChanges.createdAt), desc(syncChanges.id)),
    executor.execute(sql`
      select
        pp.product_id,
        pp.promotion_id,
        p.percent_off,
        (extract(epoch from greatest(p.starts_at, pp.added_at)) * 1000)::float8 as from_ms,
        (extract(epoch from least(
          p.ends_at,
          coalesce(p.stopped_at, p.ends_at),
          coalesce(pp.removed_at, p.ends_at)
        )) * 1000)::float8 as to_ms
      from promotion_products pp
      join promotions p on p.id = pp.promotion_id
      where pp.product_id = any(${uuidArray(ids)})
    `),
  ]);

  const prices = new Map<string, ProductPrices>(
    priceRows.map((row) => [
      row.id,
      {
        currentPrice: row.currentPrice,
        override: row.override,
        firstSeenAt: row.firstSeenAt === null ? null : Number(row.firstSeenAt),
      },
    ]),
  );

  const changes = new Map<string, PriceChange[]>();
  // The opening change first: it is older than every one after the window's start.
  for (const row of [...opening, ...recent]) {
    if (!row.productId) continue;
    const list = changes.get(row.productId) ?? [];
    list.push({
      at: Number(row.at),
      ...(row.hasBefore ? { before: row.before } : {}),
      ...(row.hasAfter ? { after: row.after } : {}),
    });
    changes.set(row.productId, list);
  }

  const intervals = new Map<string, MemberInterval[]>();
  for (const row of memberRows as unknown as Array<Record<string, unknown>>) {
    const productId = String(row.product_id);
    const list = intervals.get(productId) ?? [];
    list.push({
      promotionId: String(row.promotion_id),
      percentOff: Number(row.percent_off),
      from: Number(row.from_ms),
      to: Number(row.to_ms),
    });
    intervals.set(productId, list);
  }

  return { prices, changes, intervals };
}
