import "server-only";
import { inArray } from "drizzle-orm";
import { products } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { discountPercent, toPriceView } from "@/lib/catalog/format";
import { regularPrice } from "@/lib/catalog/price-sql";
import { listProductCardsByIds } from "@/lib/catalog/queries";
import { periodFromDays } from "./days";
import { loadPriceHistory, type MemberInterval } from "./history";
import { resolveTargets } from "./membership";
import {
  REFERENCE_WINDOW_MS,
  fromCents,
  reducedCents,
  referencePrice,
  toCents,
  type PromotionInterval,
} from "./reference";
import type { PromotionPreviewRequest } from "./schemas";
import { listMembers, overlappingMemberships, type PromotionMember } from "./store";

/**
 * The editor's live preview: what the shop will show for every product the
 * promotion covers, worked out on the server by the same rules the shop and
 * the refresh use — the price rounded down (`reference.ts`), the struck price
 * the lowest of the 30 days before the reduction, the badge computed against
 * it as the card computes it (`discountPercent`) — before anything is saved.
 *
 * For a product already in the promotion with a settled reference, that
 * reference; for any other, the one the refresh would compute if the form
 * were saved now: from the first day, or from now if that has passed.
 *
 * And what the owner should know about a row: no price to reduce, sold out,
 * no badge (or a smaller one) because the 30-day lowest is already lower, and
 * another promotion on the same product at the same time, where the larger
 * reduction applies.
 */

export interface PreviewNote {
  readonly kind: "noPrice" | "soldOut" | "noBadge" | "smallerBadge" | "overlap";
  readonly text: string;
}

export interface PreviewRow {
  readonly id: string;
  /** The shop's name for it: brand and line. */
  readonly title: string;
  /** Format and pack: "Кафе на зърна, 1 кг". */
  readonly detail: string | null;
  readonly image: string | null;
  /** Formatted: the price without the promotion. */
  readonly regular: string | null;
  /** Formatted: the price the customer will pay. */
  readonly price: string | null;
  /** Formatted: the struck price beside it, when the shop shows one. */
  readonly struck: string | null;
  /** The badge's percentage, as the shop will show it, or null for none. */
  readonly badge: number | null;
  readonly notes: readonly PreviewNote[];
}

export interface PromotionPreview {
  /** The percentage previewed, or null when the form does not hold one yet. */
  readonly percentOff: number | null;
  /** Products covered. */
  readonly total: number;
  /** Of those, with a price to reduce. */
  readonly reduced: number;
  /** Of those, shown with a badge. */
  readonly withBadge: number;
  /** The first rows, by name. */
  readonly rows: readonly PreviewRow[];
  /** How many more there are. */
  readonly more: number;
}

/** Enough to check by eye; the count says the rest. */
export const PREVIEW_ROWS = 60;

const NO_NOTES: readonly PreviewNote[] = [];

