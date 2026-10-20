import { describe, expect, it } from "vitest";
import {
  promotionPrice,
  reducedCents,
  referenceInstant,
  referenceOutcome,
  referencePrice,
  referenceWindowStart,
  regularPricesInWindow,
  settledReferenceFloor,
  type PriceChange,
  type ReferenceInput,
} from "@/lib/promotions/reference";

/**
 * The 30-day lowest price (`lib/promotions/reference.ts`), the figure a
 * promotion's struck price and badge are computed against, on fixture
 * histories. The rule (Directive 98/6/EC, Art. 6a) is that the struck price
 * is the lowest price applied in the 30 days before the reduction; every
 * uncertain case here must come out low, and one with no history to vouch for
 * a price must come out as no claim at all.
 */

const DAY = 24 * 60 * 60 * 1000;
/** T: the reduction begins at 00:00 Sofia, 1 November 2026. */
const T = Date.parse("2026-10-31T22:00:00Z");
/** 00:00 Sofia on 2 October, in summer time: 30 calendar days and an hour before T. */
const WINDOW_START = Date.parse("2026-10-01T21:00:00Z");

const change = (daysBeforeT: number, before: string | null, after: string | null): PriceChange => ({
  at: T - daysBeforeT * DAY,
  before,
  after,
});

/** A change recorded for something else: `catalog:link` moving a product. */
const moved = (daysBeforeT: number): PriceChange => ({ at: T - daysBeforeT * DAY });

const input = (overrides: Partial<ReferenceInput> = {}): ReferenceInput => ({
  referenceAt: T,
  changes: [],
  currentPrice: "20.00",
  override: null,
  firstSeenAt: T - 90 * DAY,
  earlier: [],
  ...overrides,
});

describe("the promotion price", () => {
  it("rounds down to the cent, as the price layer does", () => {
    expect(promotionPrice("9.95", 10)).toBe("8.95"); // 8.955
    expect(promotionPrice("20.00", 15)).toBe("17.00");
    expect(promotionPrice("12.99", 33)).toBe("8.70"); // 8.7033
    expect(promotionPrice("0.01", 50)).toBe("0.00");
    expect(promotionPrice(null, 10)).toBeNull();
    expect(reducedCents(1999n, 25)).toBe(1499n); // 14.9925
  });
});

describe("T", () => {
  it("is the start, or the moment a product joined a running promotion", () => {
    const start = new Date("2026-11-01T00:00:00Z");
    const before = new Date("2026-10-25T00:00:00Z");
    const after = new Date("2026-11-03T10:00:00Z");
    expect(referenceInstant(start, before)).toBe(start);
    expect(referenceInstant(start, after)).toBe(after);
  });
});

describe("the window", () => {
  it("opens at the same Sofia time 30 calendar days before, not 720 hours", () => {
    expect(referenceWindowStart(T)).toBe(WINDOW_START);
    expect(T - WINDOW_START).toBe(30 * DAY + 60 * 60 * 1000);
    // 10:15 Sofia on 10 November (EET) → 10:15 Sofia on 11 October (EEST).
    expect(referenceWindowStart(Date.parse("2026-11-10T08:15:00Z"))).toBe(
      Date.parse("2026-10-11T07:15:00Z"),
    );
    // Wholly in winter: exactly 30 × 24 hours.
    const january = Date.parse("2027-01-31T10:00:00Z");
    expect(january - referenceWindowStart(january)).toBe(30 * DAY);
  });

  it("counts a price set in the hour the clock change adds", () => {
    // T = 00:00 Sofia, 11 November; the window opens at 00:00 Sofia, 12 October.
    const t = Date.parse("2026-11-10T22:00:00Z");
    const changes: PriceChange[] = [
      { at: Date.parse("2026-09-01T09:00:00Z"), before: "15.00", after: "12.00" },
      // 00:30 Sofia on 12 October: inside the window, though more than 720 hours before T.
      { at: Date.parse("2026-10-11T21:30:00Z"), before: "12.00", after: "20.00" },
    ];
    expect(referencePrice(input({ referenceAt: t, changes, firstSeenAt: t - 90 * DAY }))).toBe(
      "12.00",
    );
  });
});

