import { describe, expect, it, vi } from "vitest";

/*
 * `@/lib/db` opens a pool the moment it is imported and throws when there is
 * no `DATABASE_URL`. The naming rule below is pure and must be testable
 * anywhere, so the module is replaced by an inert stand-in here. The same rule
 * against a real catalog is `vending.db.test.ts`.
 */
vi.mock("@/lib/db", () => ({ db: {} }));

import { isVendingBlendName } from "@/lib/catalog/vending";

/**
 * Which products the vending page shows: the naming rule as a pure function.
 */

describe("isVendingBlendName", () => {
  it.each([
    "Кафе на зърна Elia Vending Aroma 1кг.",
    "Кафе на зърна Elia Vending Crema 1кг.",
    "Кафе на зърна Elia Vending Intenso 1кг.",
    "VENDING blend",
    "Кафе за вендинг 1кг.",
    "Вендинг смес",
    "Espresso (Vending)",
    "Vending",
  ])("accepts %s", (name) => {
    expect(isVendingBlendName(name)).toBe(true);
  });

  it.each([
    // Suits automatic machines according to our copy, but is not named for it.
    "Кафе на зърна Vandino Espresso Aroma 1кг.",
    "Кафе на зърна Lavazza Crema E Aroma 1кг.",
    // The word has to stand alone.
    "Vendingo Classic",
    "Nonvending",
    "Вендингова смес",
    "Vend",
    "",
  ])("rejects %s", (name) => {
    expect(isVendingBlendName(name)).toBe(false);
  });
});
