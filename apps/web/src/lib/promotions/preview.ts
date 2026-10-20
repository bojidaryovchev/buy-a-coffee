import "server-only";
import { inArray } from "drizzle-orm";
import { products } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { discountPercent, toPriceView } from "@/lib/catalog/format";
import { regularPrice } from "@/lib/catalog/price-sql";
import { listProductsForOrder } from "@/lib/catalog/queries";
import { formatDay, periodFromDays, sofiaDayOf } from "./days";
import { loadPriceHistory, type MemberInterval } from "./history";
import { resolveTargets } from "./membership";
import {
  fromCents,
  reducedCents,
  referenceOutcome,
  referenceWindowStart,
  toCents,
  type PromotionInterval,
  type ReferenceOutcome,
} from "./reference";
import type { PromotionPreviewRequest } from "./schemas";
import {
  listMembers,
  overlappingMemberships,
  type OverlappingMembership,
  type PromotionMember,
} from "./store";

/**
 * The editor's live preview: what the shop will show for every product the
 * promotion covers, worked out on the server by the rules the shop and the
 * refresh use, before anything is saved — the price rounded down
 * (`reference.ts`), the struck price the lowest of the 30 days before the
 * reduction or none at all when no such price is on record
 * (`lib/catalog/price-sql.ts`), the struck price shown only when it is above
 * the price and the badge only from 1% (the card's rules, `product-card.tsx`).
 *
 * For a product already in the promotion with a settled reference, that
 * reference; for any other, the one the refresh would compute if the form
 * were saved now: from the first day, or from now if that has passed.
 *
 * Where another promotion has the product at the moment this one would start
 * pricing it and wins (a larger reduction; on a tie, the one that started
 * first, as the price layer orders them), the row shows that one's price and
 * badge — what a customer will see — and is not counted as reduced by this
 * one.
 *
 * And what the owner should know about a row: no price to reduce, sold out or
 * missing from the supplier's catalog for now, no badge (or a smaller one)
 * and why, and the other promotions on the same product.
 */

export interface PreviewNote {
  readonly kind:
    | "noPrice"
    | "soldOut"
    | "absent"
    | "new"
    | "shortPrice"
    | "noHistory"
    | "noBadge"
    | "smallerBadge"
    | "otherWins"
    | "overlap";
  readonly text: string;
}

export interface PreviewRow {
  readonly id: string;
  /** The shop's name for it: brand and line. */
  readonly title: string;
  readonly detail: string | null;
  readonly image: string | null;
  /** Formatted: the price without any promotion. */
  readonly regular: string | null;
  /** Formatted: the price the customer will pay. */
  readonly price: string | null;
  /** Formatted: the struck price beside it, when the shop shows one. */
  readonly struck: string | null;
  /** The badge's percentage, as the shop will show it, or null for none. */
  readonly badge: number | null;
  /** Another promotion prices it, not this one. */
  readonly otherWins: boolean;
  readonly notes: readonly PreviewNote[];
}

export interface PromotionPreview {
  /** The percentage previewed, or null when the form does not hold one yet. */
  readonly percentOff: number | null;
  /** Products covered, those missing from the supplier's catalog for now included. */
  readonly total: number;
  /** Of those, priced by this promotion. */
  readonly reduced: number;
  /** Of those, shown with a badge. */
  readonly withBadge: number;
  /** Covered, but priced by another promotion with a larger reduction. */
  readonly elsewhere: number;
  /** Of those covered, missing from the supplier's catalog for now. */
  readonly absent: number;
  /**
   * Products in the promotion now that this version leaves out. A product
   * taken out of a running promotion and put back gets no badge for the rest
   * of it: its price in the promotion is by then part of its 30-day history.
   */
  readonly leaving: number;
  /** The first rows, by name. */
  readonly rows: readonly PreviewRow[];
  /** How many more there are. */
  readonly more: number;
}

