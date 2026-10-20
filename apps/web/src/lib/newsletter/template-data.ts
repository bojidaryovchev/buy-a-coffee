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
import type { PromotionFacts } from "./claims";
import { letterPlanOf, type LetterPlan } from "./letter-plan";
import type { MonthlyInput, PromotionInput, TemplatePromotion } from "./templates";
import { MAX_BLOCK_PRODUCTS, MAX_LETTER_PRODUCTS } from "./tokens";

/**
 * What the templates are written from (`templates.ts`): the catalog and the
 * shop's promotions as they stand, read with the storefront's own queries so
 * that "new", "reduced" and "orderable" mean in a letter what they mean on the
 * site.
 *
 *   - NEW is `isNewArrival` (`price-sql.ts`) since the later of: the moment
 *     the last monthly letter that went out was prepared (its plan's
 *     `preparedAt`), and 30 days ago — the "Ново" badge's own window. Only a
 *     monthly letter moves it: a promotion's letter or a blank one never said
 *     what was new. What arrived between a letter's preparation and its send
 *     was not in it, and is new in the next. As many as the letter has room
 *     for beside its reductions — twelve cards in all — in blocks of six.
 *   - REDUCED is the promotions listing's own `isReduced`: the shop's
 *     promotions and the source's reductions alike, the shop's own first.
 *   - A promotion's products are those whose own badge carries its whole
 *     percentage (`claims.ts`): priced by this promotion, with a struck price,
 *     and a reduction against it of at least the promotion's. The rest are
 *     counted, by why, for the owner (`LetterPlan.leftOut`).
 *
 * Read-only: nothing here writes, and the promotions are someone else's to
 * change (`lib/promotions`).
 */

const DAY = 24 * 60 * 60 * 1000;

/** How many reductions are read to find the shop's own among them. */
const REDUCED_READ = 60;
/** How many arrivals are read: the letter's room, and enough to say how many did not fit. */
const ARRIVALS_READ = 2 * MAX_LETTER_PRODUCTS;

/** The campaigns whose readers have it: a letter that "went out". */
const WENT_OUT = ["sent", "partial", "sending"] as const;

/** When the last letter that went out started; null before the first. For "once a month". */
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

/**
 * Where the last monthly letter that went out stopped counting what was new:
 * when its data was read, else (a letter without a plan) when it started.
 */
export async function lastMonthlyCutoff(): Promise<Date | null> {
  const [row] = await db
    .select({
      startedAt: newsletterCampaigns.startedAt,
      attachments: newsletterCampaigns.attachments,
    })
    .from(newsletterCampaigns)
    .where(
      and(
        eq(newsletterCampaigns.template, "monthly"),
        inArray(newsletterCampaigns.status, [...WENT_OUT]),
        isNotNull(newsletterCampaigns.startedAt),
      ),
    )
    .orderBy(desc(newsletterCampaigns.startedAt))
    .limit(1);
  if (!row) return null;
  const prepared = letterPlanOf(row.attachments)?.preparedAt;
  const at = prepared ? new Date(prepared) : row.startedAt;
  return at && !Number.isNaN(at.getTime()) ? at : row.startedAt;
}

export interface MonthlyPlan {
  readonly input: MonthlyInput;
  /** Where the new arrivals were counted from. */
  readonly since: Date;
  /** Whether `since` is the last monthly letter's cutoff, rather than 30 days back. */
  readonly sinceLetter: boolean;
  /** What the draft keeps of it (`letter-plan.ts`). */
  readonly plan: Omit<LetterPlan, "kind" | "version">;
}

/** The monthly letter's data, as of `now`. */
export async function monthlyPlan(now: Date = new Date()): Promise<MonthlyPlan> {
  const badgeWindow = new Date(now.getTime() - NEW_ARRIVAL_DAYS * DAY);
  const cutoff = await lastMonthlyCutoff();
  const sinceLetter = cutoff !== null && cutoff > badgeWindow;
  const since = sinceLetter ? cutoff : badgeWindow;

  const [arrivals, reductions] = await Promise.all([
    listNewProductCards({ since, limit: ARRIVALS_READ }),
    listReducedProductCards({ limit: REDUCED_READ }),
  ]);
  const arriving = new Set(arrivals.map((card) => card.slug));
  /* The same coffee twice in one letter looks like a mistake: a reduced new
     arrival is shown once, among the new. */
  const reduced = rankReductions(reductions.filter((card) => !arriving.has(card.slug))).slice(
    0,
    MAX_BLOCK_PRODUCTS,
  );
  const room = MAX_LETTER_PRODUCTS - reduced.length;
  const shownNew = arrivals.slice(0, room);
  const promotionIds = [
    ...new Set(reduced.flatMap((card) => (card.promotion ? [card.promotion.id] : []))),
  ];
  const newOverflow = arrivals.length - shownNew.length;
  return {
    since,
    sinceLetter,
    plan: {
      preparedAt: now.toISOString(),
      promotionIds,
      leftOut: newOverflow > 0 ? { newOverflow } : {},
    },
    input: {
      now,
      newArrivals: shownNew.map((card) => card.slug),
      reduced: reduced.map((card) => card.slug),
      promotions: (await promotionFacts(promotionIds)).map(asTemplate),
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

/** These promotions as they stand, soonest to end first; an id that names none is absent. */
export async function promotionFacts(ids: readonly (string | null)[]): Promise<PromotionRow[]> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id) && isUuid(id!)))];
  if (wanted.length === 0) return [];
  return db
    .select(promotionColumns)
    .from(promotions)
    .where(inArray(promotions.id, wanted))
    .orderBy(promotions.endsAt, promotions.id);
}