export async function previewPromotion(
  request: PromotionPreviewRequest,
  now: Date = new Date(),
): Promise<PromotionPreview> {
  const percent = request.percent;
  const ids = await resolveTargets(db, request.targets);
  if (ids.length === 0) {
    return { percentOff: percent, total: 0, reduced: 0, withBadge: 0, rows: [], more: 0 };
  }

  const endDay = request.endDay < request.startDay ? request.startDay : request.endDay;
  const period = periodFromDays(request.startDay, endDay);
  const promotionId = request.promotionId ?? null;

  const [cards, priceRows, members, overlaps] = await Promise.all([
    listProductCardsByIds(ids),
    db
      .select({ id: products.id, regular: regularPrice, currency: products.currency })
      .from(products)
      .where(inArray(products.id, ids)),
    promotionId ? listMembers(promotionId) : Promise.resolve([] as PromotionMember[]),
    overlappingMemberships(ids, period, promotionId),
  ]);
  const regularOf = new Map(priceRows.map((row) => [row.id, row]));
  const memberOf = new Map(members.map((member) => [member.productId, member]));

  /* Each product's moment T and, when it is not settled yet, its reference. */
  const settled = new Map<string, string | null>();
  const pending: { id: string; moment: number; own: PromotionInterval | null }[] = [];
  for (const id of ids) {
    const member = memberOf.get(id);
    if (member && member.removedAt === null && member.referenceFinal) {
      settled.set(id, member.referencePrice);
      continue;
    }
    const joinedAt = member && member.removedAt === null ? member.addedAt.getTime() : now.getTime();
    const moment = Math.max(period.startsAt.getTime(), joinedAt);
    /* A product returning to a promotion it left: its time in it before
       counts, as the refresh counts it (`membership.ts`). */
    const own =
      member && member.removedAt !== null && percent !== null
        ? {
            percentOff: percent,
            from: Math.max(period.startsAt.getTime(), member.addedAt.getTime()),
            to: member.removedAt.getTime(),
          }
        : null;
    pending.push({ id, moment, own });
  }
  if (pending.length > 0) {
    const history = await loadPriceHistory(
      db,
      pending.map((entry) => entry.id),
      new Date(Math.min(...pending.map((entry) => entry.moment)) - REFERENCE_WINDOW_MS),
    );
    for (const entry of pending) {
      const prices = history.prices.get(entry.id);
      const earlier: PromotionInterval[] = (history.intervals.get(entry.id) ?? []).filter(
        (interval: MemberInterval) => interval.promotionId !== promotionId,
      );
      if (entry.own && entry.own.from < entry.own.to) earlier.push(entry.own);
      settled.set(
        entry.id,
        referencePrice({
          referenceAt: entry.moment,
          changes: history.changes.get(entry.id) ?? [],
          currentPrice: prices?.currentPrice ?? null,
          override: prices?.override ?? null,
          earlier,
        }),
      );
    }
  }

  let reduced = 0;
  let withBadge = 0;
  const rows: PreviewRow[] = [];
  for (const id of ids) {
    const card = cards.get(id);
    const facts = regularOf.get(id);
    if (!card || !facts) continue;
    const currency = facts.currency;
    const money = (cents: bigint | null) =>
      cents === null ? null : (toPriceView(fromCents(cents), currency)?.formatted ?? null);
    const notes: PreviewNote[] = [];
    const regular = toCents(facts.regular);

    let price: bigint | null = null;
    let struck: bigint | null = null;
    let badge: number | null = null;
    if (regular === null) {
      notes.push({ kind: "noPrice", text: "Без цена: няма какво да се намали." });
    } else if (percent !== null) {
      reduced += 1;
      price = reducedCents(regular, percent);
      const reference = toCents(settled.get(id) ?? null);
      const shownOld = reference === null || reference > regular ? regular : reference;
      badge = discountPercent(fromCents(price), fromCents(shownOld));
      if (badge === null) {
        notes.push({
          kind: "noBadge",
          text: `Без значка и без зачертана цена: най-ниската цена за последните 30 дни (${money(shownOld)}) не е по-висока от новата.`,
        });
      } else {
        withBadge += 1;
        struck = shownOld;
        if (badge < percent) {
          notes.push({
            kind: "smallerBadge",
            text: `Значката ще е −${badge}%, а не −${percent}%: най-ниската цена за последните 30 дни е ${money(shownOld)}.`,
          });
        }
      }
    }
    if (card.availability === "out_of_stock") {
      notes.push({
        kind: "soldOut",
        text: "Изчерпан: цената ще е намалена, но продуктът не може да се поръча, докато не се появи отново.",
      });
    }
    for (const other of overlaps.get(id) ?? []) {
      const text =
        percent === null || other.percentOff === percent
          ? `Също в промоция „${other.name}“ (−${other.percentOff}%) по същото време.`
          : other.percentOff > percent
            ? `Също в промоция „${other.name}“ (−${other.percentOff}%) по същото време: там отстъпката е по-голяма и важи тя.`
            : `Също в промоция „${other.name}“ (−${other.percentOff}%) по същото време: тук отстъпката е по-голяма и важи тази.`;
      notes.push({ kind: "overlap", text });
    }

    rows.push({
      id,
      title: card.title ?? card.name,
      detail: card.detail ?? null,
      image: card.image?.url ?? null,
      regular: money(regular),
      price: money(price),
      struck: money(struck),
      badge,
      notes: notes.length > 0 ? notes : NO_NOTES,
    });
  }

  rows.sort((a, b) => a.title.localeCompare(b.title, "bg") || a.id.localeCompare(b.id));
  return {
    percentOff: percent,
    total: rows.length,
    reduced,
    withBadge,
    rows: rows.slice(0, PREVIEW_ROWS),
    more: Math.max(0, rows.length - PREVIEW_ROWS),
  };
}