describe("the regular prices in the window", () => {
  const prices = (overrides: Partial<ReferenceInput>) =>
    regularPricesInWindow(input(overrides), WINDOW_START, T);

  it("is the current price for a product the sync never changed", () => {
    expect(prices({})).toEqual({ atStart: 2000n, within: [] });
  });

  it("is the override, constant, whatever the source did", () => {
    expect(prices({ changes: [change(10, "25.00", "15.00")], override: "22.00" })).toEqual({
      atStart: 2200n,
      within: [],
    });
  });

  it("takes the price at the window's start from the last change before it", () => {
    const changes = [change(60, null, "18.00"), change(40, "18.00", "21.00")];
    expect(prices({ changes })).toEqual({ atStart: 2100n, within: [] });
  });

  it("takes it from the first change after, when there is none before", () => {
    expect(prices({ changes: [change(10, "23.00", "20.00")] })).toEqual({
      atStart: 2300n,
      within: [2000n],
    });
  });

  it("adds every price set within the window, and nothing set after T", () => {
    const changes = [
      change(45, null, "20.00"),
      change(20, "20.00", "17.50"),
      change(5, "17.50", "19.00"),
      change(-2, "19.00", "10.00"),
    ];
    expect(prices({ changes })).toEqual({ atStart: 2000n, within: [1750n, 1900n] });
  });

  it("counts a change exactly at T, and one exactly at the window's start as its opening price", () => {
    const atStart = { at: WINDOW_START, before: "30.00", after: "24.00" };
    const atT = { at: T, before: "24.00", after: "22.00" };
    expect(prices({ changes: [atStart, atT] })).toEqual({ atStart: 2400n, within: [2200n] });
  });

  it("passes over a change that does not carry the price", () => {
    // `catalog:link` moved the product 35 days before T: its change says
    // nothing about the price, and must not stand for "no price".
    const changes = [change(40, "22.00", "21.00"), moved(35), moved(10)];
    expect(prices({ changes })).toEqual({ atStart: 2100n, within: [] });
    // Nor, before the first priced change, for the price before it.
    const later = [moved(25), change(12, "23.00", "20.00")];
    expect(prices({ changes: later })).toEqual({ atStart: 2300n, within: [2000n] });
  });

  it("skips a price set to nothing within the window", () => {
    const changes = [change(40, null, "18.00"), change(15, "18.00", null)];
    expect(prices({ changes })).toEqual({ atStart: 1800n, within: [] });
  });
});

