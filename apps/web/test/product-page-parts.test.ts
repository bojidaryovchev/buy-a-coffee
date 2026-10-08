import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DeliveryPaymentBlock,
  deliveryPaymentRows,
} from "@/components/commerce/delivery-payment-block";
import type { CommerceConfig } from "@/config/site";
import { PLACEHOLDER_IMAGE } from "@/lib/catalog/images";
import type { ProductDetailView } from "@/lib/catalog/types";
import { productImageUrls, productJsonLd } from "@/lib/seo/json-ld";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const stripTags = (markup: string): string => markup.replace(/<[^>]+>/g, "");

const UNSET: CommerceConfig = {
  confirmedByOwner: false,
  freeDeliveryThreshold: null,
  deliveryFee: null,
  deliveryTime: null,
  couriers: [],
  paymentMethods: [],
  returnWindowDays: null,
  returnShippingPaidBy: null,
  openingHours: [],
};

const COMPLETE: CommerceConfig = {
  confirmedByOwner: true,
  freeDeliveryThreshold: "49.00",
  deliveryFee: "5.90",
  deliveryTime: { dispatch: { min: 0, max: 1 }, transit: { min: 1, max: 2 } },
  couriers: [],
  paymentMethods: ["cash_on_delivery", "bank_transfer"],
  returnWindowDays: 14,
  returnShippingPaidBy: "customer",
  openingHours: [],
};

const price = (amount: string) => ({ amount, currency: "EUR", formatted: `${amount} €` });

const image = (url: string) => ({ url, alt: "Пакет", width: 800, height: 800 });

function product(patch: Partial<ProductDetailView> = {}): ProductDetailView {
  return {
    id: "p1",
    slug: "testovo-kafe",
    name: "Тестово кафе",
    price: price("12.80"),
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "1 кг.",
    intensity: null,
    systemId: "beans",
    servingPrice: null,
    brand: { slug: "marka", name: "Марка" },
    image: null,
    shortDescription: "Кафе на зърна от Марка.",
    status: "active",
    unitPrice: null,
    descriptionHtml: null,
    descriptionText: "Кафе на зърна от Марка.",
    sku: null,
    gtin: null,
    pack: { value: "1000", unit: "g" },
    arabicaPercent: null,
    origin: null,
    roast: null,
    attributes: {},
    images: [],
    categories: [],
    updatedAt: null,
    ...patch,
  };
}

describe("Product JSON-LD: product code", () => {
  it("carries `sku` only when the record holds a code", () => {
    expect(productJsonLd(product({ sku: "AB-1234" })).sku).toBe("AB-1234");
    expect(productJsonLd(product({ sku: null }))).not.toHaveProperty("sku");
    expect(productJsonLd(product({ sku: "" }))).not.toHaveProperty("sku");
    expect(productJsonLd(product({ sku: "   " }))).not.toHaveProperty("sku");
  });

  it("trims a padded code", () => {
    expect(productJsonLd(product({ sku: " AB-1234 " })).sku).toBe("AB-1234");
  });
});

