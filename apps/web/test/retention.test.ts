import { describe, expect, it } from "vitest";
import { retentionCutoff, selectExpired, type RetentionRow } from "@/lib/retention";
import { INQUIRY_STATUSES } from "@/lib/inquiry-status";

const NOW = new Date("2026-10-15T09:00:00Z");
const monthsAgo = (months: number, days = 0): Date => {
  const d = new Date(NOW.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
};

const row = (id: string, status: string, createdAt: Date): RetentionRow => ({
  id,
  status,
  createdAt,
});

describe("retentionCutoff", () => {
  it("is twelve calendar months back", () => {
    expect(retentionCutoff(NOW).toISOString()).toBe("2025-10-15T09:00:00.000Z");
  });

  it("clamps rather than rolling over at the end of a short month", () => {
    // 29 February 2028 minus 12 months has no 29 February in 2027.
    expect(retentionCutoff(new Date("2028-02-29T00:00:00Z")).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
    expect(retentionCutoff(new Date("2026-03-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });
});

describe("selectExpired — order enquiries", () => {
  it("selects a cancelled or spam enquiry older than 12 months", () => {
    const out = selectExpired({
      now: NOW,
      orders: [row("a", "cancelled", monthsAgo(13)), row("b", "spam", monthsAgo(13))],
      contacts: [],
    });
    expect(out.orderIds.sort()).toEqual(["a", "b"]);
  });

  it("keeps one younger than 12 months, whatever its status", () => {
    const out = selectExpired({
      now: NOW,
      orders: INQUIRY_STATUSES.map((s) => row(s, s, monthsAgo(11))),
      contacts: [],
    });
    expect(out.orderIds).toEqual([]);
    expect(out.awaitingDecision.orders).toBe(0);
  });

  it("keeps one exactly on the boundary and takes one just past it", () => {
    const cutoff = retentionCutoff(NOW);
    const out = selectExpired({
      now: NOW,
      orders: [
        row("on", "cancelled", cutoff),
        row("past", "cancelled", new Date(cutoff.getTime() - 1)),
      ],
      contacts: [],
    });
    expect(out.orderIds).toEqual(["past"]);
  });

  it("never selects an enquiry that became an order, at any age", () => {
    const out = selectExpired({
      now: NOW,
      orders: [row("old", "converted", monthsAgo(13)), row("ancient", "converted", monthsAgo(120))],
      contacts: [],
    });
    expect(out.orderIds).toEqual([]);
    expect(out.awaitingDecision.orders).toBe(0);
  });

  it("leaves undecided enquiries alone but counts them", () => {
    const out = selectExpired({
      now: NOW,
      orders: [row("n", "new", monthsAgo(14)), row("c", "contacted", monthsAgo(14))],
      contacts: [],
    });
    expect(out.orderIds).toEqual([]);
    expect(out.awaitingDecision.orders).toBe(2);
  });

  it("treats a status it does not know as undecided, not deletable", () => {
    const out = selectExpired({
      now: NOW,
      orders: [row("x", "refunded", monthsAgo(20))],
      contacts: [],
    });
    expect(out.orderIds).toEqual([]);
    expect(out.awaitingDecision.orders).toBe(1);
  });
});

describe("selectExpired — contact messages", () => {
  it("selects a closed conversation older than 12 months", () => {
    const out = selectExpired({
      now: NOW,
      orders: [],
      contacts: [
        row("done", "converted", monthsAgo(13)),
        row("no", "cancelled", monthsAgo(13)),
        row("spam", "spam", monthsAgo(13)),
      ],
    });
    expect(out.contactIds.sort()).toEqual(["done", "no", "spam"]);
  });

  it("keeps an open conversation, however old, and counts it", () => {
    const out = selectExpired({
      now: NOW,
      orders: [],
      contacts: [row("n", "new", monthsAgo(30)), row("c", "contacted", monthsAgo(30))],
    });
    expect(out.contactIds).toEqual([]);
    expect(out.awaitingDecision.contacts).toBe(2);
  });

  it("keeps a closed conversation younger than 12 months", () => {
    const out = selectExpired({
      now: NOW,
      orders: [],
      contacts: [row("recent", "cancelled", monthsAgo(11))],
    });
    expect(out.contactIds).toEqual([]);
  });

  it("does not mix the two tables", () => {
    const out = selectExpired({
      now: NOW,
      orders: [row("o", "cancelled", monthsAgo(13))],
      contacts: [row("c", "cancelled", monthsAgo(13))],
    });
    expect(out.orderIds).toEqual(["o"]);
    expect(out.contactIds).toEqual(["c"]);
  });

  it("handles nothing at all", () => {
    expect(selectExpired({ now: NOW, orders: [], contacts: [] })).toEqual({
      orderIds: [],
      contactIds: [],
      awaitingDecision: { orders: 0, contacts: 0 },
    });
  });
});
