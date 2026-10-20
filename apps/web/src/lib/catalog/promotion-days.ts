import { SHOP_TIME_ZONE } from "@/lib/forms/callback-window";
import { sofiaDayOf } from "@/lib/promotions/days";

/**
 * A promotion's last day, as the shop states it: "до 15 ноември" on the page,
 * `2026-11-15` in the structured data.
 *
 * A promotion runs for whole days in Sofia, and `ends_at` is the instant its
 * last day ends: 24:00 Sofia, which is 00:00 of the day after. Read at that
 * instant, the date is the day after the promotion. So the last day is the
 * Sofia date of the moment just before it — `sofiaDayOf` in
 * `lib/promotions/days.ts`, the one place the shop's days are worked out (the
 * panel reads a promotion's last day with it too). This file only words it.
 *
 * Client-safe: the cart page says it too.
 */

const ONE_MOMENT_MS = 1;

const dayInYear = new Intl.DateTimeFormat("bg-BG", {
  timeZone: SHOP_TIME_ZONE,
  day: "numeric",
  month: "long",
});
const dayWithYear = new Intl.DateTimeFormat("bg-BG", {
  timeZone: SHOP_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** The moment before `endsAt`, or null when it is not an instant. */
function lastMoment(endsAt: string): Date | null {
  const end = Date.parse(endsAt);
  return Number.isNaN(end) ? null : new Date(end - ONE_MOMENT_MS);
}

/** The last day of a promotion ending at `endsAt`, as `YYYY-MM-DD`, or null. */
export function promotionLastDay(endsAt: string): string | null {
  const last = lastMoment(endsAt);
  return last ? sofiaDayOf(last) : null;
}

/**
 * "до 15 ноември", with the year only when it is not this year in Sofia:
 * "до 5 януари 2027 г.". Null when `endsAt` is not an instant.
 */
export function promotionUntil(endsAt: string, now: Date = new Date()): string | null {
  const last = lastMoment(endsAt);
  if (!last) return null;
  const sameYear = sofiaDayOf(last).slice(0, 4) === sofiaDayOf(now).slice(0, 4);
  return `до ${(sameYear ? dayInYear : dayWithYear).format(last)}`;
}
