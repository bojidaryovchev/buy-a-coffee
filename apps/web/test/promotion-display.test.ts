// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProductPrice } from "@/app/(site)/[lang]/[slug]/_components/product-price";
import { HomePromotions } from "@/components/home/sections";
import { promotionLastDay, promotionUntil } from "@/lib/catalog/promotion-days";
import type { ProductCardView } from "@/lib/catalog/types";

vi.mock("next/image", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef<HTMLImageElement, Record<string, unknown>>(function Img(props, ref) {
      const { fill: _fill, priority: _priority, ...rest } = props;
      return React.createElement("img", { ref, ...rest });
    }),
  };
});

/**
 * How the shop says that its own promotion prices a product: the last day in
 * Sofia, the product page's price block, and the home page's band. What the
 * price is lives in the price layer (`price-layer.integration.test.ts`); this
 * is what is said about it, and what is not.
 */

const eur = (amount: string, formatted: string) => ({ amount, currency: "EUR", formatted });

/** The end of 15 November 2026 in Sofia: 00:00 EET on the 16th, UTC+2. */
const END_15_NOVEMBER = "2026-11-15T22:00:00.000Z";
const NOW = new Date("2026-10-20T09:00:00.000Z");

const promotion = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "Есенни дни",
  percentOff: 10,
  endsAt: END_15_NOVEMBER,
  regularPrice: eur("9.95", "9,95 €"),
};

describe("a promotion's last day", () => {
  it("is the Sofia day before the instant it ends, in winter and in summer", () => {
    expect(promotionLastDay(END_15_NOVEMBER)).toBe("2026-11-15");
    // 31 July ends at 00:00 EEST on 1 August, 21:00 UTC.
    expect(promotionLastDay("2026-07-31T21:00:00.000Z")).toBe("2026-07-31");
    // Across the October change: 25 October ends at 00:00 EET on the 26th.
    expect(promotionLastDay("2026-10-25T22:00:00.000Z")).toBe("2026-10-25");
    expect(promotionLastDay("not a date")).toBeNull();
  });

  it("is said in Bulgarian, with the year only when it is not this one", () => {
    expect(promotionUntil(END_15_NOVEMBER, NOW)).toBe("до 15 ноември");
    expect(promotionUntil("2027-01-05T22:00:00.000Z", NOW)).toBe("до 5 януари 2027 г.");
    expect(promotionUntil("", NOW)).toBeNull();
  });
});

type Priced = Parameters<typeof ProductPrice>[0]["product"];

const priced = (patch: Partial<Priced> = {}): Priced => ({
  price: eur("8.95", "8,95 €"),
  oldPrice: null,
  discountPercent: null,
  promotion: null,
  servingPrice: { formatted: "0,56 € на чаша", estimated: false },
  unitPrice: null,
  ...patch,
});

function block(product: Priced) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(ProductPrice, { product, now: NOW }));
  return host;
}

