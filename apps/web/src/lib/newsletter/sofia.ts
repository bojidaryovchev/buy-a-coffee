import { SHOP_TIME_ZONE } from "@/lib/forms/callback-window";

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
 * Pure, with `Intl` and nothing else: the templates, the checks in the
 * browser, the cron and the tests read the same answers.
 */

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** The Sofia wall clock at an instant, as numbers. */
function wallClock(at: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const values: Record<string, number> = {};
  for (const part of parts.formatToParts(at)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
  };
}

/** How far Sofia is ahead of UTC at an instant, in milliseconds (2 or 3 hours). */
function offsetAt(at: Date): number {
  const clock = wallClock(at);
  const local = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a Sofia calendar day begins. */
export function sofiaMidnight(year: number, month: number, day: number): Date {
  const utc = Date.UTC(year, month - 1, day);
  let instant = utc - offsetAt(new Date(utc));
  /* The offset at midnight UTC can differ from the one at midnight in Sofia
     when the clocks change in between; one correction settles it. */
  const settled = utc - offsetAt(new Date(instant));
  if (settled !== instant) instant = settled;
  return new Date(instant);
}

/** "2026-11": the Sofia month an instant falls in. */
export function sofiaPeriod(at: Date): string {
  const clock = wallClock(at);
  return `${clock.year}-${String(clock.month).padStart(2, "0")}`;
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
