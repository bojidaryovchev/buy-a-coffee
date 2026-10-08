import { describe, expect, it } from "vitest";
import { WEEK_DAYS, siteConfig, type OpeningHoursRange } from "@/config/site";
import {
  NEUTRAL_NEXT_STEP,
  callbackSentence,
  describeDay,
  nextCallbackWindow,
  shopClock,
} from "@/lib/forms/callback-window";

/**
 * The success-state sentence: when to expect the call.
 *
 * Times below are UTC instants, with the Sofia wall-clock time in a comment.
 * Sofia is UTC+2 in winter and UTC+3 from 01:00 UTC on the last Sunday of March
 * until 01:00 UTC on the last Sunday of October (2026: 29 March and 25
 * October), so a function that assumed a fixed offset would be wrong in exactly
 * the cases the summer ones pin.
 */

const WEEKDAYS_9_18: readonly OpeningHoursRange[] = [
  { from: "monday", to: "friday", opens: "09:00", closes: "18:00" },
];

const at = (iso: string) => new Date(iso);
const window = (iso: string, hours = WEEKDAYS_9_18) => nextCallbackWindow(at(iso), hours);

describe("shopClock", () => {
  it("reads the Sofia wall clock in winter (UTC+2)", () => {
    expect(shopClock(at("2026-01-14T10:00:00Z"))).toEqual({
      weekday: "wednesday",
      minutes: 12 * 60,
    });
  });

  it("reads the Sofia wall clock in summer (UTC+3)", () => {
    expect(shopClock(at("2026-07-15T10:00:00Z"))).toEqual({
      weekday: "wednesday",
      minutes: 13 * 60,
    });
  });

  it("rolls the weekday over at Sofia midnight, not UTC midnight", () => {
    // 22:00 UTC on Tuesday is 00:00 on Wednesday in Sofia, and minute 0, not 1440.
    expect(shopClock(at("2026-01-13T22:00:00Z"))).toEqual({ weekday: "wednesday", minutes: 0 });
  });
});

describe("nextCallbackWindow: Monday to Friday, 09:00-18:00", () => {
  it("inside hours: today", () => {
    expect(window("2026-01-14T10:00:00Z")).toEqual({ daysAhead: 0, weekday: "wednesday" }); // 12:00
  });

  it("the minute before closing: still today; at closing: tomorrow", () => {
    expect(window("2026-01-14T15:59:00Z")?.daysAhead).toBe(0); // 17:59
    expect(window("2026-01-14T16:00:00Z")).toEqual({ daysAhead: 1, weekday: "thursday" }); // 18:00
  });

  it("before opening on a working day: today", () => {
    expect(window("2026-01-14T06:59:00Z")?.daysAhead).toBe(0); // 08:59
    expect(window("2026-01-14T07:00:00Z")?.daysAhead).toBe(0); // 09:00 exactly
  });

  it("after closing: the next working day", () => {
    expect(window("2026-01-14T17:00:00Z")).toEqual({ daysAhead: 1, weekday: "thursday" }); // 19:00
  });

  it("Friday after closing: Monday, three days on", () => {
    expect(window("2026-01-16T16:00:00Z")).toEqual({ daysAhead: 3, weekday: "monday" }); // Fri 18:00
  });

  it("Saturday: Monday", () => {
    expect(window("2026-01-17T10:00:00Z")).toEqual({ daysAhead: 2, weekday: "monday" });
  });

  it("Sunday: Monday, which is tomorrow", () => {
    expect(window("2026-01-18T10:00:00Z")).toEqual({ daysAhead: 1, weekday: "monday" });
  });

  it("uses the Sofia date, not the UTC one", () => {
    // Thursday 22:30 UTC is Friday 00:30 in Sofia: before opening on a working
    // day, so today. Read in UTC it would be Thursday night, and "tomorrow".
    expect(window("2026-01-15T22:30:00Z")).toEqual({ daysAhead: 0, weekday: "friday" });
    // Sunday 22:30 UTC is already Monday 00:30 there.
    expect(window("2026-01-18T22:30:00Z")).toEqual({ daysAhead: 0, weekday: "monday" });
    // Friday 22:30 UTC is Saturday 00:30 there: the weekend, so Monday.
    expect(window("2026-01-16T22:30:00Z")).toEqual({ daysAhead: 2, weekday: "monday" });
  });

  it("in summer time the closing minute moves with the clock", () => {
    // 17:59 and 18:00 in Sofia (UTC+3); a fixed +2 would call these 16:59 and 17:00.
    expect(window("2026-07-15T14:59:00Z")?.daysAhead).toBe(0);
    expect(window("2026-07-15T15:00:00Z")?.daysAhead).toBe(1);
  });
});

