/**
 * A promotion's period, as the owner chooses it and as the database keeps it.
 *
 * The owner picks whole days — "from 1 to 15 November" — and means Sofia's
 * days: the reduction is on from 00:00 on the first to 24:00 on the last. The
 * database keeps the two instants those days begin and end (`starts_at`, and
 * `ends_at` = 00:00 Sofia of the day after the last), because the price layer
 * compares them with `now()`.
 *
 * Sofia's offset from UTC is +2 in winter and +3 in summer, so 00:00 Sofia is
 * 22:00 or 21:00 UTC of the day before, and the two days a year the clocks
 * move are 23 and 25 hours long. Nothing here adds 24 hours to an instant: a
 * day is a calendar date ("2026-11-01"), arithmetic on days is arithmetic on
 * dates, and an instant is found by asking `Intl` what Sofia's clock reads.
 * Both directions are pure and work the same in the browser and on the
 * server, whatever either's own time zone.
 */

export const SOFIA_TIME_ZONE = "Europe/Sofia";

/** A calendar day, "YYYY-MM-DD", as `<input type="date">` reads and writes it. */
export type Day = string;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-11-01" → [2026, 11, 1], or null for anything that is not a real date. */
function parts(day: string): [number, number, number] | null {
  const match = DAY_PATTERN.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, date));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  ) {
    return null;
  }
  return [year, month, date];
}

export function isDay(value: unknown): value is Day {
  return typeof value === "string" && parts(value) !== null;
}

function format(year: number, month: number, date: number): Day {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

function requireParts(day: Day): [number, number, number] {
  const parsed = parts(day);
  if (!parsed) throw new RangeError(`Not a day: ${JSON.stringify(day)}`);
  return parsed;
}

/** The day `count` days after `day` (before, when negative). Calendar arithmetic. */
export function addDays(day: Day, count: number): Day {
  const [year, month, date] = requireParts(day);
  const moved = new Date(Date.UTC(year, month - 1, date + count));
  return format(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** How many days from `from` to `to`: 0 for the same day, negative when `to` is earlier. */
export function daysBetween(from: Day, to: Day): number {
  const [y1, m1, d1] = requireParts(from);
  const [y2, m2, d2] = requireParts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

/** The last day of the month `day` is in. */
export function endOfMonth(day: Day): Day {
  const [year, month] = requireParts(day);
  const last = new Date(Date.UTC(year, month, 0));
  return format(year, month, last.getUTCDate());
}

const sofiaClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: SOFIA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** What Sofia's clock reads at `instant`, field by field. */
function sofiaFields(instant: number) {
  const fields: Record<string, number> = {};
  for (const part of sofiaClock.formatToParts(new Date(instant))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return fields as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

/** Sofia's offset from UTC at `instant`, in milliseconds (+2 h or +3 h). */
function sofiaOffset(instant: number): number {
  const at = sofiaFields(instant);
  const asIfUtc = Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute, at.second);
  // Whole seconds on both sides: the clock has no milliseconds to compare.
  return asIfUtc - Math.floor(instant / 1000) * 1000;
}

/** The Sofia day `instant` falls on. */
export function sofiaDayOf(instant: Date | number): Day {
  const at = sofiaFields(typeof instant === "number" ? instant : instant.getTime());
  return format(at.year, at.month, at.day);
}

/** Today, in Sofia. */
export function todayInSofia(now: Date = new Date()): Day {
  return sofiaDayOf(now);
}

/**
 * The instant `day` begins in Sofia: its 00:00.
 *
 * Midnight is never skipped or repeated in Sofia (the clocks move at 03:00 in
 * March and at 04:00 in October), so there is exactly one answer. It is found
 * by taking the offset at a first guess and checking it at the result: the
 * offset at 00:00 UTC of the date can differ from the one at Sofia's midnight
 * only on a day the clocks move, and the second look settles it.
 */
export function sofiaDayStart(day: Day): Date {
  const [year, month, date] = requireParts(day);
  const wall = Date.UTC(year, month - 1, date);
  let instant = wall - sofiaOffset(wall);
  const settled = wall - sofiaOffset(instant);
  if (settled !== instant) instant = settled;
  return new Date(instant);
}

/**
 * The period as stored: `starts_at` at 00:00 Sofia of the first day,
 * `ends_at` at 00:00 Sofia of the day after the last, so the last day is
 * whole (`ends_at` is exclusive, as the price layer reads it).
 */
export function periodFromDays(startDay: Day, endDay: Day): { startsAt: Date; endsAt: Date } {
  return { startsAt: sofiaDayStart(startDay), endsAt: sofiaDayStart(addDays(endDay, 1)) };
}

/**
 * The days the owner chose, read back from the stored instants: the day
 * `starts_at` falls on, and the day of the last instant before `ends_at`.
 */
export function daysFromPeriod(period: { startsAt: Date; endsAt: Date }): {
  startDay: Day;
  endDay: Day;
} {
  return {
    startDay: sofiaDayOf(period.startsAt),
    endDay: sofiaDayOf(period.endsAt.getTime() - 1),
  };
}

/** How many days the period covers, both ends counted: 1–15 November is 15. */
export function periodLength(startDay: Day, endDay: Day): number {
  return daysBetween(startDay, endDay) + 1;
}

/* -- in words ---------------------------------------------------------------- */

/** The months as a date reads them in Bulgarian: "1 ноември". */
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

/** "15 ноември 2026", or "15 ноември" without the year. */
export function formatDay(day: Day, options: { year?: boolean } = {}): string {
  const [year, month, date] = requireParts(day);
  const text = `${date} ${MONTHS[month - 1]}`;
  return options.year === false ? text : `${text} ${year}`;
}

/**
 * A run of days, as short as it can be read: "5 ноември 2026",
 * "1–15 ноември 2026", "28 октомври – 3 ноември 2026",
 * "28 декември 2026 – 3 януари 2027". An en dash between numbers, and a
 * spaced one between dates that carry words.
 */
export function formatDayRange(startDay: Day, endDay: Day): string {
  const [y1, m1, d1] = requireParts(startDay);
  const [y2, m2, d2] = requireParts(endDay);
  if (startDay === endDay) return formatDay(startDay);
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${formatDay(startDay, { year: false })} – ${formatDay(endDay)}`;
  return `${formatDay(startDay)} – ${formatDay(endDay)}`;
}
