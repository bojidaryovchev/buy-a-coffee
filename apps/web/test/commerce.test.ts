import { describe, expect, it } from "vitest";
import { deliveryFaq, orderingSteps } from "@/components/commerce/delivery-content";
import {
  STATUTORY_WITHDRAWAL_DAYS,
  couriersSentence,
  daysInRange,
  deliveryCostFor,
  deliveryCostSentences,
  deliveryFee,
  deliveryTime,
  deliveryTimeSentence,
  freeDeliveryGap,
  freeDeliveryPromise,
  freeDeliveryThreshold,
  joinList,
  paymentMethods,
  paymentSentence,
  productDeliveryLines,
  returnShippingSentence,
  returnWindowDays,
  unsetTerms,
  withdrawalDays,
} from "@/components/commerce/terms";
import { formatOpeningHours, siteConfig, type CommerceConfig } from "@/config/site";
import type { ProductDetailView } from "@/lib/catalog/types";
import { organizationJsonLd, productJsonLd } from "@/lib/seo/json-ld";

/** Nothing set: what the shop looks like before the business has said anything. */
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

/** Everything set and confirmed. */
const COMPLETE: CommerceConfig = {
  confirmedByOwner: true,
  freeDeliveryThreshold: "49.00",
  deliveryFee: "5.90",
  deliveryTime: { dispatch: { min: 0, max: 1 }, transit: { min: 1, max: 2 } },
  couriers: ["Куриер А", "Куриер Б"],
  paymentMethods: ["cash_on_delivery", "bank_transfer"],
  returnWindowDays: 14,
  returnShippingPaidBy: "customer",
  openingHours: [{ from: "monday", to: "friday", opens: "09:00", closes: "18:00" }],
};

const eur = (amount: string) => ({ amount, currency: "EUR" });

describe("the configured terms as shipped", () => {
  it("is a proposal: three values set, the rest unset, nothing confirmed", () => {
    const commerce = siteConfig.commerce;
    expect(commerce.confirmedByOwner).toBe(false);
    expect(freeDeliveryThreshold(commerce)?.amount).toBe("49.00");
    expect(paymentMethods(commerce).map((method) => method.id)).toEqual([
      "cash_on_delivery",
      "bank_transfer",
    ]);
    expect(returnWindowDays(commerce)).toBe(14);
    expect(deliveryFee(commerce)).toBeNull();
    expect(deliveryTime(commerce)).toBeNull();
    expect(commerce.couriers).toEqual([]);
    expect(commerce.returnShippingPaidBy).toBeNull();
  });

  it("still prints the opening hours the rest of the site reads", () => {
    // `contact.hours` is read by the header, the footer, the contact page and
    // the reply e-mails. It is derived now; the string must not have moved.
    expect(siteConfig.contact.hours).toBe("Пон–Пет, 9:00–18:00");
  });
});

describe("opening hours", () => {
  it("formats a run of days, a single day and several ranges", () => {
    expect(
      formatOpeningHours([
        { from: "monday", to: "friday", opens: "09:00", closes: "18:00" },
        { from: "saturday", to: "saturday", opens: "10:00", closes: "14:30" },
      ]),
    ).toBe("Пон–Пет, 9:00–18:00; Съб, 10:00–14:30");
    expect(formatOpeningHours([])).toBe("");
  });

  it("expands a range to its days, and a backwards one to nothing", () => {
    expect(daysInRange({ from: "thursday", to: "saturday" })).toEqual([
      "thursday",
      "friday",
      "saturday",
    ]);
    expect(daysInRange({ from: "friday", to: "monday" })).toEqual([]);
  });
});

describe("money guards", () => {
  it("returns null for an unset threshold or fee", () => {
    expect(freeDeliveryThreshold(UNSET)).toBeNull();
    expect(deliveryFee(UNSET)).toBeNull();
  });

  it("returns the exact amount when set", () => {
    expect(freeDeliveryThreshold(COMPLETE)?.amount).toBe("49.00");
    expect(deliveryFee(COMPLETE)?.amount).toBe("5.90");
  });

  it("treats an unusable value as unset rather than printing it", () => {
    expect(freeDeliveryThreshold({ ...UNSET, freeDeliveryThreshold: "abc" })).toBeNull();
    expect(freeDeliveryThreshold({ ...UNSET, freeDeliveryThreshold: "-5" })).toBeNull();
    expect(freeDeliveryThreshold({ ...UNSET, freeDeliveryThreshold: "0" })).toBeNull();
    expect(deliveryFee({ ...UNSET, deliveryFee: "-1.00" })).toBeNull();
  });

  it("accepts a fee of zero, which is a real answer", () => {
    expect(deliveryFee({ ...UNSET, deliveryFee: "0" })?.amount).toBe("0.00");
  });
});