describe("daylight-saving changes", () => {
  const SUNDAY_MORNING: readonly OpeningHoursRange[] = [
    { from: "sunday", to: "sunday", opens: "10:00", closes: "12:00" },
  ];

  it("spring forward (Sun 29 March 2026, 01:00 UTC): Sunday before and after the change", () => {
    // 00:30 UTC is 02:30 EET (before the jump): before opening, so today.
    expect(window("2026-03-29T00:30:00Z", SUNDAY_MORNING)?.daysAhead).toBe(0);
    // 08:30 UTC is 11:30 EEST: open.
    expect(window("2026-03-29T08:30:00Z", SUNDAY_MORNING)?.daysAhead).toBe(0);
    // 09:30 UTC is 12:30 EEST: closed. A +2 reading (11:30) would say open.
    expect(window("2026-03-29T09:30:00Z", SUNDAY_MORNING)).toEqual({
      daysAhead: 7,
      weekday: "sunday",
    });
  });

  it("the Friday before the change is a normal winter day", () => {
    expect(window("2026-03-27T15:59:00Z")?.daysAhead).toBe(0); // 17:59 EET
    expect(window("2026-03-27T16:00:00Z")).toEqual({ daysAhead: 3, weekday: "monday" });
  });

  it("the Monday after the change uses summer time", () => {
    expect(window("2026-03-30T14:59:00Z")?.daysAhead).toBe(0); // 17:59 EEST
    expect(window("2026-03-30T15:00:00Z")?.daysAhead).toBe(1); // 18:00 EEST
  });

  it("fall back (Sun 25 October 2026, 01:00 UTC): 03:30 happens twice and means the same", () => {
    const night: readonly OpeningHoursRange[] = [
      { from: "sunday", to: "sunday", opens: "03:15", closes: "04:00" },
    ];
    // 00:30 UTC = 03:30 EEST (first pass), 01:30 UTC = 03:30 EET (second pass).
    expect(shopClock(at("2026-10-25T00:30:00Z")).minutes).toBe(3 * 60 + 30);
    expect(shopClock(at("2026-10-25T01:30:00Z")).minutes).toBe(3 * 60 + 30);
    expect(window("2026-10-25T00:30:00Z", night)?.daysAhead).toBe(0);
    expect(window("2026-10-25T01:30:00Z", night)?.daysAhead).toBe(0);
    // 01:50 UTC is 03:50 EET (open); 02:10 UTC is 04:10 EET (closed).
    expect(window("2026-10-25T01:50:00Z", night)?.daysAhead).toBe(0);
    expect(window("2026-10-25T02:10:00Z", night)?.daysAhead).toBe(7);
  });
});

describe("other shapes of opening hours", () => {
  it("a lunch break: still today during it, tomorrow once the afternoon is over", () => {
    const split: readonly OpeningHoursRange[] = [
      { from: "monday", to: "friday", opens: "09:00", closes: "13:00" },
      { from: "monday", to: "friday", opens: "14:00", closes: "18:00" },
    ];
    expect(window("2026-01-14T11:30:00Z", split)?.daysAhead).toBe(0); // 13:30
    expect(window("2026-01-14T16:00:00Z", split)?.daysAhead).toBe(1); // 18:00
  });

  it("Saturday hours: Friday evening is answered with Saturday, called tomorrow", () => {
    const withSaturday: readonly OpeningHoursRange[] = [
      ...WEEKDAYS_9_18,
      { from: "saturday", to: "saturday", opens: "10:00", closes: "14:00" },
    ];
    expect(window("2026-01-16T17:00:00Z", withSaturday)).toEqual({
      daysAhead: 1,
      weekday: "saturday",
    });
    // Saturday after 14:00: Monday.
    expect(window("2026-01-17T12:00:00Z", withSaturday)).toEqual({
      daysAhead: 2,
      weekday: "monday",
    });
  });

  it("a single open weekday, after its hours: the same weekday next week", () => {
    const mondays: readonly OpeningHoursRange[] = [
      { from: "monday", to: "monday", opens: "09:00", closes: "18:00" },
    ];
    expect(window("2026-01-12T17:00:00Z", mondays)).toEqual({ daysAhead: 7, weekday: "monday" });
  });

  it("unset hours give no window", () => {
    expect(window("2026-01-14T10:00:00Z", [])).toBeNull();
  });

  it("ranges that cannot be read are ignored, not guessed at", () => {
    const junk: readonly OpeningHoursRange[] = [
      { from: "monday", to: "friday", opens: "18:00", closes: "09:00" }, // backwards
      { from: "monday", to: "friday", opens: "09:00", closes: "09:00" }, // no length
      { from: "monday", to: "friday", opens: "9am", closes: "6pm" }, // not HH:MM
      { from: "monday", to: "friday", opens: "09:00", closes: "25:00" }, // not a time
      { from: "friday", to: "monday", opens: "09:00", closes: "18:00" }, // runs backwards
    ];
    expect(window("2026-01-14T10:00:00Z", junk)).toBeNull();
    // ...and one good range among them still counts.
    expect(window("2026-01-14T10:00:00Z", [...junk, ...WEEKDAYS_9_18])?.daysAhead).toBe(0);
  });
});

