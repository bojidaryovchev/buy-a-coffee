import { WEEK_DAYS, formatOpeningHours, type OpeningHoursRange, type WeekDay } from "@/config/site";

/**
 * When will the shop call back? A pure answer, from "now" and the opening hours.
 *
 * The success state of the quick order used to say "we will call you" and
 * nothing more. What a customer wants to know is whether to expect the phone
 * this afternoon or after the weekend, and the shop has already said when it
 * answers the phone: `siteConfig.commerce.openingHours`. This turns that into a
 * sentence, and refuses to be more precise than the data.
 *
 * ## It is a window, never an appointment
 *
 * The answer is a DAY ("днес", "утре", "в понеделник") plus "в работно време".
 * It never names an hour for the call, because the shop has committed to when
 * it is open, not to when it will ring back. The hours are printed beside it so
 * the customer can see what "работно време" means.
 *
 * ## Time zone
 *
 * "Now" is read as wall-clock time in the shop's zone, with `Intl`, so the
 * answer is right on either side of the two daylight-saving changes without
 * this file knowing the rules: 03:30 on the last Sunday of March does not exist
 * in Sofia, and 03:30 in October happens twice. Day arithmetic is done on the
 * weekday index afterwards (Friday + 3 is Monday whether or not a clock
 * changed in between), never by adding 24 hours to an instant.
 *
 * Closing time is exclusive: at 18:00 sharp the shop is shut.
 */

export const SHOP_TIME_ZONE = "Europe/Sofia";

/** Which day the call is expected, counted in days from the customer's today. */
export interface CallbackWindow {
  /** 0 = today, 1 = tomorrow, 2..7 = a named weekday that far ahead. */
  readonly daysAhead: number;
  readonly weekday: WeekDay;
}

interface Interval {
  readonly opens: number;
  readonly closes: number;
}

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight, or null for anything that is not a plain `HH:MM`. */
function minutesOf(time: string): number | null {
  const match = TIME.exec(time.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Open intervals per weekday. A range that cannot be read, runs backwards or
 * has no length is ignored rather than guessed at: hours the shop did not state
 * clearly are hours it has not committed to.
 */
function intervalsByDay(ranges: readonly OpeningHoursRange[]): Map<WeekDay, Interval[]> {
  const byDay = new Map<WeekDay, Interval[]>();
  for (const range of ranges) {
    const opens = minutesOf(range.opens);
    const closes = minutesOf(range.closes);
    const from = WEEK_DAYS.indexOf(range.from);
    const to = WEEK_DAYS.indexOf(range.to);
    if (opens === null || closes === null || closes <= opens || from < 0 || to < from) continue;
    for (const day of WEEK_DAYS.slice(from, to + 1)) {
      byDay.set(day, [...(byDay.get(day) ?? []), { opens, closes }]);
    }
  }
  return byDay;
}

const WEEKDAY_FROM_INTL: Readonly<Record<string, WeekDay>> = {
  Mon: "monday",
  Tue: "tuesday",
  Wed: "wednesday",
  Thu: "thursday",
  Fri: "friday",
  Sat: "saturday",
  Sun: "sunday",
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Building a formatter is the expensive part of reading the clock. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The weekday and minutes-since-midnight on the shop's wall clock. */
export function shopClock(
  now: Date,
  timeZone: string = SHOP_TIME_ZONE,
): { weekday: WeekDay; minutes: number } {
  const parts = formatterFor(timeZone).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = WEEKDAY_FROM_INTL[get("weekday")];
  if (!weekday) throw new Error(`Cannot read the weekday in ${timeZone}`);
  // `hourCycle: "h23"` keeps midnight as 00, not 24, in every engine we run on.
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * The next window in which the shop is open and could call, or null when the
 * hours are unset or unusable (the caller then falls back to the neutral
 * sentence).
 *
 *  - open now, or opening later today        -> today
 *  - today's hours are over, or it is a day off -> the next day with hours
 *
 * A week with hours on a single weekday still answers: the same weekday seven
 * days on is `daysAhead: 7`.
 */
export function nextCallbackWindow(
  now: Date,
  ranges: readonly OpeningHoursRange[],
  timeZone: string = SHOP_TIME_ZONE,
): CallbackWindow | null {
  const byDay = intervalsByDay(ranges);
  if (byDay.size === 0) return null;

  const clock = shopClock(now, timeZone);
  const todayIndex = WEEK_DAYS.indexOf(clock.weekday);

  for (let daysAhead = 0; daysAhead <= 7; daysAhead += 1) {
    const weekday = WEEK_DAYS[(todayIndex + daysAhead) % 7] as WeekDay;
    const intervals = byDay.get(weekday);
    if (!intervals) continue;
    // Today only counts while some interval has not yet ended.
    if (daysAhead === 0 && !intervals.some((i) => clock.minutes < i.closes)) continue;
    return { daysAhead, weekday };
  }
  return null;
}

/* Bulgarian: "в" before most days, "във" before those starting with в or ф. */
const ON_WEEKDAY: Readonly<Record<WeekDay, string>> = {
  monday: "в понеделник",
  tuesday: "във вторник",
  wednesday: "в сряда",
  thursday: "в четвъртък",
  friday: "в петък",
  saturday: "в събота",
  sunday: "в неделя",
};

const NEXT_WEEKDAY: Readonly<Record<WeekDay, string>> = {
  monday: "в следващия понеделник",
  tuesday: "в следващия вторник",
  wednesday: "в следващата сряда",
  thursday: "в следващия четвъртък",
  friday: "в следващия петък",
  saturday: "в следващата събота",
  sunday: "в следващата неделя",
};

/** "днес", "утре", "в понеделник" — the day alone. */
export function describeDay(window: CallbackWindow): string {
  if (window.daysAhead === 0) return "днес";
  if (window.daysAhead === 1) return "утре";
  if (window.daysAhead >= 7) return NEXT_WEEKDAY[window.weekday];
  return ON_WEEKDAY[window.weekday];
}

/** What the customer is told is next, without the thanks. */
export const NEUTRAL_NEXT_STEP =
  "Ще ви се обадим на оставения номер, за да потвърдим поръчката и да уговорим доставката.";

/**
 * The sentence for the success state.
 *
 * With usable hours: the day, "в работно време", and the hours themselves.
 * Without: the neutral sentence, which promises nothing about when.
 */
export function callbackSentence(
  now: Date,
  ranges: readonly OpeningHoursRange[],
  timeZone: string = SHOP_TIME_ZONE,
): string {
  const window = nextCallbackWindow(now, ranges, timeZone);
  if (!window) return NEUTRAL_NEXT_STEP;

  const hours = formatOpeningHours(ranges);
  return (
    `Ще ви се обадим ${describeDay(window)}, в работно време, за да потвърдим поръчката и да ` +
    `уговорим доставката.${hours ? ` Работно време: ${hours}.` : ""}`
  );
}