describe("freeDeliveryGap", () => {
  it("is null without a threshold, without a price, or across currencies", () => {
    expect(freeDeliveryGap(eur("10.00"), UNSET)).toBeNull();
    expect(freeDeliveryGap(null, COMPLETE)).toBeNull();
    expect(freeDeliveryGap({ amount: "10.00", currency: "BGN" }, COMPLETE)).toBeNull();
  });

  it("reports the exact distance below the threshold", () => {
    expect(freeDeliveryGap(eur("36.90"), COMPLETE)).toMatchObject({
      qualifies: false,
      remaining: { amount: "12.10", currency: "EUR" },
    });
    expect(freeDeliveryGap(eur("48.99"), COMPLETE)).toMatchObject({
      remaining: { amount: "0.01" },
    });
    expect(freeDeliveryGap(eur("0.01"), COMPLETE)).toMatchObject({
      remaining: { amount: "48.99" },
    });
  });

  it("does not drift the way floating point would", () => {
    // 0.30 - 0.10 is 0.19999999999999998 in binary floating point.
    const commerce = { ...UNSET, freeDeliveryThreshold: "0.30" };
    expect(freeDeliveryGap(eur("0.10"), commerce)).toMatchObject({
      remaining: { amount: "0.20" },
    });
    // Beyond the range where a double still holds every cent.
    const large = { ...UNSET, freeDeliveryThreshold: "90071992547409.93" };
    expect(freeDeliveryGap(eur("0.01"), large)).toMatchObject({
      remaining: { amount: "90071992547409.92" },
    });
  });

  it("qualifies only above the threshold, never on it", () => {
    expect(freeDeliveryGap(eur("49.01"), COMPLETE)).toEqual({ qualifies: true });
    expect(freeDeliveryGap(eur("120.00"), COMPLETE)).toEqual({ qualifies: true });
    // Exactly on it: the offer says "above", so no promise and nothing to add.
    expect(freeDeliveryGap(eur("49.00"), COMPLETE)).toEqual({ qualifies: false, remaining: null });
  });
});

describe("deliveryCostFor", () => {
  it("is zero above the threshold and the fee below it", () => {
    expect(deliveryCostFor(eur("60.00"), COMPLETE)?.amount).toBe("0.00");
    expect(deliveryCostFor(eur("20.00"), COMPLETE)?.amount).toBe("5.90");
  });

  it("is null below the threshold when no fee is configured", () => {
    const noFee = { ...COMPLETE, deliveryFee: null };
    expect(deliveryCostFor(eur("20.00"), noFee)).toBeNull();
    expect(deliveryCostFor(eur("60.00"), noFee)?.amount).toBe("0.00");
  });

  it("is null without a price or in another currency", () => {
    expect(deliveryCostFor(null, COMPLETE)).toBeNull();
    expect(deliveryCostFor({ amount: "60.00", currency: "BGN" }, COMPLETE)).toBeNull();
  });
});

describe("delivery time", () => {
  it("is null when unset, half-set or nonsensical", () => {
    expect(deliveryTime(UNSET)).toBeNull();
    expect(deliveryTimeSentence(UNSET)).toBeNull();
    const broken = (time: CommerceConfig["deliveryTime"]) =>
      deliveryTime({ ...UNSET, deliveryTime: time });
    expect(broken({ dispatch: { min: 2, max: 1 }, transit: { min: 1, max: 2 } })).toBeNull();
    expect(broken({ dispatch: { min: 0, max: 1 }, transit: { min: 0, max: 0 } })).toBeNull();
    expect(broken({ dispatch: { min: 0, max: 1.5 }, transit: { min: 1, max: 2 } })).toBeNull();
    expect(broken({ dispatch: { min: -1, max: 1 }, transit: { min: 1, max: 2 } })).toBeNull();
  });

  it("states dispatch and transit when set", () => {
    expect(deliveryTimeSentence(COMPLETE)).toBe(
      "Предаваме пратката на куриера до 1 работен ден след потвърждаването, а доставката отнема 1–2 работни дни.",
    );
    expect(
      deliveryTimeSentence({
        ...COMPLETE,
        deliveryTime: { dispatch: { min: 0, max: 0 }, transit: { min: 1, max: 1 } },
      }),
    ).toBe(
      "Предаваме пратката на куриера в деня на потвърждаването, а доставката отнема 1 работен ден.",
    );
  });
});

