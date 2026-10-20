import { sofiaDayOf, sofiaDayStart } from "@/lib/promotions/days";

/**
 * The newsletter's calendar: months and days as the shop's wall clock in Sofia
 * reads them, not as UTC does.
 *
 * Two things are counted in it. The monthly letter belongs to a Sofia month
 * ("2026-11", `newsletter_campaigns.auto_period`): the cron runs at 07:00 UTC,
 * which is 09:00 or 10:00 in Sofia, but "the 1st" is the owner's 1st, and a
 * month boundary at 22:00 UTC is already the next month there. And a
 * promotion's days: it runs from 00:00 of its first day to 24:00 of its last,
 * Sofia time, so `ends_at` is the instant the last day ENDS — midnight of the
 * day after — and the day a reader is told is the one just before it.
 *
 * Pure: the templates, the checks in the browser, the cron and the tests read
 * the same answers.
 */

/*
 * The arithmetic is `lib/promotions/days.ts`, the one place the shop's days
 * are worked out (both clock changes included); this file only reads a Sofia
 * date into numbers and words it.
 */
function wallClock(at: Date): { year: number; month: number; day: number } {
  const [year, month, day] = sofiaDayOf(at).split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

/** The instant a Sofia calendar day begins. */
export function sofiaMidnight(year: number, month: number, day: number): Date {
  return sofiaDayStart(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

/** "2026-11": the Sofia month an instant falls in. */
export function sofiaPeriod(at: Date): string {
  const clock = wallClock(at);
  return `${clock.year}-${String(clock.month).padStart(2, "0")}`;
}

/** The day of the month in Sofia: 1 on the 1st, whatever the hour in UTC. */
export function sofiaDayOfMonth(at: Date): number {
  return wallClock(at).day;
}

/** The instant the Sofia month that holds `at` began. */
export function sofiaMonthStart(at: Date): Date {
  const clock = wallClock(at);
  return sofiaMidnight(clock.year, clock.month, 1);
}

const MONTHS = [
  "януари",
  "февруари",
  "март",
  "април",
  "май",
  "юни",
  "юли",
  "август",
  "септември",
  "октомври",
  "ноември",
  "декември",
] as const;

/** "ноември": the Sofia month of an instant, in Bulgarian, as a sentence writes it. */
export function monthName(at: Date): string {
  return MONTHS[wallClock(at).month - 1]!;
}

/** "ноември", for a period written "2026-11". */
export function periodMonthName(period: string): string {
  const month = Number(period.slice(5, 7));
  return MONTHS[month - 1] ?? period;
}

/** "15 ноември": the Sofia day of an instant. With `year`, "15 ноември 2026". */
export function dayWords(at: Date, { year = false }: { year?: boolean } = {}): string {
  const clock = wallClock(at);
  return `${clock.day} ${MONTHS[clock.month - 1]}${year ? ` ${clock.year}` : ""}`;
}

/**
 * The last day a promotion runs, in Sofia: `endsAt` is the instant that day
 * ends, so a moment before it is still the day.
 */
export function lastDay(endsAt: Date): Date {
  return new Date(endsAt.getTime() - 1);
}

/** Do two instants fall on the same Sofia day? */
export function sameSofiaDay(a: Date, b: Date): boolean {
  const x = wallClock(a);
  const y = wallClock(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

/**
 * A run of days in words: "от 1 до 15 ноември", "от 28 октомври до 3 ноември",
 * across a new year "от 28 декември 2026 до 3 януари 2027", and one day alone
 * "на 15 ноември". `first` is the instant the run begins, `endsAt` the instant
 * it ends.
 */
export function rangeWords(first: Date, endsAt: Date): string {
  const last = lastDay(endsAt);
  if (sameSofiaDay(first, last)) return `на ${dayWords(first)}`;
  const a = wallClock(first);
  const b = wallClock(last);
  if (a.year !== b.year) {
    return `от ${dayWords(first, { year: true })} до ${dayWords(last, { year: true })}`;
  }
  if (a.month === b.month) return `от ${a.day} до ${dayWords(last)}`;
  return `от ${dayWords(first)} до ${dayWords(last)}`;
}

/** Whole days from one instant to a later one, rounded down. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}
