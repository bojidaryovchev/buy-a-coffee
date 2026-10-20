/**
 * Where a promotion stands at a moment, as the price layer would answer it
 * (`lib/catalog/price-sql.ts`): it runs from `starts_at` until `ends_at`,
 * unless the owner stopped it. What the panel lets the owner do follows from
 * this, and only from this:
 *
 *  - **upcoming** — nothing has been charged yet: everything can change, and
 *    it can be deleted.
 *  - **running** — the name, the words for customers, the end and what it
 *    covers can change; the percentage and the start cannot (the next
 *    reduction's 30-day history is being written with them), and it can be
 *    stopped.
 *  - **ended**, **stopped** — history: read-only, kept for ever, and a
 *    starting point for a copy.
 */

export type PromotionStatus = "upcoming" | "running" | "ended" | "stopped";

export interface PromotionTimes {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly stoppedAt: Date | null;
}

export function promotionStatus(promotion: PromotionTimes, now: Date): PromotionStatus {
  if (promotion.stoppedAt !== null) return "stopped";
  if (promotion.endsAt.getTime() <= now.getTime()) return "ended";
  if (promotion.startsAt.getTime() <= now.getTime()) return "running";
  return "upcoming";
}

/** When it stopped pricing anything: the end, or the moment it was stopped. */
export function effectiveEnd(promotion: PromotionTimes): Date {
  return promotion.stoppedAt !== null && promotion.stoppedAt.getTime() < promotion.endsAt.getTime()
    ? promotion.stoppedAt
    : promotion.endsAt;
}

export const PROMOTION_STATUS_LABEL: Readonly<Record<PromotionStatus, string>> = {
  upcoming: "Предстои",
  running: "Тече",
  ended: "Приключила",
  stopped: "Спряна",
};

/**
 * The status chip's colours, the panel's pairs (`lib/newsletter/status.ts`):
 * pine for what is on now. Caution is not used: nothing here needs a look.
 */
export const PROMOTION_STATUS_TONE: Readonly<Record<PromotionStatus, string>> = {
  upcoming: "bg-paper-sunken text-ink-700",
  running: "bg-pine-100 text-pine-700",
  ended: "bg-paper-sunken text-ink-500",
  stopped: "bg-paper-sunken text-ink-500",
};

/** "1 продукт", "12 продукта". */
export function productsWord(count: number): string {
  return count === 1 ? "продукт" : "продукта";
}

/**
 * What the panel says after a press that went to another page (`?izvestie=`
 * for what happened, `?otkaz=` for what did not), so the answer survives the
 * redirect and the screen works without JavaScript.
 */
export const PROMOTION_NOTICES: Readonly<Record<string, string>> = {
  zapazena: "Промоцията е запазена.",
  spryana: "Промоцията е спряна. Цените в магазина вече са обикновените.",
  iztrita: "Промоцията е изтрита.",
};

export const PROMOTION_REFUSALS: Readonly<Record<string, string>> = {
  lipsva: "Тази промоция вече не съществува.",
  "ne-teche": "Промоцията не тече в момента, затова няма какво да се спре.",
  greshka:
    "Нищо не е променено: цените в магазина не можаха да се обновят. Опитайте отново след минута.",
  zapochnala:
    "Промоцията вече е започнала и не може да се изтрие: това, което е продадено с нея, е част от историята на цените. Можете да я спрете.",
};