describe("payment methods", () => {
  it("is empty when unset", () => {
    expect(paymentMethods(UNSET)).toEqual([]);
    expect(paymentSentence(UNSET)).toBeNull();
  });

  it("keeps the configured order and drops repeats and unknown ids", () => {
    const commerce = {
      ...UNSET,
      paymentMethods: ["bank_transfer", "bitcoin", "cash_on_delivery", "bank_transfer"],
    } as unknown as CommerceConfig;
    expect(paymentMethods(commerce).map((method) => method.id)).toEqual([
      "bank_transfer",
      "cash_on_delivery",
    ]);
  });

  it("writes one sentence naming every method", () => {
    expect(paymentSentence(COMPLETE)).toBe(
      "Плащате в брой при получаване на пратката (наложен платеж) или предварително с банков превод.",
    );
  });
});

describe("returns", () => {
  it("has no configured window when unset, but the statutory right still stands", () => {
    expect(returnWindowDays(UNSET)).toBeNull();
    expect(withdrawalDays(UNSET)).toBe(STATUTORY_WITHDRAWAL_DAYS);
  });

  it("uses a longer configured window", () => {
    const generous = { ...UNSET, returnWindowDays: 30 };
    expect(returnWindowDays(generous)).toBe(30);
    expect(withdrawalDays(generous)).toBe(30);
  });

  it("never offers less than the law does", () => {
    const illegal = { ...UNSET, returnWindowDays: 7 };
    expect(returnWindowDays(illegal)).toBeNull();
    expect(withdrawalDays(illegal)).toBe(14);
  });

  it("says who pays for the return only when that is decided", () => {
    expect(returnShippingSentence(UNSET)).toBeNull();
    expect(returnShippingSentence({ ...UNSET, returnShippingPaidBy: "merchant" })).toContain(
      "за наша сметка",
    );
    expect(returnShippingSentence({ ...UNSET, returnShippingPaidBy: "customer" })).toContain(
      "за ваша сметка",
    );
  });
});

describe("sentences", () => {
  it("joins lists the way Bulgarian does", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["а"])).toBe("а");
    expect(joinList(["а", "б"])).toBe("а и б");
    expect(joinList(["а", "б", "в"], "или")).toBe("а, б или в");
  });

  it("states the delivery cost for every combination of threshold and fee", () => {
    expect(deliveryCostSentences(UNSET).join(" ")).toBe(
      "Цената на доставката ви казваме по телефона, когато потвърждаваме поръчката.",
    );

    const thresholdOnly = deliveryCostSentences({ ...UNSET, freeDeliveryThreshold: "49.00" });
    expect(thresholdOnly[0]).toMatch(/^Доставката е безплатна за поръчки над 49,00\s€\.$/);
    expect(thresholdOnly[1]).toContain("ви казваме по телефона");

    const feeOnly = deliveryCostSentences({ ...UNSET, deliveryFee: "5.90" });
    expect(feeOnly).toHaveLength(1);
    expect(feeOnly[0]).toMatch(/^Доставката струва 5,90\s€\.$/);

    const both = deliveryCostSentences(COMPLETE);
    expect(both[0]).toContain("49,00");
    expect(both[1]).toMatch(/доставката струва 5,90\s€\.$/);

    expect(deliveryCostSentences({ ...COMPLETE, deliveryFee: "0.00" })).toEqual([
      "Доставката е безплатна.",
    ]);
  });

  it("never states a fee that was not configured", () => {
    // The shipped config has a threshold and no fee: no amount other than the
    // threshold may appear.
    const text = deliveryCostSentences(siteConfig.commerce).join(" ");
    expect(text.match(/\d+,\d{2}/g)).toEqual(["49,00"]);
  });

  it("names couriers only when there are some", () => {
    expect(couriersSentence(UNSET)).toBeNull();
    expect(couriersSentence({ ...UNSET, couriers: ["  ", ""] })).toBeNull();
    expect(couriersSentence(COMPLETE)).toBe("Пратките изпращаме с Куриер А и Куриер Б.");
  });
});

