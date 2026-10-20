import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { promotionProducts, promotions } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { loadPriceHistory, type Executor, type MemberInterval } from "./history";
import { resolveTargets, syncMembership } from "./membership";
import {
  fromCents,
  referenceInstant,
  referencePrice,
  referenceWindowStart,
  settledReferenceFloor,
  toCents,
  type PromotionInterval,
} from "./reference";
import { promotionTargetsSchema } from "./schemas";
import { effectiveEnd, promotionStatus } from "./status";

/**
 * Bring every promotion that can still change in line with the catalog, and
 * work out the 30-day lowest prices that are not settled yet.
 *
 * Run inside the panel's own writes — save, stop, delete, in the same
 * transaction, so the shop never sees a promotion's new dates or products
 * beside its old references — and every hour by the cron
 * (`/api/cron/promotions`), which is how a product the sync brings into a
 * promoted brand joins, and how a reference is settled once its promotion
 * has started. All promotions, not just the one changed: one promotion's time
 * on a product is part of the next one's reference.
 *
 * Which promotions: those not over yet; those that ended or were stopped
 * since they were last refreshed (to settle what they priced); and any with a
 * reference still open. For each one that is running or upcoming, membership
 * first (`membership.ts`); then, for every row whose reference is not final,
 * the reference (`reference.ts`): provisional while its moment T is still
 * ahead, recomputed at every refresh; computed at exactly T and marked final
 * at the first refresh after it. A final reference is never computed again,
 * but it may fall: a deeper promotion that took the product over since T
 * charged less, and the claim must not be above that (`settledReferenceFloor`).
 * It never rises.
 *
 * A product returning to a promotion it left gets a new row stint, and the
 * row's old stint is overwritten. Every stint overwritten in this refresh is
 * kept in memory and counted for every reference worked out in it — its own
 * promotion's and any other's — so a product returning to two promotions at
 * once keeps, in each, its earlier time in the deeper one.
 *
 * Under an advisory lock, so a save and the cron cannot interleave.
 *
 * `shopChanged` says whether a price the shop shows may have moved because of
 * what happened since the last refresh — a promotion started or ended, a
 * running one gained or lost a product, or a running product's reference
 * moved — which is when the cron revalidates the shop.
 */

export interface RefreshReport {
  /** Promotions looked at. */
  readonly promotions: number;
  readonly joined: number;
  readonly left: number;
  readonly rejoined: number;
  /** Rows of promotions not yet started, deleted because their product no longer matched. */
  readonly dropped: number;
  /** References worked out, provisional or final. */
  readonly computed: number;
  /** Of those, the ones settled for good. */
  readonly finalized: number;
  /** Settled references brought down by a deeper promotion since. */
  readonly lowered: number;
  /** Promotions that started since they were last refreshed. */
  readonly started: number;
  /** Promotions that ended or were stopped since they were last refreshed. */
  readonly ended: number;
  readonly shopChanged: boolean;
}

const at = (instant: Date) => sql`${instant.toISOString()}::timestamptz`;

/** Any 64-bit number nothing else locks; derived from a name, for the reader. */
const LOCK = sql`hashtext('buy-a-coffee:promotions.refresh')`;

/**
 * Take the promotions lock for the rest of the transaction. A write that
 * refreshes takes it before it writes, so it never holds a promotion's row
 * while waiting for a cron that wants the same row (a deadlock).
 */
export async function lockPromotions(tx: Executor): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
}

/** A refresh of its own, as the cron runs it. */
export async function refreshPromotions(now: Date = new Date()): Promise<RefreshReport> {
  return db.transaction((tx) => refreshWithin(tx, now));
}

