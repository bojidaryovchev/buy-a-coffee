import "server-only";
import { and, asc, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { promotionProducts, promotions, type PromotionTargets } from "@catalog/db/schema";
import { db } from "@/lib/db";
import type { Executor } from "./history";
import { periodFromDays, type Day } from "./days";
import { promotionTargetsSchema } from "./schemas";
import { effectiveEnd, promotionStatus, type PromotionStatus } from "./status";

/**
 * The promotions table for the panel: read a promotion, list them, and the
 * four writes the editor makes. The rules about which write is allowed when
 * (`status.ts`) are checked in the statements themselves, not only before
 * them, so a press that arrives after midnight changed the answer — a stop
 * for a promotion that has just ended, a delete for one that has just
 * started — changes nothing.
 */

export interface PromotionRecord {
  readonly id: string;
  readonly name: string;
  readonly label: string | null;
  readonly percentOff: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly stoppedAt: Date | null;
  readonly targets: PromotionTargets;
  readonly refreshedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What a tab was drawn from, sent back with every save: the last write, to the millisecond. */
export function promotionVersion(promotion: { updatedAt: Date }): string {
  return String(promotion.updatedAt.getTime());
}

/** Stored targets, read defensively: a row written by hand must not break the page. */
function readTargets(value: unknown): PromotionTargets {
  const parsed = promotionTargetsSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { productIds: [], brandIds: [], categoryIds: [], excludedProductIds: [] };
}

function toRecord(row: typeof promotions.$inferSelect): PromotionRecord {
  return { ...row, targets: readTargets(row.targets) };
}

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function getPromotion(id: string): Promise<PromotionRecord | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(promotions).where(eq(promotions.id, id));
  return row ? toRecord(row) : null;
}

export interface PromotionListRow extends PromotionRecord {
  readonly status: PromotionStatus;
  /** Products in it now, or, once it is over, when it ended. */
  readonly productCount: number;
}

/** Every promotion, newest start first, with how many products each covers. */
export async function listPromotions(now: Date): Promise<PromotionListRow[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(promotions).orderBy(desc(promotions.startsAt), desc(promotions.createdAt)),
    db
      .select({
        promotionId: promotionProducts.promotionId,
        count: sql<number>`count(*)::int`,
      })
      .from(promotionProducts)
      .where(isNull(promotionProducts.removedAt))
      .groupBy(promotionProducts.promotionId),
  ]);
  const countOf = new Map(counts.map((row) => [row.promotionId, Number(row.count)]));
  return rows.map((row) => ({
    ...toRecord(row),
    status: promotionStatus(row, now),
    productCount: countOf.get(row.id) ?? 0,
  }));
}

export interface PromotionMember {
  readonly productId: string;
  readonly referencePrice: string | null;
  readonly referenceFinal: boolean;
  readonly addedAt: Date;
  readonly removedAt: Date | null;
}

export async function listMembers(promotionId: string): Promise<PromotionMember[]> {
  return db
    .select({
      productId: promotionProducts.productId,
      referencePrice: promotionProducts.referencePrice,
      referenceFinal: promotionProducts.referenceFinal,
      addedAt: promotionProducts.addedAt,
      removedAt: promotionProducts.removedAt,
    })
    .from(promotionProducts)
    .where(eq(promotionProducts.promotionId, promotionId))
    .orderBy(asc(promotionProducts.addedAt));
}

export interface PromotionValues {
  readonly name: string;
  readonly label: string | null;
  readonly percentOff: number;
  readonly startDay: Day;
  readonly endDay: Day;
  readonly targets: PromotionTargets;
}

/*
 * The writes take the transaction they run in: the panel's actions write and
 * refresh in one (`actions.ts`), so a failed refresh takes the write with it.
 */

export async function insertPromotion(
  tx: Executor,
  values: PromotionValues,
  now: Date,
): Promise<string> {
  const { startsAt, endsAt } = periodFromDays(values.startDay, values.endDay);
  const [row] = await tx
    .insert(promotions)
    .values({
      name: values.name,
      label: values.label,
      percentOff: values.percentOff,
      startsAt,
      endsAt,
      targets: values.targets,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: promotions.id });
  return row!.id;
}

export type UpdateOutcome =
  | { ok: true; version: string }
  | { ok: false; reason: "missing" | "over" | "locked" }
  /** Changed since the tab was drawn; `version` is the one it holds now. */
  | { ok: false; reason: "conflict"; version: string };

/**
 * Save the editor over the promotion this tab was showing, and only that
 * version of it. A running promotion keeps its percentage and its start
 * whatever is posted (`locked` if they differ); one that is over is not
 * written at all.
 *
 * A promotion that goes live by this save — it was upcoming and its first
 * day is now today — has its products' `added_at` moved to now: the reduction
 * begins for them at this moment, not at midnight, and their 30-day lowest
 * price is taken from here (`reference.ts`).
 */
