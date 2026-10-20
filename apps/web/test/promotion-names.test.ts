import { describe, expect, it } from "vitest";
import { chosenProductText } from "@/lib/promotions/picker";

/**
 * How the editor and the record of a finished promotion name a chosen
 * product (`chosenProductText`): by the shop's name, and, when it is not on
 * sale, why — a product the supplier's catalog lacks for now is not one that
 * is gone, and is said in the preview's words.
 */
describe("a chosen product's name", () => {
  const product = { title: "Lavazza Crema e Aroma", detail: "Кафе на зърна, 1 кг" };

  it("is the shop's name, with its pack", () => {
    expect(chosenProductText(product)).toBe("Lavazza Crema e Aroma, Кафе на зърна, 1 кг");
  });

  it("says that one missing from the supplier's catalog is so for now", () => {
    expect(chosenProductText({ ...product, status: "missing" })).toBe(
      "Lavazza Crema e Aroma, Кафе на зърна, 1 кг — временно липсва в каталога на доставчика",
    );
  });

  it("says that a removed one is no longer sold, and so is one nothing is known of", () => {
    expect(chosenProductText({ ...product, status: "removed" })).toMatch(/— вече не се продава$/);
    expect(chosenProductText(undefined)).toBe("Продукт, който вече не се продава");
  });
});