describe("Product JSON-LD: image", () => {
  it("lists real photographs as absolute URLs", () => {
    const data = productJsonLd(
      product({ images: [image("/media/catalog/a.jpg"), image("/media/catalog/b.jpg")] }),
    );
    expect(data.image).toHaveLength(2);
    for (const url of data.image as string[])
      expect(url).toMatch(/^https?:\/\/.+\/media\/catalog\//);
  });

  it("omits `image` when the only image resolved to the placeholder", () => {
    const data = productJsonLd(product({ images: [image(PLACEHOLDER_IMAGE)] }));
    expect(data).not.toHaveProperty("image");
    expect(JSON.stringify(data)).not.toContain("placeholder");
  });

  it("omits `image` when there is no image at all", () => {
    expect(productJsonLd(product({ images: [] }))).not.toHaveProperty("image");
  });

  it("keeps the real photographs and drops only the placeholder among them", () => {
    const urls = productImageUrls(
      product({ images: [image(PLACEHOLDER_IMAGE), image("/media/catalog/a.jpg")] }),
    );
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/media/catalog/a.jpg");
  });
});

describe("Product JSON-LD: a product with no price", () => {
  const data = productJsonLd(
    product({ price: null, sku: "AB-1", images: [image(PLACEHOLDER_IMAGE)] }),
    COMPLETE,
  );

  it("has no offer, and never a zero price", () => {
    expect(data).not.toHaveProperty("offers");
    expect(JSON.stringify(data)).not.toMatch(/"price"/);
  });

  it("is still a valid, serialisable Product", () => {
    const parsed = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("Product");
    expect(parsed.name).toBe("Тестово кафе");
    expect(parsed.url).toMatch(/\/products\/testovo-kafe$/);
    expect(parsed.sku).toBe("AB-1");
    expect(parsed).not.toHaveProperty("image");
    // Nothing undefined or null slipped in as a value.
    for (const value of Object.values(parsed)) expect(value ?? null).not.toBeNull();
  });

  it("emits the offer again once there is a price", () => {
    const offers = productJsonLd(product(), COMPLETE).offers as Record<string, unknown>;
    expect(offers.price).toBe("12.80");
    expect(offers.priceCurrency).toBe("EUR");
  });
});

describe("delivery-and-payment block", () => {
  it("has a row per configured term, in order", () => {
    const rows = deliveryPaymentRows(price("12.80"), COMPLETE);
    expect(rows.map((row) => row.term)).toEqual(["Доставка", "Срок", "Плащане", "Връщане"]);
  });

  it("states the fee and the threshold, and where one unit stands against it", () => {
    const [delivery] = deliveryPaymentRows(price("12.80"), COMPLETE);
    const text = delivery!.lines.join(" ");
    expect(text).toContain("безплатна за поръчки над");
    expect(text).toContain("5,90");
    expect(text).toMatch(/остават 36,20/);
  });

  it("prints only the promise when no fee is set — never 'we will tell you'", () => {
    const rows = deliveryPaymentRows(price("12.80"), { ...COMPLETE, deliveryFee: null });
    const text = rows[0]!.lines.join(" ");
    expect(text).toContain("Безплатна доставка за поръчки над");
    expect(text).not.toMatch(/по телефона/);
  });

  it("omits each row whose term is unset", () => {
    const terms = (commerce: CommerceConfig) =>
      deliveryPaymentRows(price("12.80"), commerce).map((row) => row.term);

    expect(terms({ ...COMPLETE, deliveryFee: null, freeDeliveryThreshold: null })).toEqual([
      "Срок",
      "Плащане",
      "Връщане",
    ]);
    expect(terms({ ...COMPLETE, deliveryTime: null })).toEqual(["Доставка", "Плащане", "Връщане"]);
    expect(terms({ ...COMPLETE, paymentMethods: [] })).toEqual(["Доставка", "Срок", "Връщане"]);
    expect(terms({ ...COMPLETE, returnWindowDays: null })).toEqual(["Доставка", "Срок", "Плащане"]);
  });

  it("renders nothing when no term is set, so the form can take the full width", () => {
    expect(deliveryPaymentRows(price("12.80"), UNSET)).toEqual([]);
    expect(
      html(createElement(DeliveryPaymentBlock, { price: price("12.80"), commerce: UNSET })),
    ).toBe("");
  });

  it("still states the terms for a product with no price", () => {
    const rows = deliveryPaymentRows(null, COMPLETE);
    expect(rows.map((row) => row.term)).toEqual(["Доставка", "Срок", "Плащане", "Връщане"]);
    expect(rows[0]!.lines.join(" ")).not.toMatch(/остават|вече е над/);
  });

  it("is a description list with decorative icons and a link to the terms page", () => {
    const markup = html(
      createElement(DeliveryPaymentBlock, {
        price: price("12.80"),
        commerce: COMPLETE,
        className: "border-b",
      }),
    );
    expect(markup).toMatch(/^<aside aria-label="Доставка и плащане" class="[^"]*border-b"/);
    expect((markup.match(/<dt/g) ?? []).length).toBe(4);
    expect((markup.match(/<dd/g) ?? []).length).toBe(4);
    expect((markup.match(/<svg aria-hidden="true"/g) ?? []).length).toBe(4);
    expect(markup).toContain('href="/delivery"');
    expect(stripTags(markup)).toContain("Наложен платеж или банков превод.");
    expect(stripTags(markup)).toContain("14 дни за отказ след получаването.");
    expect(stripTags(markup)).toContain("за ваша сметка");
  });
});
