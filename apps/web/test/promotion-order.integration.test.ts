import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import {
  orderInquiryItems,
  products,
  promotionProducts,
  promotions,
  sourceSites,
} from "@catalog/db/schema";
import type { Database } from "@catalog/db";
import { NextRequest } from "next/server";
import type { CartProductView } from "@/lib/cart/view";
import type { Notification } from "@/lib/notifications";
import type { OrderConfirmation } from "@/lib/mail/confirmation";
// Types only: the modules are imported in `beforeAll`, once the test database
// has been chosen.
import type * as Actions from "@/lib/forms/actions";
import type * as AdminQueries from "@/lib/admin-queries";
import type * as CartRoute from "@/app/api/cart/route";
import type * as OrderRecord from "@/lib/orders/record";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * An order under the shop's own promotion, against a real database: what the
 * cart page is told about a reduced product, what the order stores of the
 * promotion, and what each mail says of it — the customer's only what the
 * page showed, the owner's which promotion it was and what it cost.
 *
 * The notification sink records instead of sending and the confirmation is a
 * spy, so nothing here can reach a mail provider; the two mails are composed
 * from what was captured, through the templates the senders use.
 */

let requestCounter = 0;
const nextAddress = () => `10.3.${Math.floor(requestCounter / 250)}.${requestCounter++ % 250}`;
vi.mock("next/headers", () => ({
  // A different caller for every request, so no limiter gets in the way.
  headers: async () => new Headers({ "x-forwarded-for": nextAddress() }),
}));

const confirmations = vi.hoisted(() => [] as OrderConfirmation[]);
vi.mock("@/lib/mail/confirmation", () => ({
  sendOrderConfirmation: async (order: OrderConfirmation) => {
    confirmations.push(order);
    return { sent: true };
  },
}));

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;
const IDLE = { status: "idle" } as const;
/** The owner's own name for the promotion: never for a customer's eyes. */
const OWNERS_NAME = "Октомври: Lavazza −10% (марж 18%)";
const LABEL = "Есенни дни";

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const TO_ADDRESS = {
  firstName: "Иван",
  lastName: "Петров",
  phone: "0888 123 457",
  deliveryMethod: "address",
  deliveryCourier: "econt",
  deliveryCity: "Пловдив",
  deliveryPostcode: "4000",
  deliveryAddress: "ул. Иван Вазов 12",
  deliveryOffice: "",
  email: "ivan@example.test",
  website: "",
} as const;