/** The refresh, inside a transaction the caller owns (and may have written in). */
export async function refreshWithin(tx: Executor, now: Date): Promise<RefreshReport> {
  await lockPromotions(tx);

  const candidates = await tx
    .select()
    .from(promotions)
    .where(
      sql`(${promotions.stoppedAt} is null and ${promotions.endsAt} > ${at(now)})
        or ${promotions.refreshedAt} is null
        or ${promotions.refreshedAt} < least(${promotions.endsAt}, coalesce(${promotions.stoppedAt}, ${promotions.endsAt}))
        or exists (
          select 1 from promotion_products open_row
          where open_row.promotion_id = "promotions"."id" and not open_row.reference_final
        )`,
    );

  let joined = 0;
  let left = 0;
  let rejoinedCount = 0;
  let dropped = 0;
  let started = 0;
  let ended = 0;
  let shopChanged = false;

  const byId = new Map(candidates.map((promotion) => [promotion.id, promotion]));
  /* Stints overwritten by a return in this refresh, by product: the history
     as it was before this refresh rewrote it. */
  const overwritten = new Map<string, MemberInterval[]>();

  for (const promotion of candidates) {
    const status = promotionStatus(promotion, now);
    const last = promotion.refreshedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    if (promotion.startsAt.getTime() <= now.getTime() && last < promotion.startsAt.getTime()) {
      started += 1;
      shopChanged = true;
    }
    const end = effectiveEnd(promotion).getTime();
    if (end <= now.getTime() && last < end) {
      ended += 1;
      shopChanged = true;
    }

    if (status !== "running" && status !== "upcoming") continue;
    const targets = promotionTargetsSchema.safeParse(promotion.targets);
    if (!targets.success) {
      // Never read as "covers nothing": that would take every product out.
      console.error(
        JSON.stringify({
          level: "error",
          msg: "promotions.targets_unreadable",
          promotionId: promotion.id,
        }),
      );
      continue;
    }
    const matching = await resolveTargets(tx, targets.data);
    const change = await syncMembership(tx, promotion, matching, now);
    joined += change.joined.length;
    left += change.left.length;
    dropped += change.dropped.length;
    rejoinedCount += change.rejoined.size;
    for (const [productId, stint] of change.rejoined) {
      const list = overwritten.get(productId) ?? [];
      list.push({ ...stint, promotionId: promotion.id });
      overwritten.set(productId, list);
    }
    if (
      status === "running" &&
      change.joined.length + change.left.length + change.rejoined.size > 0
    ) {
      shopChanged = true;
    }
  }

  /** Every stint a product has had in another promotion — or its own, overwritten. */
  const stintsFor = (
    history: { intervals: ReadonlyMap<string, readonly MemberInterval[]> },
    productId: string,
    promotionId: string,
  ): PromotionInterval[] => [
    ...(history.intervals.get(productId) ?? []).filter(
      (interval) => interval.promotionId !== promotionId,
    ),
    ...(overwritten.get(productId) ?? []),
  ];

  /* Every reference still open, membership now settled. */
  const ids = candidates.map((promotion) => promotion.id);
  const open =
    ids.length === 0
      ? []
      : await tx
          .select({
            promotionId: promotionProducts.promotionId,
            productId: promotionProducts.productId,
            addedAt: promotionProducts.addedAt,
            removedAt: promotionProducts.removedAt,
            referencePrice: promotionProducts.referencePrice,
          })
          .from(promotionProducts)
          .where(
            and(
              inArray(promotionProducts.promotionId, ids),
              eq(promotionProducts.referenceFinal, false),
            ),
          );

  let computed = 0;
  let finalized = 0;
  if (open.length > 0) {
    const moments = open.map((row) =>
      referenceInstant(byId.get(row.promotionId)!.startsAt, row.addedAt).getTime(),
    );
    const history = await loadPriceHistory(
      tx,
      open.map((row) => row.productId),
      new Date(Math.min(...moments.map(referenceWindowStart))),
    );

    const updates = open.map((row, index) => {
      const promotion = byId.get(row.promotionId)!;
      const moment = moments[index]!;
      const prices = history.prices.get(row.productId);
      const reference = referencePrice({
        referenceAt: moment,
        changes: history.changes.get(row.productId) ?? [],
        currentPrice: prices?.currentPrice ?? null,
        override: prices?.override ?? null,
        firstSeenAt: prices?.firstSeenAt ?? null,
        earlier: stintsFor(history, row.productId, row.promotionId),
      });
      const final = now.getTime() >= moment;
      computed += 1;
      if (final) finalized += 1;
      if (
        promotionStatus(promotion, now) === "running" &&
        row.removedAt === null &&
        toCents(reference) !== toCents(row.referencePrice)
      ) {
        shopChanged = true;
      }
      return {
        promotion_id: row.promotionId,
        product_id: row.productId,
        price: reference,
        at: new Date(moment).toISOString(),
        final,
      };
    });

    /* One statement for every row; a final row is never written again here. */
    await tx.execute(sql`
      update promotion_products pp
      set reference_price = v.price,
          reference_at = v.at,
          reference_final = v.final
      from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
        as v(promotion_id uuid, product_id uuid, price numeric(12, 2), at timestamptz, final boolean)
      where pp.promotion_id = v.promotion_id
        and pp.product_id = v.product_id
        and not pp.reference_final
    `);
  }

  /* Settled references of running promotions, brought down to what a deeper
     promotion has charged since. */
  const settled = (await tx.execute(sql`
    select
      pp.promotion_id,
      pp.product_id,
      pp.reference_price::text as reference_price,
      (extract(epoch from pp.reference_at) * 1000)::float8 as reference_ms,
      p.percent_off
    from promotion_products pp
    join promotions p on p.id = pp.promotion_id
    where pp.reference_final
      and pp.removed_at is null
      and pp.reference_price is not null
      and pp.reference_at is not null
      and p.stopped_at is null
      and p.starts_at <= ${at(now)}
      and p.ends_at > ${at(now)}
  `)) as unknown as Array<{
    promotion_id: string;
    product_id: string;
    reference_price: string;
    reference_ms: number | string;
    percent_off: number | string;
  }>;

  let lowered = 0;
  if (settled.length > 0) {
    const history = await loadPriceHistory(
      tx,
      settled.map((row) => row.product_id),
      new Date(Math.min(...settled.map((row) => Number(row.reference_ms)))),
    );
    const falls: { promotion_id: string; product_id: string; price: string }[] = [];
    for (const row of settled) {
      const prices = history.prices.get(row.product_id);
      const floor = settledReferenceFloor({
        referenceAt: Number(row.reference_ms),
        now: now.getTime(),
        percentOff: Number(row.percent_off),
        changes: history.changes.get(row.product_id) ?? [],
        currentPrice: prices?.currentPrice ?? null,
        override: prices?.override ?? null,
        others: stintsFor(history, row.product_id, row.promotion_id),
      });
      const stored = toCents(row.reference_price);
      if (floor !== null && stored !== null && floor < stored) {
        falls.push({
          promotion_id: row.promotion_id,
          product_id: row.product_id,
          price: fromCents(floor),
        });
      }
    }
    if (falls.length > 0) {
      lowered = falls.length;
      shopChanged = true;
      await tx.execute(sql`
        update promotion_products pp
        set reference_price = v.price
        from jsonb_to_recordset(${JSON.stringify(falls)}::jsonb)
          as v(promotion_id uuid, product_id uuid, price numeric(12, 2))
        where pp.promotion_id = v.promotion_id
          and pp.product_id = v.product_id
          and pp.reference_price > v.price
      `);
    }
  }

  if (ids.length > 0) {
    await tx.update(promotions).set({ refreshedAt: now }).where(inArray(promotions.id, ids));
  }

  return {
    promotions: candidates.length,
    joined,
    left,
    rejoined: rejoinedCount,
    dropped,
    computed,
    finalized,
    lowered,
    started,
    ended,
    shopChanged,
  };
}
