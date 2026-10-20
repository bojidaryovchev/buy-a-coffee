import { describe, expect, it } from "vitest";
import { PROMOTION_MAX_PERCENT as DATABASE_MAX_PERCENT } from "@catalog/db/schema";
import {
  PROMOTION_MAX_DAYS,
  PROMOTION_MAX_PERCENT,
  PROMOTION_MESSAGES,
  needsConfirmation,
  parsePercent,
  promotionFormSchema,
  promotionPreviewSchema,
  type PromotionFormInput,
} from "@/lib/promotions/schemas";
import { addDays, todayInSofia } from "@/lib/promotions/days";

/**
 * The promotion editor's schema (`lib/promotions/schemas.ts`), which the form
 * and the server action both validate with: what is required, the 1–50%
 * range, the confirmation above 20% (on the server too), the days, and what
 * a running promotion may no longer change.
 */

const TODAY = "2026-10-20";
const BRAND = "6f1f9a52-3c2b-4c62-9a0e-2a6b7f1d9e01";
const PRODUCT = "0c9a3b1e-77d4-4f0e-8a54-5b2a1c9d3e02";

const targets = (value: object) => JSON.stringify(value);

const valid = (overrides: Partial<PromotionFormInput> = {}): PromotionFormInput => ({
  id: "",
  version: "",
  name: "Есен — Lavazza",
  label: "Есенни дни",
  percent: "10",
  confirmHigh: "",
  startDay: TODAY,
  endDay: "2026-10-26",
  targets: targets({ brandIds: [BRAND] }),
  ...overrides,
});

function errorsOf(input: PromotionFormInput, mode: "new" | "upcoming" | "running" = "new") {
  const result = promotionFormSchema(mode, TODAY).safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path[0], issue.message]));
}

describe("the cap", () => {
  it("is the database's", () => {
    expect(PROMOTION_MAX_PERCENT).toBe(DATABASE_MAX_PERCENT);
  });
});

describe("a new promotion", () => {
  it("passes with a name, a percentage, days and something to cover", () => {
    const result = promotionFormSchema("new", TODAY).parse(valid());
    expect(result).toMatchObject({
      id: null,
      name: "Есен — Lavazza",
      label: "Есенни дни",
      percentOff: 10,
      startDay: TODAY,
      endDay: "2026-10-26",
      targets: { brandIds: [BRAND], productIds: [], categoryIds: [], excludedProductIds: [] },
    });
  });

  it("needs a name, and keeps the label optional", () => {
    expect(errorsOf(valid({ name: "   " }))).toEqual({ name: PROMOTION_MESSAGES.name });
    const result = promotionFormSchema("new", TODAY).parse(valid({ label: "  " }));
    expect(result.label).toBeNull();
    expect(errorsOf(valid({ label: "x".repeat(41) }))).toEqual({
      label: PROMOTION_MESSAGES.labelLong,
    });
  });

  it("takes a whole percentage from 1 to 50 and nothing else", () => {
    for (const bad of ["", "0", "51", "12.5", "-5", "abc", "100"]) {
      expect(errorsOf(valid({ percent: bad }))).toEqual({ percent: PROMOTION_MESSAGES.percent });
    }
    expect(parsePercent("1")).toBe(1);
    expect(parsePercent(" 50 ")).toBe(50);
  });

  it("asks for a confirmation above 20%, of that very percentage", () => {
    expect(needsConfirmation(20)).toBe(false);
    expect(needsConfirmation(21)).toBe(true);
    expect(errorsOf(valid({ percent: "20" }))).toEqual({});
    expect(errorsOf(valid({ percent: "30" }))).toEqual({
      confirmHigh: PROMOTION_MESSAGES.confirm(30),
    });
    // A confirmation of 25% is not a confirmation of 30%.
    expect(errorsOf(valid({ percent: "30", confirmHigh: "25" }))).toEqual({
      confirmHigh: PROMOTION_MESSAGES.confirm(30),
    });
    expect(errorsOf(valid({ percent: "30", confirmHigh: "30" }))).toEqual({});
  });

  it("starts today or later, ends on or after its start, and lasts at most the maximum", () => {
    expect(errorsOf(valid({ startDay: "2026-10-19" }))).toEqual({
      startDay: PROMOTION_MESSAGES.startPast,
    });
    expect(errorsOf(valid({ startDay: "2026-10-25", endDay: "2026-10-24" }))).toEqual({
      endDay: PROMOTION_MESSAGES.endBeforeStart,
    });
    expect(errorsOf(valid({ startDay: TODAY, endDay: TODAY }))).toEqual({});
    const lastAllowed = "2026-12-18"; // 60 days from 20 October, both counted
    expect(errorsOf(valid({ endDay: lastAllowed }))).toEqual({});
    expect(errorsOf(valid({ endDay: "2026-12-19" }))).toEqual({
      endDay: PROMOTION_MESSAGES.tooLong,
    });
    expect(PROMOTION_MAX_DAYS).toBe(60);
    expect(errorsOf(valid({ startDay: "", endDay: "15.11.2026" }))).toEqual({
      startDay: PROMOTION_MESSAGES.startDay,
      endDay: PROMOTION_MESSAGES.endDay,
    });
  });

  it("starts at most a year ahead, and answers an absurd year with a message, not a crash", () => {
    expect(errorsOf(valid({ startDay: "2027-10-20", endDay: "2027-10-26" }))).toEqual({});
    expect(errorsOf(valid({ startDay: "2027-10-21", endDay: "2027-10-27" }))).toEqual({
      startDay: PROMOTION_MESSAGES.startFar,
    });
    expect(errorsOf(valid({ startDay: "9999-12-30", endDay: "9999-12-31" }))).toEqual({
      startDay: PROMOTION_MESSAGES.startFar,
    });
    expect(errorsOf(valid({ startDay: "0001-01-01", endDay: "0001-01-02" }))).toEqual({
      startDay: PROMOTION_MESSAGES.startDay,
      endDay: PROMOTION_MESSAGES.endDay,
    });
    expect(errorsOf(valid({ endDay: "9999-12-31" }))).toEqual({
      endDay: PROMOTION_MESSAGES.tooLong,
    });
    expect(errorsOf(valid({ startDay: "0999-01-01", endDay: "0999-01-02" }))).toMatchObject({
      startDay: PROMOTION_MESSAGES.startPast,
    });
  });

  it("needs a brand, a category or a product; exclusions alone are not a promotion", () => {
    expect(errorsOf(valid({ targets: targets({}) }))).toEqual({
      targets: PROMOTION_MESSAGES.targets,
    });
    expect(errorsOf(valid({ targets: targets({ excludedProductIds: [PRODUCT] }) }))).toEqual({
      targets: PROMOTION_MESSAGES.targets,
    });
    expect(errorsOf(valid({ targets: targets({ productIds: [PRODUCT] }) }))).toEqual({});
  });

  it("refuses targets it cannot read, as a page to reload", () => {
    expect(errorsOf(valid({ targets: "{not json" }))).toEqual({
      targets: PROMOTION_MESSAGES.targetsBroken,
    });
    expect(errorsOf(valid({ targets: targets({ brandIds: ["not-a-uuid"] }) }))).toEqual({
      targets: PROMOTION_MESSAGES.targetsBroken,
    });
  });

  it("drops repeated ids", () => {
    const result = promotionFormSchema("new", TODAY).parse(
      valid({ targets: targets({ productIds: [PRODUCT, PRODUCT] }) }),
    );
    expect(result.targets.productIds).toEqual([PRODUCT]);
  });
});