/** Enough to check by eye; the count says the rest. */
export const PREVIEW_ROWS = 60;

/**
 * Does `other` win over this promotion for a product both have, as the price
 * layer orders them: `percent_off desc, starts_at asc, id asc`
 * (`lib/catalog/price-sql.ts`)?
 *
 * A full tie — the same percentage from the same instant — is settled by the
 * ids. An unsaved promotion has none yet, and the one it will get is random,
 * so the shop could go either way once it is saved; the preview takes the
 * side that claims less for this one and has it lose every full tie, and the
 * row's note says so (`isFullTie`).
 */
function beats(
  other: OverlappingMembership,
  self: { id: string | null; percentOff: number; startsAt: Date },
): boolean {
  if (other.percentOff !== self.percentOff) return other.percentOff > self.percentOff;
  const a = other.startsAt.getTime();
  const b = self.startsAt.getTime();
  if (a !== b) return a < b;
  return self.id === null || other.id < self.id;
}

/** The same percentage from the same instant: only the ids tell them apart. */
function isFullTie(
  other: OverlappingMembership,
  self: { percentOff: number; startsAt: Date },
): boolean {
  return (
    other.percentOff === self.percentOff && other.startsAt.getTime() === self.startsAt.getTime()
  );
}

const NO_HISTORY_TEXT: Record<Exclude<ReferenceOutcome["reason"], "ok">, PreviewNote> = {
  new: {
    kind: "new",
    text: "В магазина е от по-малко от 30 дни: ще е с намалената цена, но без значка и без зачертана цена, защото няма 30 дни цени, с които да се сравни.",
  },
  noPrice: {
    kind: "shortPrice",
    text: "Има цена от по-малко от 30 дни: ще е с намалената цена, но без значка и без зачертана цена.",
  },
};

