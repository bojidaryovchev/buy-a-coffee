import { describe, expect, it } from "vitest";
import { copyOfPromotion } from "@/lib/promotions/copy";
import { periodFromDays } from "@/lib/promotions/days";

/**
 * "Дублирай" (`lib/promotions/copy.ts`): what the new-promotion editor opens
 * with. Nothing is written by it; these are the values the owner sees and
 * saves, or does not.
 */

const targets = {
  productIds: [],
  brandIds: ["6f1f9a52-3c2b-4c62-9a0e-2a6b7f1d9e01"],
  categoryIds: [],
  excludedProductIds: [],
};

describe("a copy of a promotion", () => {
  it("has the same choice, for as many days, from tomorrow", () => {
    const copy = copyOfPromotion(
      {
        name: "Есен — Lavazza",
        label: "Есенни дни",
        percentOff: 25,
        ...periodFromDays("2026-10-01", "2026-10-15"),
        targets,
      },
      "2026-10-20",
    );
    expect(copy).toEqual({
      name: "Есен — Lavazza (копие)",
      label: "Есенни дни",
      percent: "25",
      startDay: "2026-10-21",
      endDay: "2026-11-04",
      targets,
    });
  });

  it("keeps the name within the limit, and works across the clock change", () => {
    const copy = copyOfPromotion(
      {
        name: "x".repeat(80),
        label: null,
        percentOff: 10,
        ...periodFromDays("2026-10-24", "2026-10-26"),
        targets,
      },
      "2026-10-24",
    );
    expect(copy.name).toHaveLength(80);
    expect(copy.name.endsWith(" (копие)")).toBe(true);
    expect(copy.label).toBe("");
    expect([copy.startDay, copy.endDay]).toEqual(["2026-10-25", "2026-10-27"]);
  });
});