describe("a saved promotion", () => {
  const saved = (overrides: Partial<PromotionFormInput> = {}) =>
    valid({ id: PRODUCT, version: "1792339200123", ...overrides });

  it("carries the version it was drawn from", () => {
    expect(errorsOf(saved({ version: "" }), "upcoming")).toEqual({
      version: PROMOTION_MESSAGES.noVersion,
    });
    expect(errorsOf(saved(), "upcoming")).toEqual({});
  });

  it("when running, may keep a first day in the past and needs no new confirmation", () => {
    const running = saved({ startDay: "2026-10-01", percent: "30", confirmHigh: "" });
    expect(errorsOf(running, "running")).toEqual({});
    expect(errorsOf(running, "upcoming")).toMatchObject({
      startDay: PROMOTION_MESSAGES.startPast,
    });
  });

  it("when running, still may not end before today", () => {
    expect(errorsOf(saved({ startDay: "2026-10-01", endDay: "2026-10-19" }), "running")).toEqual({
      endDay: PROMOTION_MESSAGES.endPast,
    });
  });
});

describe("the preview's question", () => {
  // The preview asks the clock, so its days are today's, whenever this runs.
  const today = todayInSofia();
  const base = {
    startDay: today,
    endDay: addDays(today, 6),
    targets: { brandIds: [BRAND] },
  };

  it("reads a percentage it can, and leaves one it cannot as none", () => {
    expect(promotionPreviewSchema.parse({ ...base, percent: "15" }).percent).toBe(15);
    expect(promotionPreviewSchema.parse({ ...base, percent: "" }).percent).toBeNull();
  });

  it("is not worked on for days the form could not save", () => {
    const days = (startDay: string, endDay: string) =>
      promotionPreviewSchema.safeParse({ ...base, startDay, endDay, percent: "15" }).success;
    expect(days("", addDays(today, 6))).toBe(false);
    expect(days("9999-12-30", "9999-12-31")).toBe(false);
    expect(days(today, "9999-12-31")).toBe(false);
    expect(days(addDays(today, 6), today)).toBe(false);
    expect(days(addDays(today, 400), addDays(today, 401))).toBe(false);
    // A running promotion's first day, weeks back, is one it could save.
    expect(days(addDays(today, -20), addDays(today, 5))).toBe(true);
  });
});
