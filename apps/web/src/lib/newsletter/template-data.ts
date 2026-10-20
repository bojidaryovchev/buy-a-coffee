import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { newsletterCampaigns, promotionProducts, promotions } from "@catalog/db/schema";
import { db } from "@/lib/db";
import {
  listNewProductCards,
  listProductCardsByIds,
  listReducedProductCards,
} from "@/lib/catalog/queries";
import type { ProductCardView } from "@/lib/catalog/types";
import { NEW_ARRIVAL_DAYS } from "@/lib/catalog/price-sql";
import { isUuid } from "./campaigns";
import { plannedFrom } from "./claims";
import { promotionFacts, type PromotionRow } from "./claims-data";
import { letterPlanOf, type LetterPlan } from "./letter-plan";
import {
  promotionLine,
  type MonthlyInput,
  type PromotionInput,
  type TemplatePromotion,
} from "./templates";
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
 * when its data was read (its plan's `preparedAt`). A monthly letter without
 * a plan — a copy of one (`duplicateCampaign`) — was not written from the
 * catalog, and moves nothing.
 */
export async function lastMonthlyCutoff(): Promise<Date | null> {
  const rows = await db
    .select({ attachments: newsletterCampaigns.attachments })
    .from(newsletterCampaigns)
    .where(
      and(
        eq(newsletterCampaigns.template, "monthly"),
        inArray(newsletterCampaigns.status, [...WENT_OUT]),
        isNotNull(newsletterCampaigns.startedAt),
        sql`${newsletterCampaigns.attachments} @> '[{"kind":"letter-plan"}]'::jsonb`,
      ),
    )
    .orderBy(desc(newsletterCampaigns.startedAt))
    .limit(1);
  const prepared = rows[0] ? letterPlanOf(rows[0].attachments)?.preparedAt : undefined;
  const at = prepared ? new Date(prepared) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
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
  /* The same coffee twice in one letter looks like a mistake: a reduced new
     arrival is shown once — among the new when the letter has room for it
     there, else among the reductions if they have room. The reductions take
     a block's worth at most, the new arrivals the rest of the twelve; as the
     reductions grow the new arrivals' room shrinks, so this settles in a
     pass or two. */
  const ranked = rankReductions(reductions);
  let reduced: ProductCardView[] = [];
  let shownNew: ProductCardView[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    shownNew = arrivals.slice(0, MAX_LETTER_PRODUCTS - reduced.length);
    const shown = new Set(shownNew.map((card) => card.slug));
    const next = ranked.filter((card) => !shown.has(card.slug)).slice(0, MAX_BLOCK_PRODUCTS);
    const same =
      next.length === reduced.length && next.every((card, at) => card.slug === reduced[at]!.slug);
    reduced = next;
    if (same) break;
  }
  shownNew = arrivals.slice(0, MAX_LETTER_PRODUCTS - reduced.length);
  const inLetter = new Set([...shownNew, ...reduced].map((card) => card.slug));
  const newOverflow = arrivals.filter((card) => !inLetter.has(card.slug)).length;

  /* Each promotion the letter will name, as it stands, with the line the
     template writes for it and the reductions it prices there. */
  const priced = new Map<string, string[]>();
  for (const card of reduced) {
    if (card.promotion)
      priced.set(card.promotion.id, [...(priced.get(card.promotion.id) ?? []), card.slug]);
  }
  const rows = await promotionFacts([...priced.keys()]);
  return {
    since,
    sinceLetter,
    plan: {
      preparedAt: now.toISOString(),
      named: rows.map((row) =>
        plannedFrom(row, promotionLine(asTemplate(row)), priced.get(row.id) ?? []),
      ),
      announced: null,
      leftOut: newOverflow > 0 ? { newOverflow } : {},
    },
    input: {
      now,
      newArrivals: shownNew.map((card) => card.slug),
      reduced: reduced.map((card) => card.slug),
      promotions: rows.map(asTemplate),
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

const asTemplate = (row: PromotionRow): TemplatePromotion => ({
  id: row.id,
  label: row.label?.trim() || null,
  percentOff: row.percentOff,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
});

/* -- one promotion ---------------------------------------------------------- */

/** A promotion the owner can still announce: not stopped, not ended. */
const announceable = (now: Date) => and(isNull(promotions.stoppedAt), gt(promotions.endsAt, now));

const promotionColumns = {
  id: promotions.id,
  name: promotions.name,
  label: promotions.label,
  percentOff: promotions.percentOff,
  startsAt: promotions.startsAt,
  endsAt: promotions.endsAt,
  stoppedAt: promotions.stoppedAt,
};

/** Why members of a promotion cannot be in its letter, counted. */
export interface LeftOutMembers {
  /** Their own badge cannot carry the promotion's percentage. */
  readonly unbacked: number;
  readonly soldOut: number;
  /** A larger promotion prices them. */
  readonly elsewhere: number;
}

/**
 * A promotion's members whose own card can carry its letter's "−X%" — the
 * biggest saving first — and how many of the rest were left out, by why:
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
 * Only what can be ordered. The share off is the same for all of them, so
 * the dearest saves the reader most.
 */
async function honestMembers(
  row: PromotionRow,
  now: Date,
): Promise<{ honest: ProductCardView[]; leftOut: LeftOutMembers }> {
  const members = await db
    .select({
      productId: promotionProducts.productId,
      reference: promotionProducts.referencePrice,
    })
    .from(promotionProducts)
    .where(and(eq(promotionProducts.promotionId, row.id), isNull(promotionProducts.removedAt)));
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
  return {
    honest,
    leftOut: {
      unbacked: ours.length - honest.length,
      soldOut: cards.length - orderable.length,
      elsewhere: orderable.length - ours.length,
    },
  };
}

export interface PromotionChoice extends PromotionRow {
  /** Its members whose own badge can carry its percentage: what its letter can show. */
  readonly products: number;
  /** The rest, by why. */
  readonly leftOut: LeftOutMembers;
}

/** Running and upcoming promotions, soonest first, for "Обява за промоция". */
export async function promotionChoices(now: Date = new Date()): Promise<PromotionChoice[]> {
  const rows = await db
    .select(promotionColumns)
    .from(promotions)
    .where(announceable(now))
    .orderBy(promotions.startsAt, promotions.id);
  return Promise.all(
    rows.map(async (row) => {
      const members = await honestMembers(row, now);
      return { ...row, products: members.honest.length, leftOut: members.leftOut };
    }),
  );
}

/**
 * Why a promotion's letter has nothing to show, in the owner's words: what
 * its members lack. Its letter would claim "−X%" over no product, so none is
 * started.
 */
export function noMembersReason(
  promotion: Pick<PromotionRow, "percentOff">,
  leftOut: LeftOutMembers,
): string {
  const reasons = [
    ...(leftOut.unbacked > 0
      ? [
          `${leftOut.unbacked === 1 ? "един продукт няма" : `${leftOut.unbacked} продукта нямат`} 30-дневна история на цената или наскоро ${leftOut.unbacked === 1 ? "е бил по-евтин" : "са били по-евтини"}, затова значката не може да покаже −${promotion.percentOff}%`,
        ]
      : []),
    ...(leftOut.soldOut > 0
      ? [
          `${leftOut.soldOut === 1 ? "един продукт е изчерпан" : `${leftOut.soldOut} продукта са изчерпани`}`,
        ]
      : []),
    ...(leftOut.elsewhere > 0
      ? [
          `${leftOut.elsewhere === 1 ? "един продукт е" : `${leftOut.elsewhere} продукта са`} в друга промоция с по-голямо намаление`,
        ]
      : []),
  ];
  return reasons.length > 0
    ? `Нито един продукт от промоцията не може да бъде в писмото: ${reasons.join("; ")}.`
    : "Промоцията още няма продукти.";
}

export interface PromotionPlan {
  readonly input: PromotionInput;
  readonly row: PromotionRow;
  /** What the draft keeps of it: the promotion as written about, what was left out and why. */
  readonly plan: Omit<LetterPlan, "kind" | "version">;
  /** Why nothing could be shown, when nothing could: the letter is not started. */
  readonly empty: string | null;
}

/**
 * One promotion's letter data, or null when it cannot be announced: it does
 * not exist, was stopped, or has ended. Its products are `honestMembers`, a
 * block's worth; `empty` says why when there are none.
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
  const { honest, leftOut } = await honestMembers(row, now);
  const shown = honest.slice(0, MAX_BLOCK_PRODUCTS);
  const counts = { ...leftOut, overflow: honest.length - shown.length };
  return {
    row,
    empty: shown.length === 0 ? noMembersReason(row, leftOut) : null,
    plan: {
      preparedAt: now.toISOString(),
      named: [],
      announced: plannedFrom(
        row,
        null,
        shown.map((card) => card.slug),
      ),
      leftOut: Object.fromEntries(Object.entries(counts).filter(([, value]) => value > 0)),
    },
    input: {
      now,
      promotion: asTemplate(row),
      members: shown.map((card) => card.slug),
    },
  };
}
