import type { PromotionTargets } from "@catalog/db/schema";
import { addDays, daysFromPeriod, periodLength, type Day } from "./days";
import { PROMOTION_MAX_DAYS, PROMOTION_NAME_MAX } from "./schemas";

/**
 * "Дублирай": what the new-promotion editor opens with when it is started
 * from another promotion — the same name (marked as a copy), words for
 * customers, percentage and choice of products, for as many days, starting
 * tomorrow. Nothing is written: the copy exists once the owner saves it, so a
 * look that ends in "Назад" leaves nothing behind.
 *
 * Tomorrow, not today: a copy saved without a second look must not change a
 * price in the shop the moment it is saved.
 */

export interface PromotionCopy {
  readonly name: string;
  readonly label: string;
  readonly percent: string;
  readonly startDay: Day;
  readonly endDay: Day;
  readonly targets: PromotionTargets;
}

const COPY_SUFFIX = " (копие)";

export function copyOfPromotion(
  source: {
    readonly name: string;
    readonly label: string | null;
    readonly percentOff: number;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly targets: PromotionTargets;
  },
  today: Day,
): PromotionCopy {
  const { startDay, endDay } = daysFromPeriod(source);
  const length = Math.min(Math.max(periodLength(startDay, endDay), 1), PROMOTION_MAX_DAYS);
  const start = addDays(today, 1);
  return {
    name: `${source.name.slice(0, PROMOTION_NAME_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
    label: source.label ?? "",
    percent: String(source.percentOff),
    startDay: start,
    endDay: addDays(start, length - 1),
    targets: source.targets,
  };
}