suite("an order under a promotion (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let siteId: string;
  let sent: Notification[];
  let actions: typeof Actions;
  let admin: typeof AdminQueries;
  let cartRoute: typeof CartRoute;
  let record: typeof OrderRecord;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("promotion_order"));
    const { setNotificationSink } = await import("@/lib/notifications");
    setNotificationSink({
      name: "capture",
      async send(notification) {
        sent.push(notification);
      },
    });
    actions = await import("@/lib/forms/actions");
    admin = await import("@/lib/admin-queries");
    cartRoute = await import("@/app/api/cart/route");
    record = await import("@/lib/orders/record");
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    sent = [];
    confirmations.length = 0;
    await db.execute(
      sql`truncate table promotion_products, promotions, source_sites, order_inquiries, order_inquiry_items, rate_limit_buckets restart identity cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "promotion-order-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
  });

  const addProduct = async (slug: string, name: string, price: string) => {
    const [row] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceKey: `/${slug}/`,
        sourceUrl: `https://example.test/${slug}/`,
        sourcePath: `/${slug}/`,
        semanticHash: slug,
        slug,
        name,
        currentPrice: price,
        currency: "EUR",
        status: "active",
        availability: "in_stock",
      })
      .returning({ id: products.id });
    return row!.id;
  };

  /** A promotion running since yesterday for a week, with each member's 30-day lowest. */
  const addPromotion = async (members: Array<{ productId: string; reference: string }>) => {
    const [promotion] = await db
      .insert(promotions)
      .values({
        name: OWNERS_NAME,
        label: LABEL,
        percentOff: 10,
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + 7 * DAY),
      })
      .returning({ id: promotions.id, endsAt: promotions.endsAt });
    await db.insert(promotionProducts).values(
      members.map((member) => ({
        promotionId: promotion!.id,
        productId: member.productId,
        referencePrice: member.reference,
      })),
    );
    return promotion!;
  };

  /** Three products: one announced as reduced, one priced by the promotion with no claim, one outside it. */
  const scene = async () => {
    const announced = await addProduct("a", "Кафе на зърна Lavazza Crema e Aroma 1кг", "9.95");
    // It cost 17.00 within the 30 days: 18.00 is the promotion's price, and no reduction.
    const unannounced = await addProduct("b", "Кафе на зърна Lavazza Super Crema 1кг", "20.00");
    const outside = await addProduct("c", "Капсули DG Borbone Rossa 16 бр.", "4.50");
    const promotion = await addPromotion([
      { productId: announced, reference: "9.95" },
      { productId: unannounced, reference: "17.00" },
    ]);
    return { announced, unannounced, outside, promotion };
  };

  const quote = async (ids: readonly string[]) => {
    const response = await cartRoute.GET(
      new NextRequest(new URL(`/api/cart?ids=${ids.join(",")}`, "https://buy-a-coffee.test"), {
        headers: { "x-forwarded-for": nextAddress() },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    return { body, products: (JSON.parse(body) as { products: CartProductView[] }).products };
  };

  it("tells the cart page what the product page shows, and never the owner's name", async () => {
    const { announced, unannounced, outside, promotion } = await scene();
    const { body, products: views } = await quote([announced, unannounced, outside]);
    const [a, b, c] = views;

    expect(a).toMatchObject({
      price: { amount: "8.95" },
      oldPrice: { amount: "9.95" },
      discountPercent: 10,
      promotion: { label: LABEL, endsAt: promotion.endsAt.toISOString() },
    });
    // Priced by the promotion, with nothing to announce: the price alone.
    expect(b).toMatchObject({
      price: { amount: "18.00" },
      oldPrice: null,
      discountPercent: null,
      promotion: null,
    });
    expect(c).toMatchObject({ price: { amount: "4.50" }, oldPrice: null, promotion: null });

    expect(body).not.toContain(OWNERS_NAME);
    expect(body).not.toContain(promotion.id);
  });

  it("stores each line with what the promotion took off and which it was, by the owner's name", async () => {
    const { announced, unannounced, outside, promotion } = await scene();
    const result = await actions.submitCartOrder(
      IDLE,
      form({
        lines: JSON.stringify([
          { productId: announced, quantity: 2 },
          { productId: unannounced, quantity: 1 },
          { productId: outside, quantity: 1 },
        ]),
        ...TO_ADDRESS,
      }),
    );
    expect(result.status).toBe("success");

    const lines = await db
      .select()
      .from(orderInquiryItems)
      .orderBy(asc(orderInquiryItems.position));
    expect(lines.map((line) => line.productId)).toEqual([announced, unannounced, outside]);
    expect(lines[0]).toMatchObject({
      unitPrice: "8.95",
      regularUnitPrice: "9.95",
      discountPercent: 10,
      promotionId: promotion.id,
      promotionName: OWNERS_NAME,
    });
    // The owner's record says the promotion priced it, claim or no claim.
    expect(lines[1]).toMatchObject({
      unitPrice: "18.00",
      regularUnitPrice: "20.00",
      discountPercent: 10,
      promotionId: promotion.id,
      promotionName: OWNERS_NAME,
    });
    expect(lines[2]).toMatchObject({
      unitPrice: "4.50",
      regularUnitPrice: null,
      discountPercent: null,
      promotionId: null,
      promotionName: null,
    });

    // The name is what it was then: renaming the promotion later changes no order.
    await db.update(promotions).set({ name: "Друго име" }).where(eq(promotions.id, promotion.id));
    const [kept] = await db
      .select({ name: orderInquiryItems.promotionName })
      .from(orderInquiryItems)
      .where(eq(orderInquiryItems.productId, announced));
    expect(kept?.name).toBe(OWNERS_NAME);
  });

  it("tells the owner which promotion and what it cost, and the customer only what the page showed", async () => {
    const { announced, unannounced, outside } = await scene();
    await actions.submitCartOrder(
      IDLE,
      form({
        lines: JSON.stringify([
          { productId: announced, quantity: 2 },
          { productId: unannounced, quantity: 1 },
          { productId: outside, quantity: 1 },
        ]),
        ...TO_ADDRESS,
      }),
    );

    // The owner: the regular price, the percentage and the name, on both reduced lines.
    expect(sent).toHaveLength(1);
    const notice = sent[0]!;
    expect(notice.lines?.map((line) => line.reduction ?? null)).toEqual([
      {
        reader: "owner",
        before: { amount: "9.95", currency: "EUR" },
        percent: 10,
        promotionName: OWNERS_NAME,
      },
      {
        reader: "owner",
        before: { amount: "20.00", currency: "EUR" },
        percent: 10,
        promotionName: OWNERS_NAME,
      },
      null,
    ]);
    expect(notice.summary).toMatch(
      new RegExp(
        `8,95\\s€ за брой \\(−10% · ${escape(OWNERS_NAME)}, редовна 9,95\\s€\\), 17,90\\s€`,
      ),
    );
    // (9,95 − 8,95) × 2 + (20,00 − 18,00).
    expect(notice.summary).toMatch(/Отстъпка по промоции: 4,00\s€/);
    const { composeNotificationEmail } = await import("@/lib/mail/notify-sink");
    const ownerMail = await composeNotificationEmail(notice);
    expect(ownerMail.html.replace(/<!-- -->/g, "")).toContain(OWNERS_NAME);

    // The customer: the struck price and badge the page showed, on the one line it showed them.
    expect(confirmations).toHaveLength(1);
    const confirmation = confirmations[0]!;
    expect(confirmation.lines.map((line) => line.reduction ?? null)).toEqual([
      { reader: "customer", before: { amount: "9.95", currency: "EUR" }, percent: 10 },
      null,
      null,
    ]);
    const { composeOrderConfirmationEmail } = await import("@/emails/order-confirmation");
    const customerMail = await composeOrderConfirmationEmail(
      {
        reference: "A1B2C3D4",
        customerName: confirmation.customerName,
        phone: confirmation.phone,
        lines: confirmation.lines,
        callback: confirmation.callback,
        delivery: confirmation.delivery ?? null,
      },
      ["--", "Buy a Coffee"],
    );
    expect(customerMail.text).toMatch(/8,95\s€ за брой \(вместо 9,95\s€, −10%\), 17,90\s€/);
    expect(customerMail.text).toMatch(/Спестявате 2,00\s€/);
    for (const part of [customerMail.html, customerMail.text, JSON.stringify(confirmation)]) {
      expect(part).not.toContain(OWNERS_NAME);
      expect(part).not.toContain("редовна");
      expect(part).not.toContain("20,00");
    }
  });

  it("shows the owner the snapshot in the panel", async () => {
    const { announced, outside } = await scene();
    await actions.submitCartOrder(
      IDLE,
      form({
        lines: JSON.stringify([
          { productId: announced, quantity: 1 },
          { productId: outside, quantity: 1 },
        ]),
        ...TO_ADDRESS,
      }),
    );
    const [listed] = await admin.listOrders();
    const order = await admin.getOrder(listed!.id);
    expect(order?.items).toEqual([
      expect.objectContaining({
        unitPrice: "8.95",
        regularUnitPrice: "9.95",
        discountPercent: 10,
        promotionName: OWNERS_NAME,
      }),
      expect.objectContaining({
        unitPrice: "4.50",
        regularUnitPrice: null,
        discountPercent: null,
        promotionName: null,
      }),
    ]);
  });

  it("keeps a line's figures when the promotion is gone, and never loses the order over it", async () => {
    const { announced, promotion } = await scene();
    await actions.submitCartOrder(
      IDLE,
      form({ lines: JSON.stringify([{ productId: announced, quantity: 1 }]), ...TO_ADDRESS }),
    );
    await db.delete(promotions).where(eq(promotions.id, promotion.id));
    const [line] = await db.select().from(orderInquiryItems);
    expect(line).toMatchObject({
      regularUnitPrice: "9.95",
      discountPercent: 10,
      promotionId: null,
      promotionName: OWNERS_NAME,
    });

    // A line naming a promotion the shop no longer has is still stored.
    const stored = await record.recordInquiry(
      { phone: "+359888000009", idempotencyKey: "promotion-gone" },
      [
        {
          productId: announced,
          productName: "A",
          displayName: "A",
          productSlug: "a",
          quantity: 1,
          unitPrice: "8.95",
          currency: "EUR",
          regularUnitPrice: "9.95",
          discountPercent: 10,
          promotionId: promotion.id,
          promotionName: null,
          shownReduction: null,
        },
      ],
    );
    expect(stored.created).toBe(true);
    expect(stored.items[0]).toMatchObject({ promotionId: null, regularUnitPrice: "9.95" });
    const rows = await db
      .select()
      .from(orderInquiryItems)
      .where(eq(orderInquiryItems.inquiryId, stored.id));
    expect(rows[0]).toMatchObject({ promotionId: null, discountPercent: 10 });
  });
});

/** A literal string, as a regular expression. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
