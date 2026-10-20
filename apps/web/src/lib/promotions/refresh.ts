import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { promotionProducts, promotions } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { loadPriceHistory, type Executor } from "./history";
import { resolveTargets, syncMembership } from "./membership";
import {
  REFERENCE_WINDOW_MS,
  referenceInstant,
  referencePrice,
  toCents,
  type PromotionInterval,
} from "./reference";
import { promotionTargetsSchema } from "./schemas";
import { effectiveEnd, promotionStatus } from "./status";

/**
 * Bring every promotion that can still change in line with the catalog, and
 * work out the 30-day lowest prices that are not settled yet.
 *
 * Run after every save, stop and delete in the panel — all promotions, not
 * just the one changed, because one promotion's time on a product is part of
 * the next one's reference price — and every hour by the cron
 * (`/api/cron/promotions`), which is how a product the sync brings into a
 * promoted brand joins, and how a reference is settled once its promotion
 * has started.
 *
 * Which promotions: those not over yet; those that ended or were stopped
 * since they were last refreshed (to settle what they priced); and any with a
 * reference still open. For each one that is running or upcoming, membership
 * first (`membership.ts`), then, for every row whose reference is not final,
 * the reference (`reference.ts`): provisional while its moment T is still
 * ahead, recomputed at every refresh; computed at exactly T and marked final
 * at the first refresh after it; never touched again.
 *
 * One transaction under an advisory lock, so a save and the cron cannot
 * interleave their writes, and the shop never reads a half-done refresh.
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
  /** Promotions that started since they were last refreshed. */
  readonly started: number;
  /** Promotions that ended or were stopped since they were last refreshed. */
  readonly ended: number;
  readonly shopChanged: boolean;
}

const at = (instant: Date) => sql`${instant.toISOString()}::timestamptz`;

/** Any 64-bit number nothing else locks; derived from a name, for the reader. */
const LOCK = sql`hashtext('buy-a-coffee:promotions.refresh')`;

export async function refreshPromotions(now: Date = new Date()): Promise<RefreshReport> {
  return db.transaction((tx) => refreshWithin(tx, now));
}

async function refreshWithin(tx: Executor, now: Date): Promise<RefreshReport> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);

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
  const rejoined = new Map<string, ReadonlyMap<string, PromotionInterval>>();

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
    if (change.rejoined.size > 0) rejoined.set(promotion.id, change.rejoined);
    if (
      status === "running" &&
      change.joined.length + change.left.length + change.rejoined.size > 0
    ) {
      shopChanged = true;
    }
  }

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
      new Date(Math.min(...moments) - REFERENCE_WINDOW_MS),
    );

    const updates = open.map((row, index) => {
      const promotion = byId.get(row.promotionId)!;
      const moment = moments[index]!;
      const prices = history.prices.get(row.productId);
      const earlier: PromotionInterval[] = (history.intervals.get(row.productId) ?? []).filter(
        (interval) => interval.promotionId !== row.promotionId,
      );
      const own = rejoined.get(row.promotionId)?.get(row.productId);
      if (own) earlier.push(own);

      const reference = referencePrice({
        referenceAt: moment,
        changes: history.changes.get(row.productId) ?? [],
        currentPrice: prices?.currentPrice ?? null,
        override: prices?.override ?? null,
        earlier,
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

    /* One statement for every row; a final row is never written again. */
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
    started,
    ended,
    shopChanged,
  };
}