const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("the product page's price under a promotion", () => {
  it("strikes the 30-day lowest price, and names the promotion and its last day", () => {
    const root = block(priced({ oldPrice: eur("9.95", "9,95 €"), discountPercent: 10, promotion }));
    expect(text(root)).toContain("Намалена цена 8,95 €");
    expect(root.querySelector(".line-through")?.textContent).toBe("9,95 €");
    expect(text(root)).toContain("−10%");
    const said = root.querySelector("[data-promotion]");
    expect(text(said)).toContain("Есенни дни. Намалението важи до 15 ноември.");
    expect(text(said)).toContain(
      "Зачеркнатата цена е най-ниската ни цена за последните 30 дни преди намалението.",
    );
    // The price per cup stays directly under the price, before the promotion.
    expect(text(root).indexOf("на чаша")).toBeLessThan(text(root).indexOf("Есенни дни"));
  });

  it("says when it ends without words of its own when the owner gave none", () => {
    const root = block(
      priced({
        oldPrice: eur("9.95", "9,95 €"),
        discountPercent: 10,
        promotion: { ...promotion, label: null },
      }),
    );
    expect(text(root.querySelector("[data-promotion]"))).toMatch(
      /^Намалението важи до 15 ноември\.\s*Зачеркнатата/,
    );
  });

  it("keeps the owner's own punctuation at the end of the promotion's words", () => {
    const root = block(
      priced({
        oldPrice: eur("9.95", "9,95 €"),
        discountPercent: 10,
        promotion: { ...promotion, label: "Есенни дни!" },
      }),
    );
    expect(text(root.querySelector("[data-promotion]"))).toMatch(
      /^Есенни дни! Намалението важи до 15 ноември\./,
    );
  });

  it("claims nothing when the 30-day lowest was no higher: the price, and only the price", () => {
    const root = block(priced({ promotion }));
    expect(text(root)).toContain("8,95 €");
    expect(root.querySelector(".line-through")).toBeNull();
    expect(text(root)).not.toContain("%");
    expect(text(root)).not.toContain("Есенни дни");
    expect(text(root)).not.toContain("до 15 ноември");
    expect(text(root)).not.toContain("30 дни");
    expect(root.innerHTML).not.toContain("clay");
  });

  it("strikes a source's own old price without vouching for it", () => {
    const root = block(priced({ oldPrice: eur("9.95", "9,95 €"), discountPercent: 10 }));
    expect(root.querySelector(".line-through")?.textContent).toBe("9,95 €");
    expect(root.querySelector("[data-promotion]")).toBeNull();
    expect(text(root)).not.toContain("30 дни");
  });

  it("strikes a reduction under one percent without a −0% badge", () => {
    const root = block(priced({ oldPrice: eur("8.96", "8,96 €"), discountPercent: 0, promotion }));
    expect(root.querySelector(".line-through")?.textContent).toBe("8,96 €");
    expect(text(root)).not.toContain("%");
    expect(text(root.querySelector("[data-promotion]"))).toContain("до 15 ноември");
  });

  it("never counts down", () => {
    const root = block(priced({ oldPrice: eur("9.95", "9,95 €"), discountPercent: 10, promotion }));
    expect(text(root)).not.toMatch(/остава|остават|часа|минути|днес|само/i);
    expect(root.querySelector("time[data-countdown], [role='timer']")).toBeNull();
  });
});

const card = (patch: Partial<ProductCardView>): ProductCardView => ({
  id: crypto.randomUUID(),
  slug: `p-${Math.random().toString(36).slice(2, 8)}`,
  name: "Lavazza Crema e Aroma — кафе на зърна, 1 кг",
  title: "Lavazza Crema e Aroma",
  detail: "Кафе на зърна, 1 кг",
  price: eur("8.95", "8,95 €"),
  oldPrice: eur("9.95", "9,95 €"),
  discountPercent: 10,
  promotion,
  availability: "in_stock",
  weight: "1 кг",
  intensity: null,
  systemId: "beans",
  servingPrice: null,
  brand: { slug: "lavazza", name: "Lavazza" },
  image: null,
  shortDescription: null,
  ...patch,
});

function band(products: ProductCardView[]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(HomePromotions, { products, locale: "bg" }));
  return host;
}

describe("the home page's promotions band", () => {
  it("names the promotion and its last day when it is behind every card", () => {
    const root = band([card({}), card({})]);
    expect(text(root.querySelector("h2"))).toBe("Намалени в момента");
    expect(text(root)).toContain("Есенни дни — до 15 ноември.");
  });

  it("says nothing of promotions when the cards come from several, or from the source", () => {
    const other = { ...promotion, id: "22222222-2222-4222-8222-222222222222", label: "Друга" };
    for (const products of [
      [card({}), card({ promotion: other })],
      [card({}), card({ promotion: null })],
    ]) {
      const root = band(products);
      expect(text(root)).not.toContain("Есенни дни —");
      expect(text(root)).not.toContain("Друга —");
    }
  });
});