describe("nextCallbackWindow: every half hour for a year, across both clock changes", () => {
  it("always answers, with a weekday that is open, the right distance away", () => {
    const open = new Set<string>(["monday", "tuesday", "wednesday", "thursday", "friday"]);
    const dayAfter = (from: string, days: number): string =>
      WEEK_DAYS[(WEEK_DAYS.indexOf(from as (typeof WEEK_DAYS)[number]) + days) % 7] as string;
    const start = Date.UTC(2026, 0, 1);

    for (let t = start; t < start + 366 * 24 * 3600_000; t += 30 * 60_000) {
      const now = new Date(t);
      const result = nextCallbackWindow(now, WEEKDAYS_9_18);
      expect(result, now.toISOString()).not.toBeNull();
      const { daysAhead, weekday } = result!;
      const clock = shopClock(now);

      expect(open.has(weekday), now.toISOString()).toBe(true);
      expect(daysAhead).toBeGreaterThanOrEqual(0);
      expect(daysAhead).toBeLessThanOrEqual(3);
      expect(dayAfter(clock.weekday, daysAhead)).toBe(weekday);

      if (daysAhead === 0) {
        // "Today" means a working day whose hours are not over.
        expect(open.has(clock.weekday)).toBe(true);
        expect(clock.minutes).toBeLessThan(18 * 60);
      } else {
        // Anything else means today is not one, and nothing nearer was skipped.
        expect(!open.has(clock.weekday) || clock.minutes >= 18 * 60, now.toISOString()).toBe(true);
        for (let d = 1; d < daysAhead; d += 1)
          expect(open.has(dayAfter(clock.weekday, d))).toBe(false);
      }
    }
  });
});

describe("describeDay", () => {
  it("names today and tomorrow, then the weekday", () => {
    expect(describeDay({ daysAhead: 0, weekday: "wednesday" })).toBe("днес");
    expect(describeDay({ daysAhead: 1, weekday: "thursday" })).toBe("утре");
    expect(describeDay({ daysAhead: 3, weekday: "monday" })).toBe("в понеделник");
  });

  it("uses „във“ before a day that starts with в", () => {
    expect(describeDay({ daysAhead: 2, weekday: "tuesday" })).toBe("във вторник");
  });

  it("says „следващия“ for the same weekday a week on, so it is not read as today", () => {
    expect(describeDay({ daysAhead: 7, weekday: "monday" })).toBe("в следващия понеделник");
    expect(describeDay({ daysAhead: 7, weekday: "wednesday" })).toBe("в следващата сряда");
  });

  it("has a phrase for every weekday", () => {
    for (const weekday of WEEK_DAYS) {
      expect(describeDay({ daysAhead: 2, weekday })).toMatch(/^(в|във) \S+$/);
    }
  });
});

describe("callbackSentence", () => {
  it("a Saturday order is told to expect the call on Monday", () => {
    const sentence = callbackSentence(at("2026-01-17T10:00:00Z"), WEEKDAYS_9_18);
    expect(sentence).toContain("в понеделник, в работно време");
  });

  it("an order inside hours is told today", () => {
    expect(callbackSentence(at("2026-01-14T10:00:00Z"), WEEKDAYS_9_18)).toContain(
      "днес, в работно време",
    );
  });

  it("an order after closing is told tomorrow", () => {
    expect(callbackSentence(at("2026-01-14T17:00:00Z"), WEEKDAYS_9_18)).toContain(
      "утре, в работно време",
    );
  });

  it("prints the hours the window refers to", () => {
    expect(callbackSentence(at("2026-01-14T10:00:00Z"), WEEKDAYS_9_18)).toContain(
      "Пон–Пет, 9:00–18:00",
    );
  });

  it("promises a day, never an hour for the call", () => {
    for (const iso of [
      "2026-01-14T10:00:00Z",
      "2026-01-14T17:00:00Z",
      "2026-01-17T10:00:00Z",
      "2026-07-15T10:00:00Z",
    ]) {
      const sentence = callbackSentence(at(iso), WEEKDAYS_9_18);
      // The only clock times in it are the shop's opening hours, in the one
      // trailing "Работно време: …" clause.
      const beforeHours = sentence.split("Работно време:")[0] ?? "";
      expect(beforeHours).not.toMatch(/\d/);
    }
  });

  it("falls back to the neutral sentence when no hours are set", () => {
    expect(callbackSentence(at("2026-01-14T10:00:00Z"), [])).toBe(NEUTRAL_NEXT_STEP);
    expect(NEUTRAL_NEXT_STEP).not.toMatch(/днес|утре|понеделник|\d/);
  });

  it("works with the shop's real configuration", () => {
    const sentence = callbackSentence(at("2026-01-17T10:00:00Z"), siteConfig.commerce.openingHours);
    expect(sentence).toContain("в понеделник, в работно време");
  });
});