export async function updatePromotion(
  tx: Executor,
  id: string,
  version: string,
  values: PromotionValues,
  now: Date,
): Promise<UpdateOutcome> {
  /* FOR NO KEY UPDATE, not FOR UPDATE: it keeps two saves of this row apart,
     but not an order being recorded at this promotion's price, which holds
     the row FOR KEY SHARE (`lib/orders/record.ts`) only so that it cannot be
     deleted under it. A save changes no key; that order must not wait for
     the whole save and refresh. */
  const [current] = await tx
    .select()
    .from(promotions)
    .where(eq(promotions.id, id))
    .for("no key update");
  if (!current) return { ok: false, reason: "missing" };
  const held = promotionVersion(current);
  if (held !== version) return { ok: false, reason: "conflict", version: held };

  const status = promotionStatus(current, now);
  if (status === "ended" || status === "stopped") return { ok: false, reason: "over" };

  const { startsAt, endsAt } = periodFromDays(values.startDay, values.endDay);
  if (
    status === "running" &&
    (values.percentOff !== current.percentOff || startsAt.getTime() !== current.startsAt.getTime())
  ) {
    return { ok: false, reason: "locked" };
  }

  await tx
    .update(promotions)
    .set({
      name: values.name,
      label: values.label,
      percentOff: values.percentOff,
      startsAt,
      endsAt,
      targets: values.targets,
      updatedAt: now,
    })
    .where(eq(promotions.id, id));

  if (status === "upcoming" && startsAt.getTime() <= now.getTime()) {
    await tx
      .update(promotionProducts)
      .set({ addedAt: now })
      .where(
        and(
          eq(promotionProducts.promotionId, id),
          isNull(promotionProducts.removedAt),
          eq(promotionProducts.referenceFinal, false),
        ),
      );
  }
  return { ok: true, version: String(now.getTime()) };
}

/** "Спри сега": only a running promotion, and only once. */
export async function stopPromotion(tx: Executor, id: string, now: Date): Promise<boolean> {
  const stopped = await tx
    .update(promotions)
    .set({ stoppedAt: now, updatedAt: now })
    .where(
      and(
        eq(promotions.id, id),
        isNull(promotions.stoppedAt),
        lte(promotions.startsAt, now),
        gt(promotions.endsAt, now),
      ),
    )
    .returning({ id: promotions.id });
  return stopped.length > 0;
}

/**
 * "Изтрий": only before the start. A promotion that has started priced
 * something, and that is part of the next reduction's 30-day history; it is
 * never deleted. Its rows go with it (`on delete cascade`).
 */
export async function deletePromotion(tx: Executor, id: string, now: Date): Promise<boolean> {
  /* A DELETE locks the row FOR UPDATE, the one lock that waits for an order
     holding it FOR KEY SHARE while it records a line naming the promotion:
     that line's foreign key must be in place before the row can go (and
     `on delete set null` then clears it). Not to be weakened like the save's. */
  const deleted = await tx
    .delete(promotions)
    .where(and(eq(promotions.id, id), isNull(promotions.stoppedAt), gt(promotions.startsAt, now)))
    .returning({ id: promotions.id });
  return deleted.length > 0;
}

/** For the dashboard tile: what runs, what ends first, what is coming. */
export async function promotionSummary(now: Date): Promise<{
  running: number;
  nearestEnd: Date | null;
  upcoming: number;
}> {
  const rows = await db
    .select({
      startsAt: promotions.startsAt,
      endsAt: promotions.endsAt,
      stoppedAt: promotions.stoppedAt,
    })
    .from(promotions)
    .where(and(isNull(promotions.stoppedAt), gt(promotions.endsAt, now)));
  let running = 0;
  let upcoming = 0;
  let nearestEnd: Date | null = null;
  for (const row of rows) {
    if (promotionStatus(row, now) === "running") {
      running += 1;
      const end = effectiveEnd(row);
      if (nearestEnd === null || end.getTime() < nearestEnd.getTime()) nearestEnd = end;
    } else {
      upcoming += 1;
    }
  }
  return { running, nearestEnd, upcoming };
}

/** Another promotion a product is in at the same time, as the preview weighs it. */
export interface OverlappingMembership {
  readonly id: string;
  readonly name: string;
  readonly percentOff: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Its reference for the product: what the shop strikes while it wins. */
  readonly referencePrice: string | null;
}

/**
 * Other promotions that put the same product on sale during `period`:
 * for the preview, which shows what the shop will show where one of them
 * wins. Stopped ones are not on sale; one that is over cannot overlap a
 * period that has not ended.
 */
export async function overlappingMemberships(
  productIds: readonly string[],
  period: { startsAt: Date; endsAt: Date },
  excludeId: string | null,
): Promise<Map<string, OverlappingMembership[]>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({
      productId: promotionProducts.productId,
      id: promotions.id,
      name: promotions.name,
      percentOff: promotions.percentOff,
      startsAt: promotions.startsAt,
      endsAt: promotions.endsAt,
      referencePrice: promotionProducts.referencePrice,
    })
    .from(promotionProducts)
    .innerJoin(promotions, eq(promotions.id, promotionProducts.promotionId))
    .where(
      and(
        isNull(promotionProducts.removedAt),
        isNull(promotions.stoppedAt),
        sql`${promotionProducts.productId} = any(${sql.param([...productIds])}::uuid[])`,
        sql`${promotions.startsAt} < ${period.endsAt.toISOString()}::timestamptz`,
        sql`${promotions.endsAt} > ${period.startsAt.toISOString()}::timestamptz`,
        excludeId ? sql`${promotions.id} <> ${excludeId}::uuid` : undefined,
      ),
    );
  const byProduct = new Map<string, OverlappingMembership[]>();
  for (const { productId, ...membership } of rows) {
    const list = byProduct.get(productId) ?? [];
    list.push(membership);
    byProduct.set(productId, list);
  }
  return byProduct;
}
