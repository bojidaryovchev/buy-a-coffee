import type { DeliverabilityNote } from "./deliverability";
import { dayWords, lastDay } from "./sofia";

/**
 * What a letter may say about the shop's own promotions, checked where it is
 * written and again where it is sent.
 *
 * A reduction announced is a reduction against the lowest price of the 30
 * days before it (Directive 98/6/EC, Art. 6a; CJEU C-330/23, Aldi Süd): the
 * shop's cards show exactly that, as the badge and the struck price, and show
 * nothing where nothing can be claimed. A letter must not claim more than
 * its cards do. So:
 *
 *   - A promotion's letter (`newsletter_campaigns.promotion_id`) says "−X%".
 *     It goes out only while the promotion runs — prepared ahead, it waits
 *     for the first day; after the last, or once stopped, it does not go at
 *     all — and only if every product in it shows at least X% on its own
 *     badge. A product priced by the promotion but without a 30-day price on
 *     record, or one that was cheaper lately, shows less, or nothing.
 *   - The monthly letter names promotions in words, with their last day
 *     (`LetterPlan.promotionIds`). Each must still be running when it goes.
 *
 * Every one of these stops the send (`blocksSend`); the composer shows them
 * as the owner writes, and `submitNewsletter` refuses with the same words.
 * Pure: the facts come in from the page and from the server's own reads.
 */

/** A promotion as the checks need it; `name` is the owner's, never shown to a customer. */
export interface PromotionFacts {
  readonly id: string;
  readonly name: string;
  readonly label: string | null;
  readonly percentOff: number;
  readonly startsAt: Date | string;
  readonly endsAt: Date | string;
  readonly stoppedAt: Date | string | null;
}

/** A product of the letter, as its card claims it. */
export interface ClaimedProduct {
  readonly title: string;
  readonly discountPercent?: number | null;
}

export interface ClaimInput {
  /** The promotion the letter announces, for a promotion's letter. */
  readonly announced?: PromotionFacts | null;
  /** A promotion's letter whose promotion is gone: deleted before it started. */
  readonly announcedMissing?: boolean;
  /** The promotions the letter names in words (the monthly letter's). */
  readonly named?: readonly PromotionFacts[];
  /** Every product the letter shows; null before they are known. */
  readonly products?: readonly ClaimedProduct[] | null;
  readonly now?: Date;
}

const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));
const quoted = (items: readonly string[]) => items.map((item) => `„${item}“`).join(", ");

/** "„Есенни дни“ („Есен 2026“ в панела)", or the owner's name alone. */
const called = (promotion: PromotionFacts) =>
  promotion.label ? `„${promotion.label}“ („${promotion.name}“)` : `„${promotion.name}“`;

/** Where a promotion is now: before its first day, running, or over. */
export function promotionPhase(
  promotion: Pick<PromotionFacts, "startsAt" | "endsAt" | "stoppedAt">,
  now: Date = new Date(),
): "upcoming" | "running" | "stopped" | "ended" {
  const stoppedAt = promotion.stoppedAt ? asDate(promotion.stoppedAt) : null;
  if (stoppedAt && stoppedAt <= now) return "stopped";
  if (asDate(promotion.endsAt) <= now) return "ended";
  if (asDate(promotion.startsAt) > now) return "upcoming";
  return "running";
}

function overNote(promotion: PromotionFacts, phase: "stopped" | "ended", own: boolean) {
  const when =
    phase === "stopped"
      ? `спряна е на ${dayWords(asDate(promotion.stoppedAt!))}`
      : `последният ѝ ден беше ${dayWords(lastDay(asDate(promotion.endsAt)))}`;
  return {
    id: "promotion-ended" as const,
    title: own
      ? phase === "stopped"
        ? "Промоцията е спряна"
        : "Промоцията е приключила"
      : `Промоцията ${called(promotion)} ${phase === "stopped" ? "е спряна" : "е приключила"}`,
    detail: own
      ? `${when[0]!.toLocaleUpperCase("bg")}${when.slice(1)}, а писмото обявява намаление, което вече не важи. Изтрийте черновата или напишете друго писмо.`
      : `Писмото я споменава, а ${when}. Махнете изречението и продуктите ѝ или ги заменете.`,
    blocksSend: true as const,
  };
}

export function claimNotes(input: ClaimInput): DeliverabilityNote[] {
  const now = input.now ?? new Date();
  const notes: DeliverabilityNote[] = [];
  const announced = input.announced ?? null;
  if (!announced && input.announcedMissing) {
    notes.push({
      id: "promotion-ended",
      title: "Промоцията вече я няма",
      detail:
        "Изтрита е, преди да започне, а писмото я обявява. Изтрийте черновата или напишете друго писмо.",
      blocksSend: true,
    });
  }
  if (announced) {
    const phase = promotionPhase(announced, now);
    if (phase === "stopped" || phase === "ended") notes.push(overNote(announced, phase, true));
    else if (phase === "upcoming") {
      notes.push({
        id: "promotion-not-started",
        title: "Промоцията още не е започнала",
        detail: `Започва на ${dayWords(asDate(announced.startsAt))}. Писмото може да се подготви отрано, но се изпраща едва когато промоцията тече: дотогава цените в магазина не са намалени.`,
        blocksSend: true,
      });
    } else if (input.products) {
      const short = input.products.filter(
        (product) => (product.discountPercent ?? 0) < announced.percentOff,
      );
      if (short.length > 0) {
        const one = short.length === 1;
        notes.push({
          id: "promotion-claim",
          title: one
            ? `Продукт без −${announced.percentOff}% на значката`
            : `Продукти без −${announced.percentOff}% на значката`,
          detail: `${quoted(short.map((product) => product.title))} — ${
            one ? "значката му не показва" : "значките им не показват"
          } −${announced.percentOff}%, а писмото го обявява: ${
            one ? "няма" : "нямат"
          } 30-дневна история на цената или наскоро ${one ? "е бил" : "са били"} по-евтин${
            one ? "" : "и"
          }. Махнете ${one ? "го" : "ги"} от писмото.`,
          blocksSend: true,
        });
      }
    }
  }
  for (const promotion of input.named ?? []) {
    const phase = promotionPhase(promotion, now);
    if (phase === "stopped" || phase === "ended") notes.push(overNote(promotion, phase, false));
  }
  return notes;
}