describe("the reference price", () => {
  it("is the regular price when nothing moved", () => {
    expect(referenceOutcome(input())).toEqual({ price: "20.00", reason: "ok" });
  });

  it("is the lowest regular price of the window", () => {
    const changes = [change(25, "20.00", "18.40"), change(3, "18.40", "21.00")];
    expect(referencePrice(input({ changes, currentPrice: "21.00" }))).toBe("18.40");
  });

  it("forgets a price older than the window", () => {
    const changes = [change(31, "15.00", "20.00")];
    expect(referencePrice(input({ changes }))).toBe("20.00");
  });

  it("is not erased by a move between its last price and the window", () => {
    const changes = [change(40, "22.00", "19.00"), moved(35), change(5, "19.00", "20.00")];
    expect(referencePrice(input({ changes }))).toBe("19.00");
  });

  it("claims nothing for a product the shop has had for less than 30 days", () => {
    expect(referenceOutcome(input({ firstSeenAt: T - 10 * DAY }))).toEqual({
      price: null,
      reason: "new",
    });
    // Created inside the window, its creation recorded: still nothing.
    const changes = [{ at: T - 10 * DAY, after: "19.00" }];
    expect(referencePrice(input({ changes, firstSeenAt: T - 10 * DAY }))).toBeNull();
    // Not even with a price pinned by the owner.
    expect(referencePrice(input({ override: "18.00", firstSeenAt: T - 10 * DAY }))).toBeNull();
  });

  it("claims nothing when the product had no price when the window opened", () => {
    const changes = [change(40, "20.00", null), change(15, null, "19.00")];
    expect(referenceOutcome(input({ changes, currentPrice: "19.00" }))).toEqual({
      price: null,
      reason: "noPrice",
    });
    expect(referenceOutcome(input({ currentPrice: null }))).toEqual({
      price: null,
      reason: "noPrice",
    });
  });

  it("counts an earlier promotion overlapping the window, at the window's lowest price", () => {
    const earlier = [{ percentOff: 10, from: T - 20 * DAY, to: T - 10 * DAY }];
    // 20.00 less 10%: 18.00, as if it had been charged.
    expect(referencePrice(input({ earlier }))).toBe("18.00");
  });

  it("is conservative: an earlier promotion is applied to the lowest price, not its own", () => {
    const changes = [change(25, "20.00", "16.00"), change(12, "16.00", "20.00")];
    // The 25% promotion ran while the price was 20.00 (it charged 15.00), but
    // the window's lowest is 16.00: 16.00 less 25% is 12.00, lower still.
    const earlier = [{ percentOff: 25, from: T - 10 * DAY, to: T - 2 * DAY }];
    expect(referencePrice(input({ changes, earlier }))).toBe("12.00");
  });

  it("takes the deepest of several earlier promotions", () => {
    const earlier = [
      { percentOff: 5, from: T - 28 * DAY, to: T - 21 * DAY },
      { percentOff: 30, from: T - 14 * DAY, to: T - 7 * DAY },
    ];
    expect(referencePrice(input({ earlier }))).toBe("14.00");
  });

  it("counts one that ended exactly at T, and not one that ended before the window", () => {
    const touching = [{ percentOff: 20, from: T - 7 * DAY, to: T }];
    expect(referencePrice(input({ earlier: touching }))).toBe("16.00");
    const old = [{ percentOff: 20, from: T - 60 * DAY, to: WINDOW_START }];
    expect(referencePrice(input({ earlier: old }))).toBe("20.00");
  });

  it("does not count one that starts at T or later: it did not come before", () => {
    const together = [{ percentOff: 20, from: T, to: T + 7 * DAY }];
    expect(referencePrice(input({ earlier: together }))).toBe("20.00");
  });

  it("counts one still running at T", () => {
    const running = [{ percentOff: 15, from: T - 3 * DAY, to: T + 10 * DAY }];
    expect(referencePrice(input({ earlier: running }))).toBe("17.00");
  });

  it("ignores an empty stretch (a product that left the moment it joined)", () => {
    const empty = [{ percentOff: 40, from: T - 5 * DAY, to: T - 5 * DAY }];
    expect(referencePrice(input({ earlier: empty }))).toBe("20.00");
  });

  it("rounds an earlier promotion's price down, like the shop did", () => {
    const earlier = [{ percentOff: 10, from: T - 5 * DAY, to: T - 1 * DAY }];
    expect(referencePrice(input({ currentPrice: "9.95", earlier }))).toBe("8.95");
  });

  it("works for a T still ahead with the history known so far", () => {
    const later = T + 5 * DAY;
    const changes = [change(20, "20.00", "18.00")];
    expect(referencePrice(input({ referenceAt: later, changes, currentPrice: "18.00" }))).toBe(
      "18.00",
    );
  });

  it("is exact on prices that floats get wrong", () => {
    const changes = [
      change(40, "0.40", "0.30"),
      change(10, "0.30", "0.10"),
      change(5, "0.10", "0.20"),
    ];
    expect(referencePrice(input({ changes, currentPrice: "0.20" }))).toBe("0.10");
    expect(referencePrice(input({ currentPrice: "1234567.89" }))).toBe("1234567.89");
  });
});

describe("a settled reference's floor", () => {
  const NOW = T + 10 * DAY;
  const floor = (others: { percentOff: number; from: number; to: number }[], percentOff = 10) =>
    settledReferenceFloor({
      referenceAt: T,
      now: NOW,
      percentOff,
      changes: [],
      currentPrice: "20.00",
      override: null,
      others,
    });

  it("is what a deeper promotion charged since T", () => {
    expect(floor([{ percentOff: 30, from: T + 2 * DAY, to: T + 5 * DAY }])).toBe(1400n);
    // Still running now: it has charged already.
    expect(floor([{ percentOff: 25, from: T + 9 * DAY, to: T + 20 * DAY }])).toBe(1500n);
  });

  it("is nothing for a smaller or equal one, which never priced it while this one ran", () => {
    expect(floor([{ percentOff: 5, from: T + 2 * DAY, to: T + 5 * DAY }])).toBeNull();
    expect(floor([{ percentOff: 10, from: T + 2 * DAY, to: T + 5 * DAY }])).toBeNull();
  });

  it("is nothing for one before T, or one not started yet", () => {
    expect(floor([{ percentOff: 30, from: T - 9 * DAY, to: T - 2 * DAY }])).toBeNull();
    expect(floor([{ percentOff: 30, from: NOW, to: NOW + DAY }])).toBeNull();
  });

  it("takes the regular price's lowest since T", () => {
    const value = settledReferenceFloor({
      referenceAt: T,
      now: NOW,
      percentOff: 10,
      changes: [change(-3, "20.00", "16.00"), change(-6, "16.00", "20.00")],
      currentPrice: "20.00",
      override: null,
      others: [{ percentOff: 50, from: T + 7 * DAY, to: T + 8 * DAY }],
    });
    expect(value).toBe(800n);
  });
});
