import { describe, expect, it } from "vitest";
import {
  REFERENCE_WINDOW_MS,
  promotionPrice,
  reducedCents,
  referenceInstant,
  referencePrice,
  regularPricesInWindow,
  type PriceChange,
  type ReferenceInput,
} from "@/lib/promotions/reference";

/**
 * The 30-day lowest price (`lib/promotions/reference.ts`), the figure a
 * promotion's struck price and badge are computed against, on fixture
 * histories. The rule (Directive 98/6/EC, Art. 6a) is that the struck price
 * is the lowest price applied in the 30 days before the reduction; every
 * uncertain case here must come out low, never high.
 */

const DAY = 24 * 60 * 60 * 1000;
/** T: the reduction begins at 00:00 Sofia, 1 November 2026. */
const T = Date.parse("2026-10-31T22:00:00Z");
const WINDOW_START = T - REFERENCE_WINDOW_MS;

const change = (daysBeforeT: number, before: string | null, after: string | null): PriceChange => ({
  at: T - daysBeforeT * DAY,
  before,
  after,
});

const input = (overrides: Partial<ReferenceInput> = {}): ReferenceInput => ({
  referenceAt: T,
  changes: [],
  currentPrice: "20.00",
  override: null,
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

describe("the regular prices in the window", () => {
  it("is the current price for a product the sync never changed", () => {
    expect(regularPricesInWindow(input(), WINDOW_START, T)).toEqual([2000n]);
  });

  it("is the override, constant, whatever the source did", () => {
    const changes = [change(10, "25.00", "15.00")];
    expect(regularPricesInWindow(input({ changes, override: "22.00" }), WINDOW_START, T)).toEqual([
      2200n,
    ]);
  });

  it("takes the price at the window's start from the last change before it", () => {
    const changes = [change(60, null, "18.00"), change(40, "18.00", "21.00")];
    expect(regularPricesInWindow(input({ changes }), WINDOW_START, T)).toEqual([2100n]);
  });

  it("takes it from the first change after, when there is none before", () => {
    const changes = [change(10, "23.00", "20.00")];
    expect(regularPricesInWindow(input({ changes }), WINDOW_START, T)).toEqual([2300n, 2000n]);
  });

  it("adds every price set within the window, and nothing set after T", () => {
    const changes = [
      change(45, null, "20.00"),
      change(20, "20.00", "17.50"),
      change(5, "17.50", "19.00"),
      change(-2, "19.00", "10.00"),
    ];
    expect(regularPricesInWindow(input({ changes }), WINDOW_START, T)).toEqual([
      2000n,
      1750n,
      1900n,
    ]);
  });

  it("counts a change exactly at T, and one exactly at the window's start as its opening price", () => {
    const atStart = { at: WINDOW_START, before: "30.00", after: "24.00" };
    const atT = { at: T, before: "24.00", after: "22.00" };
    expect(regularPricesInWindow(input({ changes: [atStart, atT] }), WINDOW_START, T)).toEqual([
      2400n,
      2200n,
    ]);
  });

  it("knows no price for a product created inside the window before it existed", () => {
    // Created 10 days before T: before that, it was not on sale at any price.
    const changes = [change(10, null, "19.00")];
    expect(regularPricesInWindow(input({ changes }), WINDOW_START, T)).toEqual([1900n]);
  });

  it("skips a stretch without a price", () => {
    const changes = [change(40, null, null), change(15, null, "16.00")];
    expect(regularPricesInWindow(input({ changes }), WINDOW_START, T)).toEqual([1600n]);
  });
});

describe("the reference price", () => {
  it("is the regular price when nothing moved", () => {
    expect(referencePrice(input())).toBe("20.00");
  });

  it("is the lowest regular price of the window", () => {
    const changes = [change(25, "20.00", "18.40"), change(3, "18.40", "21.00")];
    expect(referencePrice(input({ changes, currentPrice: "21.00" }))).toBe("18.40");
  });

  it("forgets a price older than the window", () => {
    const changes = [change(31, "15.00", "20.00")];
    expect(referencePrice(input({ changes }))).toBe("20.00");
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

  it("is null when the product had no price in the window", () => {
    expect(referencePrice(input({ currentPrice: null }))).toBeNull();
    const changes = [change(-1, null, "19.00")];
    expect(referencePrice(input({ changes, currentPrice: "19.00" }))).toBeNull();
  });

  it("works for a T still ahead with the history known so far", () => {
    const later = T + 5 * DAY;
    const changes = [change(20, "20.00", "18.00")];
    // The window [T − 25 d, T + 5 d] still holds the 18.00.
    expect(referencePrice(input({ referenceAt: later, changes, currentPrice: "18.00" }))).toBe(
      "18.00",
    );
  });

  it("is exact on prices that floats get wrong", () => {
    const changes = [change(10, "0.30", "0.10"), change(5, "0.10", "0.20")];
    expect(referencePrice(input({ changes, currentPrice: "0.20" }))).toBe("0.10");
    expect(referencePrice(input({ currentPrice: "1234567.89" }))).toBe("1234567.89");
  });
});