/** The facts the claims need (`claims.ts`), from rows. */
export const asFacts = (row: PromotionRow): PromotionFacts => ({ ...row });

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
  /** What the draft keeps of it: what was left out, and why. */
  readonly plan: Omit<LetterPlan, "kind" | "version">;
}

/**
 * One promotion's letter data, or null when it cannot be announced: it does
 * not exist, was stopped, or has ended.
 *
 * Its products are the members whose own card can carry the letter's "−X%":
 *
 *   - running: the card is priced by this promotion (not a larger one), shows
 *     a struck price, and its badge is at least the promotion's percentage —
 *     a member with no 30-day price on record shows no struck price, and one
 *     that was cheaper lately shows a smaller badge;
 *   - still to come: what its card will show when it starts, from the same
 *     facts — its 30-day "before" price on record (`promotion_products`) is
 *     at least its regular price now, so the badge will be the whole
 *     percentage. The send checks the real badges again (`claims.ts`).
 *
 * Only what can be ordered, the biggest saving first: the share off is the
 * same for all of them, so the dearest saves the reader most.
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
    .select({
      productId: promotionProducts.productId,
      reference: promotionProducts.referencePrice,
    })
    .from(promotionProducts)
    .where(and(eq(promotionProducts.promotionId, id), isNull(promotionProducts.removedAt)));
  const reference = new Map(members.map((member) => [member.productId, member.reference]));
  const cards = [
    ...(await listProductCardsByIds(members.map((member) => member.productId))).values(),
  ];

  const started = row.startsAt.getTime() <= now.getTime();
  const regular = (card: ProductCardView) =>
    Number(card.promotion?.regularPrice?.amount ?? card.price?.amount ?? 0);
  const orderable = cards.filter((card) => card.availability !== "out_of_stock");
  const ours = started ? orderable.filter((card) => card.promotion?.id === row.id) : orderable;
  const backed = (card: ProductCardView): boolean => {
    if (started) return card.oldPrice !== null && (card.discountPercent ?? 0) >= row.percentOff;
    const before = reference.get(card.id);
    return before !== null && before !== undefined && Number(before) >= regular(card);
  };
  const honest = ours
    .filter(backed)
    .sort(
      (a, b) =>
        regular(b) - regular(a) || a.name.localeCompare(b.name, "bg") || a.id.localeCompare(b.id),
    );
  const shown = honest.slice(0, MAX_BLOCK_PRODUCTS);
  const leftOut = {
    unbacked: ours.length - honest.length,
    soldOut: cards.length - orderable.length,
    elsewhere: orderable.length - ours.length,
    overflow: honest.length - shown.length,
  };
  return {
    row,
    plan: {
      preparedAt: now.toISOString(),
      promotionIds: [],
      leftOut: Object.fromEntries(Object.entries(leftOut).filter(([, value]) => value > 0)),
    },
    input: {
      now,
      promotion: asTemplate(row),
      members: shown.map((card) => card.slug),
    },
  };
}

/* -- what a letter claims, at the send ------------------------------------- */

/**
 * The facts `claimNotes` checks a campaign against: the promotion it
 * announces, and the ones its plan says its words name — as they stand now.
 */
export async function letterPromotions(campaign: {
  template: string | null;
  promotionId: string | null;
  attachments: Parameters<typeof letterPlanOf>[0];
}): Promise<{
  announced: PromotionFacts | null;
  announcedMissing: boolean;
  named: PromotionFacts[];
}> {
  const namedIds = letterPlanOf(campaign.attachments)?.promotionIds ?? [];
  const rows = await promotionFacts([campaign.promotionId, ...namedIds]);
  const announced = rows.find((row) => row.id === campaign.promotionId) ?? null;
  return {
    announced: announced ? asFacts(announced) : null,
    announcedMissing: campaign.template === "promotion" && !announced,
    named: rows.filter((row) => namedIds.includes(row.id)).map(asFacts),
  };
}
