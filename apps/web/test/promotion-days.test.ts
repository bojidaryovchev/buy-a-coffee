import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  daysFromPeriod,
  endOfMonth,
  formatDay,
  formatDayRange,
  isDay,
  periodFromDays,
  periodLength,
  sofiaDayOf,
  sofiaDayStart,
  todayInSofia,
} from "@/lib/promotions/days";

/**
 * A promotion's days, in Sofia, both ways (`lib/promotions/days.ts`): a
 * chosen day is 00:00 Sofia, the last day is whole, and reading the stored
 * instants back gives the days that were chosen — including across the two
 * nights a year the clocks move, when a day is 23 or 25 hours long. These
 * tests do not depend on the machine's own time zone.
 */

const iso = (date: Date) => date.toISOString();

describe("a day's start in Sofia", () => {
  it("is 22:00 UTC the evening before in winter (EET, +2)", () => {
    expect(iso(sofiaDayStart("2026-11-01"))).toBe("2026-10-31T22:00:00.000Z");
    expect(iso(sofiaDayStart("2027-01-01"))).toBe("2026-12-31T22:00:00.000Z");
  });

  it("is 21:00 UTC the evening before in summer (EEST, +3)", () => {
    expect(iso(sofiaDayStart("2026-07-15"))).toBe("2026-07-14T21:00:00.000Z");
  });

  it("is right on the Sunday the clocks go forward, and the day is 23 hours long", () => {
    // 29 March 2026: 03:00 EET becomes 04:00 EEST.
    const start = sofiaDayStart("2026-03-29");
    const next = sofiaDayStart("2026-03-30");
    expect(iso(start)).toBe("2026-03-28T22:00:00.000Z");
    expect(iso(next)).toBe("2026-03-29T21:00:00.000Z");
    expect(next.getTime() - start.getTime()).toBe(23 * 3600 * 1000);
  });

  it("is right on the Sunday the clocks go back, and the day is 25 hours long", () => {
    // 25 October 2026: 04:00 EEST becomes 03:00 EET.
    const start = sofiaDayStart("2026-10-25");
    const next = sofiaDayStart("2026-10-26");
    expect(iso(start)).toBe("2026-10-24T21:00:00.000Z");
    expect(iso(next)).toBe("2026-10-25T22:00:00.000Z");
    expect(next.getTime() - start.getTime()).toBe(25 * 3600 * 1000);
  });

  it("refuses what is not a date", () => {
    expect(() => sofiaDayStart("2026-02-30")).toThrow(RangeError);
    expect(() => sofiaDayStart("1.11.2026")).toThrow(RangeError);
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay(undefined)).toBe(false);
  });
});

describe("the Sofia day of an instant", () => {
  it("turns at Sofia's midnight, not UTC's", () => {
    expect(sofiaDayOf(new Date("2026-10-31T21:59:59.999Z"))).toBe("2026-10-31");
    expect(sofiaDayOf(new Date("2026-10-31T22:00:00.000Z"))).toBe("2026-11-01");
    expect(sofiaDayOf(new Date("2026-07-14T20:59:59.999Z"))).toBe("2026-07-14");
    expect(sofiaDayOf(new Date("2026-07-14T21:00:00.000Z"))).toBe("2026-07-15");
  });

  it("is the same day through the repeated hour in October", () => {
    // 00:30 UTC and 01:30 UTC are 03:30 EEST and 03:30 EET: both the 25th.
    expect(sofiaDayOf(new Date("2026-10-25T00:30:00Z"))).toBe("2026-10-25");
    expect(sofiaDayOf(new Date("2026-10-25T01:30:00Z"))).toBe("2026-10-25");
    expect(sofiaDayOf(new Date("2026-10-25T21:59:59Z"))).toBe("2026-10-25");
  });

  it("gives today from a clock", () => {
    expect(todayInSofia(new Date("2026-10-20T21:30:00Z"))).toBe("2026-10-21");
  });
});

describe("a period, both ways", () => {
  it("runs from 00:00 on the first day to 24:00 on the last", () => {
    const period = periodFromDays("2026-11-01", "2026-11-15");
    expect(iso(period.startsAt)).toBe("2026-10-31T22:00:00.000Z");
    expect(iso(period.endsAt)).toBe("2026-11-15T22:00:00.000Z");
    expect(daysFromPeriod(period)).toEqual({ startDay: "2026-11-01", endDay: "2026-11-15" });
  });

  it("is one whole day when it starts and ends on the same day", () => {
    const period = periodFromDays("2026-12-24", "2026-12-24");
    expect(period.endsAt.getTime() - period.startsAt.getTime()).toBe(24 * 3600 * 1000);
    expect(daysFromPeriod(period)).toEqual({ startDay: "2026-12-24", endDay: "2026-12-24" });
  });

  it("survives both clock changes in either direction", () => {
    for (const [start, end] of [
      ["2026-03-20", "2026-04-05"],
      ["2026-10-20", "2026-11-03"],
      ["2026-03-29", "2026-03-29"],
      ["2026-10-25", "2026-10-25"],
      ["2026-10-24", "2026-10-24"],
      ["2026-03-28", "2026-03-28"],
    ] as const) {
      expect(daysFromPeriod(periodFromDays(start, end))).toEqual({ startDay: start, endDay: end });
    }
  });

  it("ends at the start of the day after across the October change", () => {
    const period = periodFromDays("2026-10-20", "2026-10-25");
    expect(iso(period.endsAt)).toBe("2026-10-25T22:00:00.000Z");
  });
});

describe("day arithmetic", () => {
  it("moves by calendar days, across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-20", 6)).toBe("2026-10-26");
  });

  it("counts days and period lengths", () => {
    expect(daysBetween("2026-11-01", "2026-11-15")).toBe(14);
    expect(daysBetween("2026-11-15", "2026-11-01")).toBe(-14);
    expect(periodLength("2026-11-01", "2026-11-15")).toBe(15);
    expect(periodLength("2026-03-28", "2026-03-30")).toBe(3);
  });

  it("finds the end of the month", () => {
    expect(endOfMonth("2026-10-20")).toBe("2026-10-31");
    expect(endOfMonth("2026-02-03")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-03")).toBe("2028-02-29");
    expect(endOfMonth("2026-12-31")).toBe("2026-12-31");
  });
});

describe("days in words", () => {
  it("says a run of days as briefly as it reads", () => {
    expect(formatDayRange("2026-11-01", "2026-11-15")).toBe("1–15 ноември 2026");
    expect(formatDayRange("2026-11-05", "2026-11-05")).toBe("5 ноември 2026");
    expect(formatDayRange("2026-10-28", "2026-11-03")).toBe("28 октомври – 3 ноември 2026");
    expect(formatDayRange("2026-12-28", "2027-01-03")).toBe("28 декември 2026 – 3 януари 2027");
  });

  it("says one day with or without its year", () => {
    expect(formatDay("2026-11-15")).toBe("15 ноември 2026");
    expect(formatDay("2026-05-01", { year: false })).toBe("1 май");
  });
});