describe("the announcement bar and the product block", () => {
  it("has no promise without a threshold", () => {
    expect(freeDeliveryPromise(UNSET)).toBeNull();
    expect(productDeliveryLines(eur("10.00"), UNSET)).toEqual({
      promise: null,
      standing: null,
      payment: null,
    });
  });

  it("makes the promise when there is one", () => {
    expect(freeDeliveryPromise(COMPLETE)).toMatch(/^Безплатна доставка за поръчки над 49,00\s€$/);
  });

  it("says where one unit stands, exactly", () => {
    expect(productDeliveryLines(eur("36.90"), COMPLETE).standing).toMatch(
      /до тази сума остават 12,10\s€\.$/,
    );
    expect(productDeliveryLines(eur("59.00"), COMPLETE).standing).toContain("вече е над");
  });

  it("says nothing about the product without a price, or exactly on the threshold", () => {
    expect(productDeliveryLines(null, COMPLETE).standing).toBeNull();
    expect(productDeliveryLines(eur("49.00"), COMPLETE).standing).toBeNull();
    // The promise itself does not depend on the product.
    expect(productDeliveryLines(null, COMPLETE).promise).not.toBeNull();
  });

  it("lists payment methods independently of the threshold", () => {
    const lines = productDeliveryLines(eur("10.00"), {
      ...UNSET,
      paymentMethods: ["cash_on_delivery", "bank_transfer"],
    });
    expect(lines.promise).toBeNull();
    expect(lines.payment).toBe("Плащане: наложен платеж или банков превод");
  });
});

