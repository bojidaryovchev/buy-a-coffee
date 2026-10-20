import "server-only";
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { newsletterCampaigns, products, promotionProducts, promotions } from "@catalog/db/schema";
import { db } from "@/lib/db";
import {
  listNewProductCards,
  listProductCardsByIds,
  listReducedProductCards,
} from "@/lib/catalog/queries";
import type { ProductCardView } from "@/lib/catalog/types";
import { NEW_ARRIVAL_DAYS } from "@/lib/catalog/price-sql";
import { isUuid } from "./campaigns";
import type { MonthlyInput, PromotionInput, TemplatePromotion } from "./templates";
import { MAX_BLOCK_PRODUCTS } from "./tokens";

/**
 * What the templates are written from (`templates.ts`): the catalog and the
 * shop's promotions as they stand, read with the storefront's own queries so
 * that "new", "reduced" and "orderable" mean in a letter what they mean on the
 * site.
 *
 *   - NEW is `isNewArrival` (`price-sql.ts`) since the last letter that went
 *     out — the start of the latest campaign that is sent, partly sent or
 *     still sending — or, before the first, the last 30 days. So a letter
 *     never announces what the previous one did, and an import of the catalog
 *     is never "new".
 *   - REDUCED is the promotions listing's own `isReduced`: the shop's
 *     promotions and the source's reductions alike. The shop's own come first,
 *     the larger reduction first, because they are the ones the letter names.
 *   - A promotion's products are its members that are on sale and can be
 *     ordered, the biggest saving first.
 *
 * Read-only: nothing here writes, and the promotions are someone else's to
 * change (`lib/promotions`).
 */

const DAY = 24 * 60 * 60 * 1000;

/** How many reductions are read to find the shop's own among them. */
const REDUCED_READ = 60;

/** The campaigns whose readers have it: a letter that "went out". */
const WENT_OUT = ["sent", "partial", "sending"] as const;

/** When the last letter that went out started; null before the first. */
export async function lastLetterStart(): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: newsletterCampaigns.startedAt })
    .from(newsletterCampaigns)
    .where(
      and(
        inArray(newsletterCampaigns.status, [...WENT_OUT]),
        isNotNull(newsletterCampaigns.startedAt),
      ),
    )
    .orderBy(desc(newsletterCampaigns.startedAt))
    .limit(1);
  return row?.startedAt ?? null;
}

export interface MonthlyPlan {
  readonly input: MonthlyInput;
  /** Where the new arrivals were counted from: the last letter's start, else 30 days back. */
  readonly since: Date;
  /** Whether `since` is the last letter's start. */
  readonly sinceLetter: boolean;
}

/** The monthly letter's data, as of `now`. */
export async function monthlyPlan(now: Date = new Date()): Promise<MonthlyPlan> {
  const last = await lastLetterStart();
  const since = last ?? new Date(now.getTime() - NEW_ARRIVAL_DAYS * DAY);
  const [arrivals, reductions] = await Promise.all([
    listNewProductCards({ since, limit: MAX_BLOCK_PRODUCTS }),
    listReducedProductCards({ limit: REDUCED_READ }),
  ]);
  const newSlugs = new Set(arrivals.map((card) => card.slug));
  /* The same coffee twice in one letter looks like a mistake: a reduced new
     arrival is shown once, among the new. */
  const reduced = rankReductions(reductions.filter((card) => !newSlugs.has(card.slug)));
  const promotionIds = [
    ...new Set(reduced.flatMap((card) => (card.promotion ? [card.promotion.id] : []))),
  ];
  return {
    since,
    sinceLetter: last !== null,
    input: {
      now,
      newArrivals: arrivals.map((card) => card.slug),
      reduced: reduced.slice(0, MAX_BLOCK_PRODUCTS).map((card) => card.slug),
      promotions: await promotionsByIds(promotionIds),
    },
  };
}

/**
 * The shop's own promotions first, the larger reduction first; then the
 * source's reductions in the order the catalog ranks them (the share taken
 * off). Stable, so equal ones keep the catalog's order.
 */
function rankReductions(cards: readonly ProductCardView[]): ProductCardView[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const pa = a.card.promotion?.percentOff ?? -1;
      const pb = b.card.promotion?.percentOff ?? -1;
      return pb - pa || a.index - b.index;
    })
    .map(({ card }) => card);
}

const promotionColumns = {
  id: promotions.id,
  name: promotions.name,
  label: promotions.label,
  percentOff: promotions.percentOff,
  startsAt: promotions.startsAt,
  endsAt: promotions.endsAt,
  stoppedAt: promotions.stoppedAt,
};

