import "server-only";
import { eq, inArray } from "drizzle-orm";
import { orderInquiries, orderInquiryItems, promotions } from "@catalog/db/schema";
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
  /** Exact decimal string, or null for "Цена при запитване". Any promotion is already off it. */
  readonly unitPrice: string | null;
  readonly currency: string | null;
  /*
   * Set when the shop's own promotion priced the line, null otherwise: the
   * price without it, the promotion's percentage, and which promotion it was.
   * What the owner reads the margin from, later, whatever the promotion
   * becomes.
   */
  readonly regularUnitPrice: string | null;
  readonly discountPercent: number | null;
  readonly promotionId: string | null;
  /**
   * The owner's name for that promotion, as it was when the order came in.
   * Never on a card, so `recordInquiry` looks it up; null until it has.
   */
  readonly promotionName: string | null;
  /**
   * The reduction the customer was shown for the product when they sent the
   * order: its struck price and its badge. Not stored — the record keeps the
   * promotion's own figures above, which are the owner's — but repeated in the
   * customer's confirmation, which must say no more than the page said.
   */
  readonly shownReduction: {
    readonly oldUnitPrice: string;
    /** Null when it rounded under one percent, as on the card. */
    readonly percent: number | null;
  } | null;
}

/** A line snapshot from a product as the database holds it now. */
export function itemFor(product: ProductForOrder, quantity: number): OrderItem {
  const { card } = product;
  // Only a priced line has anything taken off it.
  const promotion = card.price && card.promotion?.regularPrice ? card.promotion : null;
  return {
    productId: card.id,
    productName: product.sourceName,
    displayName: card.name,
    productSlug: card.slug,
    quantity,
    unitPrice: card.price?.amount ?? null,
    currency: card.price?.currency ?? null,
    regularUnitPrice: promotion?.regularPrice?.amount ?? null,
    discountPercent: promotion?.percentOff ?? null,
    promotionId: promotion?.id ?? null,
    promotionName: null,
    shownReduction:
      card.price && card.oldPrice
        ? {
            oldUnitPrice: card.oldPrice.amount,
            percent:
              card.discountPercent !== null && card.discountPercent >= 1
                ? card.discountPercent
                : null,
          }
        : null,
  };
}

/**
 * The items as the customer's confirmation lists them: under the shop's names,
 * and reduced only where the page showed a reduction, by what it showed. Never
 * a promotion's own name.
 */
export function confirmationLines(items: readonly OrderItem[]): OrderLine[] {
  return items.map((item) => {
    // The price only: the promotion's own figures are the owner's.
    const { quantity, unitPrice, currency } = item;
    const line = storedLine({ quantity, unitPrice, currency }, item.displayName);
    const shown = item.shownReduction;
    if (!shown || !line.unitPrice) return line;
    return {
      ...line,
      reduction: {
        reader: "customer",
        before: { amount: shown.oldUnitPrice, currency: line.unitPrice.currency },
        percent: shown.percent,
      },
    };
  });
}

export type NewInquiry = Omit<typeof orderInquiries.$inferInsert, "id" | "createdAt" | "updatedAt">;

/**
 * Store an enquiry and its lines.
 *
 * `created` is false when the idempotency key was already taken — the same
 * customer pressing the button twice — and the id is then the first press's
 * enquiry, so the customer is shown the same reference both times.
 *
 * `items` comes back as stored: with each promotion's name, read here because
 * the card never carries it. The promotions are locked against deletion until
 * the lines naming them are in (`for key share`), so the foreign key cannot
 * fail the order. One the shop no longer has — impossible for one that priced
 * a line, since a promotion that has started is never deleted, but not worth
 * losing an order over — leaves its line with the figures and without the
 * reference.
 */
export async function recordInquiry(
  inquiry: NewInquiry & { idempotencyKey: string },
  items: readonly OrderItem[],
): Promise<{ id: string; created: boolean; items: readonly OrderItem[] }> {
  return db.transaction(async (tx) => {
    const wanted = [
      ...new Set(items.flatMap((item) => (item.promotionId ? [item.promotionId] : []))),
    ];
    const names = new Map(
      wanted.length === 0
        ? []
        : (
            await tx
              .select({ id: promotions.id, name: promotions.name })
              .from(promotions)
              .where(inArray(promotions.id, wanted))
              .for("key share")
          ).map((row) => [row.id, row.name] as const),
    );
    const named = items.map((item) =>
      item.promotionId === null
        ? item
        : {
            ...item,
            promotionId: names.has(item.promotionId) ? item.promotionId : null,
            promotionName: names.get(item.promotionId) ?? null,
          },
    );

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
      return { id: existing.id, created: false, items: named };
    }

    if (named.length > 0) {
      await tx.insert(orderInquiryItems).values(
        named.map((item, position) => ({
          inquiryId: row.id,
          position,
          productId: item.productId,
          productName: item.productName,
          displayName: item.displayName,
          productSlug: item.productSlug,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          currency: item.currency,
          regularUnitPrice: item.regularUnitPrice,
          discountPercent: item.discountPercent,
          promotionId: item.promotionId,
          promotionName: item.promotionName,
        })),
      );
    }
    return { id: row.id, created: true, items: named };
  });
}