export async function previewPromotion(
  request: PromotionPreviewRequest,
  now: Date = new Date(),
): Promise<PromotionPreview> {
  const percent = request.percent;
  const promotionId = request.promotionId ?? null;
  const ids = await resolveTargets(db, request.targets);
  const members = promotionId ? await listMembers(promotionId) : ([] as PromotionMember[]);
  const covered = new Set(ids);
  const leaving = members.filter(
    (member) => member.removedAt === null && !covered.has(member.productId),
  ).length;
  if (ids.length === 0) {
    return {
      percentOff: percent,
      total: 0,
      reduced: 0,
      withBadge: 0,
      elsewhere: 0,
      absent: 0,
      leaving,
      rows: [],
      more: 0,
    };
  }

  const endDay = request.endDay < request.startDay ? request.startDay : request.endDay;
  const period = periodFromDays(request.startDay, endDay);
  /* When this promotion would start pricing a product: its first day, or now. */
  const pricingFrom = new Date(Math.max(period.startsAt.getTime(), now.getTime()));

  const [found, priceRows, overlaps] = await Promise.all([
    listProductsForOrder(ids),
    db
      .select({ id: products.id, regular: regularPrice, currency: products.currency })
      .from(products)
      .where(inArray(products.id, ids)),
    overlappingMemberships(ids, period, promotionId),
  ]);
  const regularOf = new Map(priceRows.map((row) => [row.id, row]));
  const memberOf = new Map(members.map((member) => [member.productId, member]));

  /* Each product's reference for this promotion. */
  const settled = new Map<string, ReferenceOutcome | { price: string | null; reason: "stored" }>();
  const pending: {
    id: string;
    moment: number;
    own: PromotionInterval | null;
    /** Settled with no price: worked out again only to say why there is none. */
    whyOnly: boolean;
  }[] = [];
  for (const id of ids) {
    const member = memberOf.get(id);
    if (member && member.removedAt === null && member.referenceFinal) {
      settled.set(id, { price: member.referencePrice, reason: "stored" });
      if (member.referencePrice === null) {
        pending.push({
          id,
          moment: Math.max(period.startsAt.getTime(), member.addedAt.getTime()),
          own: null,
          whyOnly: true,
        });
      }
      continue;
    }
    const joinedAt = member && member.removedAt === null ? member.addedAt.getTime() : now.getTime();
    const moment = Math.max(period.startsAt.getTime(), joinedAt);
    /* A product returning to a promotion it left: its time in it before
       counts, as the refresh counts it (`refresh.ts`). */
    const own =
      member && member.removedAt !== null && percent !== null
        ? {
            percentOff: percent,
            from: Math.max(period.startsAt.getTime(), member.addedAt.getTime()),
            to: member.removedAt.getTime(),
          }
        : null;
    pending.push({ id, moment, own, whyOnly: false });
  }
  if (pending.length > 0) {
    const history = await loadPriceHistory(
      db,
      pending.map((entry) => entry.id),
      new Date(Math.min(...pending.map((entry) => referenceWindowStart(entry.moment)))),
    );
    for (const entry of pending) {
      const prices = history.prices.get(entry.id);
      const earlier: PromotionInterval[] = (history.intervals.get(entry.id) ?? []).filter(
        (interval: MemberInterval) => interval.promotionId !== promotionId,
      );
      if (entry.own && entry.own.from < entry.own.to) earlier.push(entry.own);
      const outcome = referenceOutcome({
        referenceAt: entry.moment,
        changes: history.changes.get(entry.id) ?? [],
        currentPrice: prices?.currentPrice ?? null,
        override: prices?.override ?? null,
        firstSeenAt: prices?.firstSeenAt ?? null,
        earlier,
      });
      // A settled reference is what the shop strikes; only the reason is new.
      if (!entry.whyOnly || outcome.price === null) settled.set(entry.id, outcome);
    }
  }

  let reduced = 0;
  let withBadge = 0;
  let elsewhere = 0;
  let absent = 0;
  const rows: PreviewRow[] = [];
  for (const id of ids) {
    const entry = found.get(id);
    const facts = regularOf.get(id);
    if (!entry || !facts) continue;
    const { card, status } = entry;
    const currency = facts.currency;
    const money = (cents: bigint | null) =>
      cents === null ? null : (toPriceView(fromCents(cents), currency)?.formatted ?? null);
    const notes: PreviewNote[] = [];
    const regular = toCents(facts.regular);
    const others = overlaps.get(id) ?? [];

    /* Who prices it when this one would start: this promotion, or another. */
    const self = { id: promotionId, percentOff: percent ?? 0, startsAt: period.startsAt };
    const runningThen = others.filter(
      (other) =>
        other.startsAt.getTime() <= pricingFrom.getTime() &&
        other.endsAt.getTime() > pricingFrom.getTime(),
    );
    const winner =
      percent === null
        ? null
        : (runningThen
            .filter((other) => beats(other, self))
            .sort(
              (a, b) =>
                b.percentOff - a.percentOff ||
                a.startsAt.getTime() - b.startsAt.getTime() ||
                a.id.localeCompare(b.id),
            )[0] ?? null);

    let price: bigint | null = null;
    let struck: bigint | null = null;
    let badge: number | null = null;
    if (status === "missing") {
      absent += 1;
      notes.push({
        kind: "absent",
        text: "Временно липсва в каталога на доставчика: страницата му ще показва намалената цена, но не може да се поръча, докато не се върне.",
      });
    }
    if (regular === null) {
      notes.push({ kind: "noPrice", text: "Без цена: няма какво да се намали." });
    } else if (percent !== null) {
      const pricedBy = winner ?? null;
      const percentOff = pricedBy ? pricedBy.percentOff : percent;
      price = reducedCents(regular, percentOff);
      const outcome = pricedBy
        ? { price: pricedBy.referencePrice, reason: "stored" as const }
        : settled.get(id)!;
      const reference = toCents(outcome.price);
      /* No 30-day price on record: no struck price at all (`price-sql.ts`). */
      const shownOld = reference === null ? null : reference < regular ? reference : regular;
      const discount =
        shownOld === null ? null : discountPercent(fromCents(price), fromCents(shownOld));
      if (discount !== null) struck = shownOld;
      if (discount !== null && discount >= 1) badge = discount;

      if (pricedBy) {
        elsewhere += 1;
        notes.push({
          kind: "otherWins",
          text:
            pricedBy.percentOff > percent
              ? `Също в промоция „${pricedBy.name}“ (−${pricedBy.percentOff}%), която по това време е с по-голяма отстъпка: магазинът показва нейната цена и значка, не тази.`
              : !isFullTie(pricedBy, self)
                ? `Също в промоция „${pricedBy.name}“ (−${pricedBy.percentOff}%), със същата отстъпка и започнала по-рано: докато тече, магазинът показва нейната цена и значка, не тази.`
                : promotionId === null
                  ? `Също в промоция „${pricedBy.name}“ (−${pricedBy.percentOff}%), със същата отстъпка и от същия ден. При такова пълно равенство магазинът избира една от двете и коя, се разбира едва след запазването; прегледът приема, че важи тя, и показва нейната цена и значка. За да важи тази, изберете друга отстъпка или друг първи ден.`
                  : `Също в промоция „${pricedBy.name}“ (−${pricedBy.percentOff}%), със същата отстъпка и от същия ден: при такова пълно равенство магазинът показва нейната цена и значка, не тази.`,
        });
      } else {
        reduced += 1;
        if (badge !== null) withBadge += 1;
        if (reference === null) {
          notes.push(
            outcome.reason === "new" || outcome.reason === "noPrice"
              ? NO_HISTORY_TEXT[outcome.reason]
              : {
                  kind: "noHistory",
                  text: "Без значка и без зачертана цена: няма цена от последните 30 дни, с която да се сравни.",
                },
          );
        } else if (badge === null) {
          notes.push({
            kind: "noBadge",
            text: `Без значка: най-ниската цена за последните 30 дни (${money(shownOld)}) не е с поне 1% над новата.`,
          });
        } else if (badge < percent) {
          notes.push({
            kind: "smallerBadge",
            text: `Значката ще е −${badge}%, а не −${percent}%: най-ниската цена за последните 30 дни е ${money(shownOld)}.`,
          });
        }
      }
    }
    if (card.availability === "out_of_stock" && status !== "missing") {
      notes.push({
        kind: "soldOut",
        text: "Изчерпан: цената ще е намалена, но продуктът не може да се поръча, докато не се появи отново.",
      });
    }
    for (const other of others) {
      if (other === winner) continue;
      const larger = percent !== null && beats(other, self);
      const from = other.startsAt.getTime() > pricingFrom.getTime() ? other.startsAt : null;
      const when = from
        ? ` от ${formatDay(sofiaDayOf(from), { year: false })}`
        : " по същото време";
      notes.push({
        kind: "overlap",
        text: larger
          ? `Също в промоция „${other.name}“ (−${other.percentOff}%)${when}: тогава магазинът показва нейната цена, защото отстъпката там е по-голяма.`
          : other.percentOff === percent
            ? `Също в промоция „${other.name}“ (−${other.percentOff}%)${when}, със същата отстъпка.`
            : `Също в промоция „${other.name}“ (−${other.percentOff}%)${when}: тук отстъпката е по-голяма и важи тази.`,
      });
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
      otherWins: winner !== null,
      notes,
    });
  }

  rows.sort((a, b) => a.title.localeCompare(b.title, "bg") || a.id.localeCompare(b.id));
  return {
    percentOff: percent,
    total: rows.length,
    reduced,
    withBadge,
    elsewhere,
    absent,
    leaving,
    rows: rows.slice(0, PREVIEW_ROWS),
    more: Math.max(0, rows.length - PREVIEW_ROWS),
  };
}