type PromotionRow = {
  id: string;
  name: string;
  label: string | null;
  percentOff: number;
  startsAt: Date;
  endsAt: Date;
  stoppedAt: Date | null;
};

const asTemplate = (row: PromotionRow): TemplatePromotion => ({
  id: row.id,
  label: row.label?.trim() || null,
  percentOff: row.percentOff,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
});

async function promotionsByIds(ids: readonly string[]): Promise<TemplatePromotion[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select(promotionColumns)
    .from(promotions)
    .where(inArray(promotions.id, [...ids]))
    .orderBy(promotions.endsAt, promotions.id);
  return rows.map(asTemplate);
}

/* -- one promotion ---------------------------------------------------------- */

/** A promotion the owner can still announce: not stopped, not ended. */
const announceable = (now: Date) => and(isNull(promotions.stoppedAt), gt(promotions.endsAt, now));

export interface PromotionChoice extends PromotionRow {
  /** Its members on sale that can be ordered now. */
  readonly products: number;
}

/** Running and upcoming promotions, soonest first, for "Обява за промоция". */
export async function promotionChoices(now: Date = new Date()): Promise<PromotionChoice[]> {
  const rows = await db
    .select(promotionColumns)
    .from(promotions)
    .where(announceable(now))
    .orderBy(promotions.startsAt, promotions.id);
  if (rows.length === 0) return [];
  /* Counted in a grouped query of its own and merged here, not as a
     correlated subquery beside the columns (docs/architecture.md, "One trap
     worth knowing about"). */
  const counts = await db
    .select({ id: promotionProducts.promotionId, n: count() })
    .from(promotionProducts)
    .innerJoin(products, eq(products.id, promotionProducts.productId))
    .where(
      and(
        inArray(
          promotionProducts.promotionId,
          rows.map((row) => row.id),
        ),
        isNull(promotionProducts.removedAt),
        eq(products.status, "active"),
        ne(products.availability, "out_of_stock"),
      ),
    )
    .groupBy(promotionProducts.promotionId);
  const byId = new Map(counts.map((row) => [row.id, row.n]));
  return rows.map((row) => ({ ...row, products: byId.get(row.id) ?? 0 }));
}

export interface PromotionPlan {
  readonly input: PromotionInput;
  readonly row: PromotionRow;
}

/**
 * One promotion's letter data, or null when it cannot be announced: it does
 * not exist, was stopped, or has ended.
 *
 * Its products are its members as the storefront's cards draw them — on sale,
 * then here also orderable — the biggest saving first: the regular price is
 * the same share off for all of them, so the dearest saves the reader most.
 */
export async function promotionPlan(
  id: string,
  now: Date = new Date(),
): Promise<PromotionPlan | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select(promotionColumns)
    .from(promotions)
    .where(and(eq(promotions.id, id), announceable(now)))
    .limit(1);
  if (!row) return null;
  const members = await db
    .select({ productId: promotionProducts.productId })
    .from(promotionProducts)
    .where(and(eq(promotionProducts.promotionId, id), isNull(promotionProducts.removedAt)));
  const cards = await listProductCardsByIds(members.map((member) => member.productId));
  const regular = (card: ProductCardView) =>
    Number(card.promotion?.regularPrice?.amount ?? card.price?.amount ?? 0);
  const ordered = [...cards.values()]
    .filter((card) => card.availability !== "out_of_stock")
    .sort(
      (a, b) =>
        regular(b) - regular(a) || a.name.localeCompare(b.name, "bg") || a.id.localeCompare(b.id),
    );
  return {
    row,
    input: {
      now,
      promotion: asTemplate(row),
      members: ordered.slice(0, MAX_BLOCK_PRODUCTS).map((card) => card.slug),
    },
  };
}

/** The promotion a draft announces, for the composer's notes about its days. */
export async function promotionDays(
  id: string | null,
): Promise<Pick<PromotionRow, "startsAt" | "endsAt" | "stoppedAt" | "name" | "label"> | null> {
  if (!id || !isUuid(id)) return null;
  const [row] = await db
    .select({
      startsAt: promotions.startsAt,
      endsAt: promotions.endsAt,
      stoppedAt: promotions.stoppedAt,
      name: promotions.name,
      label: promotions.label,
    })
    .from(promotions)
    .where(eq(promotions.id, id))
    .limit(1);
  return row ?? null;
}