describe("the delivery page's own content", () => {
  it("always has three ordering steps, and mentions payment only when configured", () => {
    expect(orderingSteps(UNSET)).toHaveLength(3);
    expect(orderingSteps(UNSET).join(" ")).not.toContain("Плащате");
    expect(orderingSteps(UNSET)[1]).not.toContain("работно време");
    expect(orderingSteps(COMPLETE)[1]).toContain("(Пон–Пет, 9:00–18:00)");
    expect(orderingSteps(COMPLETE)[2]).toContain("наложен платеж");
  });

  it("leaves out the questions an unset term cannot answer", () => {
    const questions = (commerce: CommerceConfig) =>
      deliveryFaq(commerce).map((entry) => entry.question);

    expect(questions(UNSET)).not.toContain("Кога ще получа поръчката?");
    expect(questions(UNSET)).not.toContain("Как се плаща?");
    expect(questions(UNSET)).not.toContain("Кога ще ми се обадите?");

    expect(questions(COMPLETE)).toContain("Кога ще получа поръчката?");
    expect(questions(COMPLETE)).toContain("Как се плаща?");
    expect(questions(COMPLETE)).toContain("Кога ще ми се обадите?");
  });

  it("answers from the same sentences as the terms", () => {
    const answer = (question: string) =>
      deliveryFaq(COMPLETE).find((entry) => entry.question === question)?.answer;

    expect(answer("Колко струва доставката?")).toBe(deliveryCostSentences(COMPLETE).join(" "));
    expect(answer("Кога ще получа поръчката?")).toBe(deliveryTimeSentence(COMPLETE));
    expect(answer("Мога ли да върна поръчката?")).toContain("14 дни");
    expect(answer("Мога ли да върна поръчката?")).toContain(returnShippingSentence(COMPLETE));
  });

  it("has no empty answers and no repeated questions", () => {
    for (const commerce of [UNSET, COMPLETE, siteConfig.commerce]) {
      const faq = deliveryFaq(commerce);
      expect(new Set(faq.map((entry) => entry.question)).size).toBe(faq.length);
      for (const entry of faq) expect(entry.answer.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("unsetTerms", () => {
  it("is empty for a complete config", () => {
    expect(unsetTerms(COMPLETE)).toEqual([]);
  });

  it("names every missing term", () => {
    const missing = unsetTerms(UNSET).join("\n");
    for (const field of [
      "deliveryFee",
      "deliveryTime",
      "paymentMethods",
      "returnWindowDays",
      "returnShippingPaidBy",
    ]) {
      expect(missing).toContain(`commerce.${field}`);
    }
  });

  it("does not require a free-delivery offer or named couriers", () => {
    expect(unsetTerms({ ...COMPLETE, freeDeliveryThreshold: null, couriers: [] })).toEqual([]);
  });

  it("flags a threshold that is set but unusable, and a too-short return window", () => {
    expect(unsetTerms({ ...COMPLETE, freeDeliveryThreshold: "free" }).join()).toContain(
      "freeDeliveryThreshold",
    );
    expect(unsetTerms({ ...COMPLETE, returnWindowDays: 7 }).join()).toContain("returnWindowDays");
  });

  it("lists exactly the three terms the shipped config leaves open", () => {
    expect(unsetTerms(siteConfig.commerce)).toHaveLength(3);
  });
});

describe("structured data", () => {
  const product = (amount: string | null): ProductDetailView =>
    ({
      name: "Тестово кафе",
      slug: "testovo-kafe",
      descriptionText: null,
      images: [],
      brand: null,
      sku: null,
      gtin: null,
      weight: null,
      availability: "in_stock",
      price: amount ? { amount, currency: "EUR", formatted: amount } : null,
    }) as unknown as ProductDetailView;

  const offer = (amount: string | null, commerce: CommerceConfig) =>
    productJsonLd(product(amount), commerce).offers as Record<string, unknown> | undefined;

  it("emits neither policy for the shipped, unconfirmed config", () => {
    const shipped = productJsonLd(product("60.00")).offers as Record<string, unknown>;
    expect(shipped.price).toBe("60.00");
    expect(shipped).not.toHaveProperty("shippingDetails");
    expect(shipped).not.toHaveProperty("hasMerchantReturnPolicy");
  });

  it("emits neither policy while unconfirmed, however complete the values", () => {
    const unconfirmed = offer("60.00", { ...COMPLETE, confirmedByOwner: false });
    expect(unconfirmed).not.toHaveProperty("shippingDetails");
    expect(unconfirmed).not.toHaveProperty("hasMerchantReturnPolicy");
  });

  it("emits neither policy when confirmed but unset", () => {
    const empty = offer("60.00", { ...UNSET, confirmedByOwner: true });
    expect(empty).not.toHaveProperty("shippingDetails");
    expect(empty).not.toHaveProperty("hasMerchantReturnPolicy");
  });

  it("still emits no offer at all for a product without a price", () => {
    expect(offer(null, COMPLETE)).toBeUndefined();
  });

  it("emits free shipping above the threshold, in Google's shape", () => {
    expect(offer("60.00", COMPLETE)?.shippingDetails).toEqual({
      "@type": "OfferShippingDetails",
      shippingRate: { "@type": "MonetaryAmount", value: "0.00", currency: "EUR" },
      shippingDestination: { "@type": "DefinedRegion", addressCountry: "BG" },
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
        transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 2, unitCode: "DAY" },
      },
    });
  });

  it("emits the fee below the threshold", () => {
    const shipping = offer("20.00", COMPLETE)?.shippingDetails as Record<string, unknown>;
    expect(shipping.shippingRate).toEqual({
      "@type": "MonetaryAmount",
      value: "5.90",
      currency: "EUR",
    });
  });

  it("omits shipping entirely when the rate or the delivery time cannot be stated", () => {
    // Below the threshold with no fee: the rate is unknown.
    expect(offer("20.00", { ...COMPLETE, deliveryFee: null })).not.toHaveProperty(
      "shippingDetails",
    );
    // Rate known, delivery time not.
    expect(offer("60.00", { ...COMPLETE, deliveryTime: null })).not.toHaveProperty(
      "shippingDetails",
    );
    // The return policy does not depend on either.
    expect(offer("60.00", { ...COMPLETE, deliveryTime: null })).toHaveProperty(
      "hasMerchantReturnPolicy",
    );
  });

  it("emits the return policy with its required fields", () => {
    expect(offer("60.00", COMPLETE)?.hasMerchantReturnPolicy).toEqual({
      "@type": "MerchantReturnPolicy",
      applicableCountry: "BG",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 14,
      returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
      merchantReturnLink: expect.stringMatching(/\/delivery$/),
    });
  });

  it("maps who pays for the return, and leaves the field out when undecided", () => {
    const policy = (paidBy: CommerceConfig["returnShippingPaidBy"]) =>
      offer("60.00", { ...COMPLETE, returnShippingPaidBy: paidBy })
        ?.hasMerchantReturnPolicy as Record<string, unknown>;
    expect(policy("merchant").returnFees).toBe("https://schema.org/FreeReturn");
    expect(policy(null)).not.toHaveProperty("returnFees");
  });

  it("omits the return policy when the window is unset or below the legal minimum", () => {
    expect(offer("60.00", { ...COMPLETE, returnWindowDays: null })).not.toHaveProperty(
      "hasMerchantReturnPolicy",
    );
    expect(offer("60.00", { ...COMPLETE, returnWindowDays: 7 })).not.toHaveProperty(
      "hasMerchantReturnPolicy",
    );
  });

  it("publishes the opening hours on the contact point, and nothing when there are none", () => {
    const contact = (commerce: CommerceConfig) =>
      (organizationJsonLd(commerce).contactPoint as Array<Record<string, unknown>>)[0]!;

    expect(contact(COMPLETE).hoursAvailable).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "https://schema.org/Monday",
          "https://schema.org/Tuesday",
          "https://schema.org/Wednesday",
          "https://schema.org/Thursday",
          "https://schema.org/Friday",
        ],
        opens: "09:00",
        closes: "18:00",
      },
    ]);
    expect(contact(UNSET)).not.toHaveProperty("hoursAvailable");
  });
});
