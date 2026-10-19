import "server-only";
import { eq } from "drizzle-orm";
import { orderInquiries, orderInquiryItems } from "@catalog/db/schema";
import { db } from "@/lib/db";
import type { ProductForOrder } from "@/lib/catalog/queries";
import { storedLine, type OrderLine } from "./lines";

/**
 * Storing an order enquiry with what it asks for.
 *
 * Both forms come through here — the quick order with its one product, the
 * cart with several — so an enquiry always has its lines in
 * `order_inquiry_items`, and the panel and the mail read one shape.
 *
 * The enquiry and its lines are written in one transaction. An enquiry without
 * its lines would be a phone number with no order attached; lines without an
 * enquiry cannot exist (the foreign key). Either both are stored or the
 * customer is told it failed.
 */

/** One line, priced and named at the moment the enquiry is stored. */
export interface OrderItem {
  readonly productId: string;
  /** The supplier's name: what the owner orders by. */
  readonly productName: string;
  /** The shop's name: what the customer saw. */
  readonly displayName: string;
  readonly productSlug: string;
  readonly quantity: number;
  /** Exact decimal string, or null for "Цена при запитване". */
  readonly unitPrice: string | null;
  readonly currency: string | null;
}

/** A line snapshot from a product as the database holds it now. */
export function itemFor(product: ProductForOrder, quantity: number): OrderItem {
  return {
    productId: product.card.id,
    productName: product.sourceName,
    displayName: product.card.name,
    productSlug: product.card.slug,
    quantity,
    unitPrice: product.card.price?.amount ?? null,
    currency: product.card.price?.currency ?? null,
  };
}

/** The items as sum lines, under the name the reader should see. */
export function itemLines(
  items: readonly OrderItem[],
  name: "productName" | "displayName",
): OrderLine[] {
  return items.map((item) => storedLine(item, item[name]));
}

export type NewInquiry = Omit<typeof orderInquiries.$inferInsert, "id" | "createdAt" | "updatedAt">;

/**
 * Store an enquiry and its lines.
 *
 * `created` is false when the idempotency key was already taken — the same
 * customer pressing the button twice — and the id is then the first press's
 * enquiry, so the customer is shown the same reference both times.
 */
export async function recordInquiry(
  inquiry: NewInquiry & { idempotencyKey: string },
  items: readonly OrderItem[],
): Promise<{ id: string; created: boolean }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(orderInquiries)
      .values(inquiry)
      // A double-clicked button must not create two orders.
      .onConflictDoNothing({ target: orderInquiries.idempotencyKey })
      .returning({ id: orderInquiries.id });

    if (!row) {
      const [existing] = await tx
        .select({ id: orderInquiries.id })
        .from(orderInquiries)
        .where(eq(orderInquiries.idempotencyKey, inquiry.idempotencyKey))
        .limit(1);
      if (!existing) throw new Error("Idempotency conflict without an existing enquiry");
      return { id: existing.id, created: false };
    }

    if (items.length > 0) {
      await tx.insert(orderInquiryItems).values(
        items.map((item, position) => ({
          inquiryId: row.id,
          position,
          productId: item.productId,
          productName: item.productName,
          displayName: item.displayName,
          productSlug: item.productSlug,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          currency: item.currency,
        })),
      );
    }
    return { id: row.id, created: true };
  });
}
