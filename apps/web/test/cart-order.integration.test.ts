import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import {
  newsletterSubscribers,
  orderInquiries,
  orderInquiryItems,
  products,
  sourceSites,
} from "@catalog/db/schema";
import { createDatabase, type Database } from "@catalog/db";
import type { Notification } from "@/lib/notifications";
import type { OrderConfirmation } from "@/lib/mail/confirmation";
// Types only: the modules are imported in `beforeAll`, once the test database
// has been chosen.
import type * as Actions from "@/lib/forms/actions";
import type * as Retention from "@/lib/retention-run";
import { isDatabaseAvailable, runMigrationFile, useTestDatabase } from "./helpers/test-db";

/**
 * Orders against a real database: the cart's action, the quick order writing
 * its line through the same table, retention taking an order's lines with it,
 * and the migration that made the table, run twice over rows of the old shape.
 *
 * The notification sink records instead of sending, and the confirmation mail
 * is a spy, so nothing here can reach a mail provider.
 */

let requestCounter = 0;
vi.mock("next/headers", () => ({
  // A different caller for every request, so the order limiter never gets in the way.
  headers: async () =>
    new Headers({
      "x-forwarded-for": `10.2.${Math.floor(requestCounter / 250)}.${requestCounter++ % 250}`,
    }),
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

const IDLE = { status: "idle" } as const;

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

suite("orders and their lines (integration)", () => {
  let db: Database;
  let url: string;
  let close: () => Promise<void>;
  let siteId: string;
  let sent: Notification[];
  let actions: typeof Actions;
  let retention: typeof Retention;

  beforeAll(async () => {
    ({ db, url, close } = await useTestDatabase("cart_order"));
    const { setNotificationSink } = await import("@/lib/notifications");
    setNotificationSink({
      name: "capture",
      async send(notification) {
        sent.push(notification);
      },
    });
    actions = await import("@/lib/forms/actions");
    retention = await import("@/lib/retention-run");
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    sent = [];
    confirmations.length = 0;
    await db.execute(
      sql`truncate table source_sites, order_inquiries, order_inquiry_items, newsletter_subscribers, rate_limit_buckets restart identity cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "cart-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
  });

  const add = async (input: {
    slug: string;
    name: string;
    price?: string | null;
    status?: "active" | "removed";
    availability?: "in_stock" | "out_of_stock" | "preorder" | "unknown";
  }): Promise<string> => {
    const [row] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceKey: `/${input.slug}/`,
        sourceUrl: `https://example.test/${input.slug}/`,
        sourcePath: `/${input.slug}/`,
        semanticHash: input.slug,
        slug: input.slug,
        name: input.name,
        currentPrice: input.price === undefined ? "9.90" : input.price,
        currency: "EUR",
        status: input.status ?? "active",
        availability: input.availability ?? "in_stock",
      })
      .returning({ id: products.id });
    return row!.id;
  };

  const cart = (lines: Array<Record<string, unknown>>, fields: Record<string, string> = {}) =>
    actions.submitCartOrder(
      IDLE,
      form({ lines: JSON.stringify(lines), phone: "0888 123 456", website: "", ...fields }),
    );

  const items = () => db.select().from(orderInquiryItems).orderBy(asc(orderInquiryItems.position));

  it("stores one enquiry with a line per product, priced from the database", async () => {
    const a = await add({
      slug: "a",
      name: "Кафе на зърна Lavazza Crema e Aroma 1кг",
      price: "19.90",
    });
    const b = await add({ slug: "b", name: "Капсули DG Borbone Rossa 16 бр.", price: null });

    const result = await cart(
      [
        // A price in the post is not read: the schema keeps ids and quantities.
        { productId: a, quantity: 2, unitPrice: "0.01" },
        { productId: b, quantity: 1 },
      ],
      { email: "ivan@example.test", customerName: "Иван" },
    );

    expect(result).toMatchObject({
      status: "success",
      reference: expect.stringMatching(/^[0-9A-F]{8}$/),
    });
    const [inquiry] = await db.select().from(orderInquiries);
    expect(inquiry).toMatchObject({
      productId: null,
      productName: null,
      quantity: 3,
      phone: "+359888123456",
      sourcePage: "/bg/kolichka",
    });
    expect(result.status === "success" && result.reference).toBe(
      inquiry!.id.slice(0, 8).toUpperCase(),
    );

    const lines = await items();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      inquiryId: inquiry!.id,
      position: 0,
      productId: a,
      productName: "Кафе на зърна Lavazza Crema e Aroma 1кг",
      productSlug: "a",
      quantity: 2,
      unitPrice: "19.90",
      currency: "EUR",
    });
    // The shop's own name, which is what the customer read.
    expect(lines[0]!.displayName).toBeTruthy();
    expect(lines[1]).toMatchObject({ position: 1, productId: b, unitPrice: null, quantity: 1 });

    // The shop hears what to order, by the names it orders by, and no contact detail.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "order_inquiry", recordId: inquiry!.id });
    expect(sent[0]!.subject).toBe("Нова заявка от количката: 2 продукта, 3 бр.");
    expect(sent[0]!.summary).toMatch(
      /2 × Кафе на зърна Lavazza Crema e Aroma 1кг — 19,90\s€ за брой, 39,80\s€/,
    );
    expect(sent[0]!.summary).toContain("цена при запитване");
    expect(sent[0]!.summary).not.toContain("888");
    expect(sent[0]!.summary).not.toContain("ivan@");

    // The customer gets the confirmation, under the shop's names.
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({
      id: inquiry!.id,
      email: "ivan@example.test",
      customerName: "Иван",
      phone: "+359888123456",
    });
    expect(confirmations[0]!.lines.map((line) => line.name)).toEqual(
      lines.map((line) => line.displayName),
    );
  });

  it("sends no confirmation when no address was given", async () => {
    const a = await add({ slug: "a", name: "A" });
    expect((await cart([{ productId: a, quantity: 1 }])).status).toBe("success");
    expect(confirmations).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it("takes the same cart pressed twice as one order, with one reference", async () => {
    const a = await add({ slug: "a", name: "A" });
    const b = await add({ slug: "b", name: "B" });

    const first = await cart([
      { productId: a, quantity: 2 },
      { productId: b, quantity: 1 },
    ]);
    // The same lines in another order are the same cart.
    const second = await cart([
      { productId: b, quantity: 1 },
      { productId: a, quantity: 2 },
    ]);

    expect(second).toMatchObject({
      status: "success",
      message: expect.stringMatching(/^Вече получихме заявката ви\./),
    });
    expect(second.status === "success" && second.reference).toBe(
      first.status === "success" && first.reference,
    );
    expect(await db.select().from(orderInquiries)).toHaveLength(1);
    expect(await items()).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });

  it("refuses the whole cart when a product went out of stock or was withdrawn, and stores nothing", async () => {
    const a = await add({ slug: "a", name: "A" });
    const sold = await add({
      slug: "b",
      name: "Капсули DG Bianchi Gusto 16 бр.",
      availability: "out_of_stock",
    });
    const gone = await add({ slug: "c", name: "C", status: "removed" });

    for (const blocked of [sold, gone, "44444444-4444-4444-8444-444444444444"]) {
      const result = await cart([
        { productId: a, quantity: 1 },
        { productId: blocked, quantity: 1 },
      ]);
      expect(result.status).toBe("error");
      expect(result.status === "error" && result.message).toMatch(/Прегледайте количката/);
    }
    expect(await db.select().from(orderInquiries)).toHaveLength(0);
    expect(await items()).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it("refuses an empty or forged cart with the form's words", async () => {
    const empty = await cart([]);
    expect(empty).toMatchObject({
      status: "error",
      message: "Количката е празна. Добавете продукт и изпратете отново.",
    });
    const forged = await actions.submitCartOrder(
      IDLE,
      form({ lines: "{not json", phone: "0888 123 456", website: "" }),
    );
    expect(forged).toMatchObject({
      status: "error",
      message: expect.stringMatching(/Презаредете/),
    });
    expect(await db.select().from(orderInquiries)).toHaveLength(0);
  });

  it("answers a filled honeypot as a success with a reference, and stores nothing", async () => {
    const a = await add({ slug: "a", name: "A" });
    const result = await cart([{ productId: a, quantity: 1 }], { website: "http://spam.test" });
    expect(result).toMatchObject({
      status: "success",
      reference: expect.stringMatching(/^[0-9A-F]{8}$/),
    });
    expect(await db.select().from(orderInquiries)).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it("subscribes a ticked box under the cart's own consent source", async () => {
    const a = await add({ slug: "a", name: "A" });
    await cart([{ productId: a, quantity: 1 }], {
      email: "buyer@example.test",
      newsletterConsent: "on",
    });
    const [row] = await db.select().from(newsletterSubscribers);
    expect(row).toMatchObject({ email: "buyer@example.test", consentSource: "cart_form" });
  });

  it("writes a quick order's one product as one line, priced, with a reference", async () => {
    const a = await add({ slug: "a", name: "Капсули DG Borbone Rossa 16 бр.", price: "5.60" });

    const result = await actions.submitOrderInquiry(
      IDLE,
      form({
        productSlug: "a",
        phone: "0888 123 456",
        quantity: "3",
        email: "maria@example.test",
        website: "",
      }),
    );

    expect(result).toMatchObject({
      status: "success",
      reference: expect.stringMatching(/^[0-9A-F]{8}$/),
    });
    const [inquiry] = await db.select().from(orderInquiries);
    // The old columns, as a quick order has always filled them…
    expect(inquiry).toMatchObject({
      productId: a,
      productSlug: "a",
      quantity: 3,
      sourcePage: "/bg/a",
    });
    // …and the line, in the shape a cart's lines have.
    const lines = await items();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      inquiryId: inquiry!.id,
      productId: a,
      productName: "Капсули DG Borbone Rossa 16 бр.",
      quantity: 3,
      unitPrice: "5.60",
      currency: "EUR",
    });
    expect(sent[0]!.subject).toBe("Нова заявка за поръчка: Капсули DG Borbone Rossa 16 бр.");
    expect(sent[0]!.summary).toMatch(
      /3 × Капсули DG Borbone Rossa 16 бр\. — 5,60\s€ за брой, 16,80\s€/,
    );
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]!.lines[0]).toMatchObject({
      quantity: 3,
      unitPrice: { amount: "5.60" },
    });
  });

  it("deletes an order's lines with it when retention deletes the order", async () => {
    const a = await add({ slug: "a", name: "A" });
    await cart([{ productId: a, quantity: 1 }]);
    const [inquiry] = await db.select().from(orderInquiries);
    const old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 13);
    await db
      .update(orderInquiries)
      .set({ status: "cancelled", createdAt: old })
      .where(eq(orderInquiries.id, inquiry!.id));

    const report = await retention.runRetention();

    expect(report.deleted.orderInquiries).toBe(1);
    expect(await items()).toEqual([]);
  });

  it("keeps an order's lines when its product leaves the catalog", async () => {
    const a = await add({ slug: "a", name: "A" });
    await cart([{ productId: a, quantity: 1 }]);
    await db.delete(products).where(eq(products.id, a));
    const [line] = await items();
    expect(line).toMatchObject({ productId: null, productName: "A", productSlug: "a" });
  });

  it("gives every older enquiry its line, once, however often the migration runs", async () => {
    const a = await add({ slug: "a", name: "Старо кафе" });
    // Two rows of the shape the table had before the cart, and one with no product.
    await db
      .insert(orderInquiries)
      .values([
        {
          phone: "+359888000001",
          productId: a,
          productName: "Старо кафе",
          productSlug: "a",
          quantity: 4,
        },
        { phone: "+359888000002", productName: "Изтрит продукт", productSlug: "gone", quantity: 1 },
        { phone: "+359888000003" },
      ]);
    // And one the new code wrote, which already has its line.
    await cart([{ productId: a, quantity: 1 }]);

    const { sql: client, close: closeClient } = createDatabase({ url, max: 1 });
    try {
      await runMigrationFile(client, "0008_order_inquiry_items");
      await runMigrationFile(client, "0008_order_inquiry_items");
    } finally {
      await closeClient();
    }

    const lines = await items();
    expect(lines).toHaveLength(3);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: a,
          productName: "Старо кафе",
          quantity: 4,
          unitPrice: null,
          displayName: null,
        }),
        expect.objectContaining({
          productId: null,
          productName: "Изтрит продукт",
          productSlug: "gone",
        }),
        expect.objectContaining({ productId: a, quantity: 1, unitPrice: "9.90" }),
      ]),
    );
  });
});
