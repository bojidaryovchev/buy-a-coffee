import { describe, expect, it } from "vitest";
import { MAX_CART_LINES } from "@/lib/cart/cart";
import { cartBlock, toCartProductView } from "@/lib/cart/view";
import { CART_MESSAGES, PHONE_MESSAGES, cartOrderSchema, toFieldErrors } from "@/lib/forms/schemas";
import { FORM_CONSENT_SOURCES, consentSourceLabel } from "@/lib/forms/consent";
import { composeOrderConfirmation } from "@/lib/mail/confirmation";
import { orderThreadSubject, recordReference } from "@/lib/mail/reference";
import {
  lineTotal,
  orderLinesText,
  orderSum,
  storedLine,
  sumSentence,
  type OrderLine,
} from "@/lib/orders/lines";
import type { ProductCardView } from "@/lib/catalog/types";

/**
 * An order from the cart, short of the database: the schema the form and the
 * action share, the sums every page and mail print, what the cart page is
 * told about a product, and the confirmation mail. The action itself, against
 * a real database, is `cart-order.integration.test.ts`.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const eur = (amount: string) => ({ amount, currency: "EUR" });

describe("cartOrderSchema", () => {
  const lines = JSON.stringify([
    { productId: A, quantity: 2 },
    { productId: B, quantity: 1 },
  ]);
  const valid = { lines, phone: "0888 123 456" };

  it("accepts lines and a phone number, and nothing else is required", () => {
    const result = cartOrderSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.phone).toBe("+359888123456");
    expect(result.data.lines).toEqual([
      { productId: A, quantity: 2 },
      { productId: B, quantity: 1 },
    ]);
    expect(result.data.newsletterConsent).toBe(false);
  });

  it("asks for the phone in the quick order's words", () => {
    const missing = cartOrderSchema.safeParse({ lines, phone: "" });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(toFieldErrors(missing.error).phone).toBe(PHONE_MESSAGES.missing);

    const short = cartOrderSchema.safeParse({ lines, phone: "0888" });
    if (!short.success) expect(toFieldErrors(short.error).phone).toBe(PHONE_MESSAGES.short);
  });

  it("refuses an empty cart and says so", () => {
    for (const empty of ["", "[]"]) {
      const result = cartOrderSchema.safeParse({ ...valid, lines: empty });
      expect(result.success).toBe(false);
      if (!result.success) expect(toFieldErrors(result.error).lines).toBe(CART_MESSAGES.empty);
    }
  });

  it("refuses lines only a hand-made post could produce, and asks for a reload", () => {
    const bad = [
      "{not json",
      JSON.stringify({ productId: A, quantity: 1 }),
      JSON.stringify([{ productId: "lavazza", quantity: 1 }]),
      JSON.stringify([{ productId: A, quantity: 0 }]),
      JSON.stringify([{ productId: A, quantity: 100 }]),
      JSON.stringify([{ productId: A, quantity: 1.5 }]),
      JSON.stringify([{ productId: A, quantity: "2" }]),
      JSON.stringify([
        { productId: A, quantity: 1 },
        { productId: A, quantity: 2 },
      ]),
      JSON.stringify(
        Array.from({ length: MAX_CART_LINES + 1 }, (_, index) => ({
          productId: `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
          quantity: 1,
        })),
      ),
    ];
    for (const value of bad) {
      const result = cartOrderSchema.safeParse({ ...valid, lines: value });
      expect(result.success, value.slice(0, 60)).toBe(false);
      if (!result.success) expect(toFieldErrors(result.error).lines).toBe(CART_MESSAGES.changed);
    }
  });

  it("carries no price: whatever else a line says is not read", () => {
    const result = cartOrderSchema.safeParse({
      ...valid,
      lines: JSON.stringify([{ productId: A, quantity: 1, unitPrice: "0.01" }]),
    });
    expect(result.success && result.data.lines).toEqual([{ productId: A, quantity: 1 }]);
  });

  it("refuses a filled honeypot, and validates the optional fields as the quick order does", () => {
    expect(cartOrderSchema.safeParse({ ...valid, website: "spam" }).success).toBe(false);
    const email = cartOrderSchema.safeParse({ ...valid, email: "not-an-address" });
    expect(email.success).toBe(false);
    expect(cartOrderSchema.safeParse({ ...valid, notes: "x".repeat(1001) }).success).toBe(false);
    expect(
      cartOrderSchema.safeParse({ ...valid, email: "Ivan@Example.com", newsletterConsent: "on" }),
    ).toMatchObject({
      success: true,
      data: { email: "ivan@example.com", newsletterConsent: true },
    });
  });
});

describe("the cart's consent source", () => {
  it("is a code of its own, with words for the panel", () => {
    expect(Object.keys(FORM_CONSENT_SOURCES)).toContain("cart_form");
    expect(consentSourceLabel("cart_form")).toBe("Отметка във формата за поръчка от количката");
  });
});

describe("order sums", () => {
  it("multiply in minor units, never in floating point", () => {
    expect(lineTotal(eur("0.10"), 3)?.formatted).toMatch(/^0,30\s€$/);
    expect(lineTotal(eur("19.99"), 99)?.amount).toBe("1979.01");
    expect(lineTotal(null, 2)).toBeNull();
  });

  it("add the priced lines and count the others", () => {
    const lines: OrderLine[] = [
      { name: "a", quantity: 2, unitPrice: eur("9.90") },
      { name: "b", quantity: 1, unitPrice: null },
      { name: "c", quantity: 3, unitPrice: eur("0.35") },
    ];
    const sum = orderSum(lines);
    expect(sum.subtotal?.amount).toBe("20.85");
    expect(sum.unpriced).toBe(1);
    expect(sum.units).toBe(6);
    expect(sumSentence(sum)).toMatch(
      /^Сума на продуктите: 20,85\s€, без 1 продукт с цена при запитване$/,
    );
  });

  it("have no sum to state when nothing is priced, and say so", () => {
    const sum = orderSum([{ name: "a", quantity: 1, unitPrice: null }]);
    expect(sum.subtotal).toBeNull();
    expect(sumSentence(sum)).toBe("Всички продукти са с цена при запитване.");
  });

  it("leave a price in another currency out rather than add it as euros", () => {
    const sum = orderSum([
      { name: "a", quantity: 1, unitPrice: eur("5.00") },
      { name: "b", quantity: 1, unitPrice: { amount: "5.00", currency: "BGN" } },
    ]);
    expect(sum.subtotal?.amount).toBe("5.00");
    expect(sum.unpriced).toBe(1);
  });

  it("print one line per product, with the unit price when there is more than one", () => {
    const text = orderLinesText([
      { name: "Lavazza Super Crema", quantity: 2, unitPrice: eur("19.90") },
      { name: "Borbone Rossa", quantity: 1, unitPrice: eur("5.60") },
      { name: "Kimbo Napoli", quantity: 1, unitPrice: null },
    ]);
    expect(text[0]).toMatch(/^2 × Lavazza Super Crema — 19,90\s€ за брой, 39,80\s€$/);
    expect(text[1]).toMatch(/^1 × Borbone Rossa — 5,60\s€$/);
    expect(text[2]).toBe("1 × Kimbo Napoli — цена при запитване");
    expect(text.at(-1)).toMatch(/^Сума на продуктите: 45,40\s€, без 1 продукт/);
  });

  it("read a stored line, priced or not", () => {
    expect(storedLine({ quantity: 2, unitPrice: "4.50", currency: "EUR" }, "x")).toEqual({
      name: "x",
      quantity: 2,
      unitPrice: eur("4.50"),
    });
    expect(storedLine({ quantity: 1, unitPrice: null, currency: null }, "x").unitPrice).toBeNull();
  });
});

describe("what the cart page is told about a product", () => {
  const card: ProductCardView = {
    id: A,
    slug: "lavazza-super-crema-kafe-na-zarna-1-kg",
    name: "Lavazza Super Crema — кафе на зърна, 1 кг",
    title: "Lavazza Super Crema",
    detail: "Кафе на зърна, 1 кг",
    price: { amount: "19.90", currency: "EUR", formatted: "19,90 €" },
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "1 кг",
    intensity: null,
    systemId: "beans",
    servingPrice: { formatted: "≈ 0,14 € на чаша", estimated: true },
    brand: { slug: "lavazza", name: "Lavazza" },
    image: { url: "/media/a.jpg", alt: "Lavazza Super Crema", width: 800, height: 800 },
    shortDescription: "Кафе.",
  };

  it("is what the card says, and no more", () => {
    expect(toCartProductView(card, "active")).toEqual({
      id: A,
      slug: card.slug,
      name: card.name,
      title: "Lavazza Super Crema",
      detail: "Кафе на зърна, 1 кг",
      image: { url: "/media/a.jpg", alt: "Lavazza Super Crema" },
      price: card.price,
      servingPrice: "≈ 0,14 € на чаша",
      availability: "in_stock",
      blocked: null,
    });
  });

  it("refuses what the product page refuses: withdrawn, or out of stock today", () => {
    expect(cartBlock("active", "in_stock")).toBeNull();
    expect(cartBlock("active", "preorder")).toBeNull();
    expect(cartBlock("active", "unknown")).toBeNull();
    expect(cartBlock("active", "out_of_stock")).toBe("out_of_stock");
    expect(cartBlock("removed", "in_stock")).toBe("unavailable");
    expect(cartBlock("missing", "in_stock")).toBe("unavailable");
  });
});

describe("the confirmation mail", () => {
  const ID = "a1b2c3d4-0000-4000-8000-000000000000";
  const mail = (customerName: string | null) =>
    composeOrderConfirmation({
      id: ID,
      email: "ivan@example.com",
      customerName,
      phone: "+359888123456",
      lines: [
        { name: "Lavazza Super Crema — кафе на зърна, 1 кг", quantity: 2, unitPrice: eur("19.90") },
        { name: "Kimbo Napoli — капсули", quantity: 1, unitPrice: null },
      ],
      callback: "Ще ви се обадим утре, в работно време.",
    });

  it("goes out under the order's thread subject, with its reference", async () => {
    expect(recordReference(ID)).toBe("A1B2C3D4");
    const { subject, text } = await mail(null);
    expect(subject).toBe(orderThreadSubject(ID));
    expect(text).toContain("Референцията ѝ е A1B2C3D4.");
  });

  it("names the products as the shop does, with prices and the sum", async () => {
    const { text } = await mail(null);
    expect(text).toMatch(
      /2 × Lavazza Super Crema — кафе на зърна, 1 кг — 19,90\s€ за брой, 39,80\s€/,
    );
    expect(text).toContain("1 × Kimbo Napoli — капсули — цена при запитване");
    expect(text).toMatch(/Сума на продуктите: 39,80\s€, без 1 продукт с цена при запитване/);
  });

  it("prints back the number it will ring and says when", async () => {
    const { text } = await mail("Иван");
    expect(text.startsWith("Здравейте, Иван,")).toBe(true);
    expect(text).toContain("Ще ви се обадим утре, в работно време. Ще звъним на +359888123456.");
    expect((await mail(null)).text.startsWith("Здравейте,\n")).toBe(true);
  });

  it("promises nothing the call has not confirmed, and ends with the shop's signature", async () => {
    const { text, html } = await mail(null);
    expect(text).toContain("поръчка има едва след този разговор");
    expect(text).toMatch(/\n--\n/);
    // The HTML part is the letterhead template; `emails.test.ts` checks it in full.
    expect(html).toContain('lang="bg"');
    expect(html).toContain("поръчка има едва след този разговор");
    expect(html).not.toContain("<script");
  });
});
