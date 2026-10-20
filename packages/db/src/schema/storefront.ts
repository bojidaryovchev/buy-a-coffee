import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./catalog.ts";
import { promotions } from "./promotions.ts";

const now = sql`now()`;

/**
 * Storefront-owned tables.
 *
 * Kept separate from the catalog tables the sync writes: the sync owns source
 * mirroring, the storefront owns customer interactions. Nothing here is ever
 * written by the scraper.
 */

export const inquiryStatusEnum = pgEnum("inquiry_status", [
  "new",
  "contacted",
  "converted",
  "cancelled",
  "spam",
]);

/**
 * Order enquiries: a phone number the shop calls back, and what it is about.
 *
 * There is no checkout and no payment: an enquiry becomes an order on the
 * phone. It comes from one of two forms — the quick order on a product page,
 * or the cart — and what was asked for is in `order_inquiry_items`, one row per
 * product, whichever form it came from.
 *
 * `productId`, `productName`, `productSlug` and `quantity` are the shape this
 * table had before the cart. A quick order still fills them, so a row stays
 * readable by anything written against that shape; a cart order leaves the
 * product columns empty and puts its total number of units in `quantity`. The
 * items are the record of what was ordered.
 *
 * `productId` is nullable and `productName` is denormalised on purpose — an
 * enquiry must remain readable even if the product is later removed from the
 * catalog.
 */
export const orderInquiries = pgTable(
  "order_inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name"),
    productSlug: text("product_slug"),

    /** The full name. Optional and free-form before 19 October 2026; since then
        written from `firstName` and `lastName`, so older readers still have it. */
    customerName: text("customer_name"),
    phone: text("phone").notNull(),
    email: text("email"),
    quantity: integer("quantity").notNull().default(1),
    notes: text("notes"),

    /*
     * Who the order is for and where it goes, so the call back only confirms
     * it. Required by the form since 19 October 2026; null on older orders.
     * `deliveryMethod` is `address` (postcode and address set, office null) or
     * `office` (a courier's office or a BOX NOW locker for the customer to
     * collect from: office set, postcode and address null). `deliveryColumns` in
     * `apps/web/src/lib/orders/delivery.ts` keeps to that.
     */
    firstName: text("first_name"),
    lastName: text("last_name"),
    deliveryMethod: text("delivery_method"),
    /** `econt` or `speedy` to an address; those or `boxnow` to an office or locker. */
    deliveryCourier: text("delivery_courier"),
    deliveryCity: text("delivery_city"),
    deliveryPostcode: text("delivery_postcode"),
    deliveryAddress: text("delivery_address"),
    deliveryOffice: text("delivery_office"),

    status: inquiryStatusEnum("status").notNull().default("new"),
    sourcePage: text("source_page"),

    /**
     * Duplicate-submission guard. A hash of (phone, product, time bucket), so
     * a double-clicked button or a retried request cannot create two orders.
     */
    idempotencyKey: text("idempotency_key"),

    /** Non-identifying request context. Never the raw IP: a truncated hash. */
    requestMetadata: jsonb("request_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    index("order_inquiries_created_idx").on(table.createdAt),
    index("order_inquiries_status_idx").on(table.status),
    index("order_inquiries_product_idx").on(table.productId),
    uniqueIndex("order_inquiries_idempotency_idx").on(table.idempotencyKey),
  ],
);

/**
 * What an enquiry asks for: one row per product, in the order the customer
 * listed them.
 *
 * Everything is a snapshot taken when the enquiry was stored, priced from the
 * database and never from the browser. The catalog moves on — a price changes
 * on the next sync, a product is renamed or removed — and the operator calling
 * back needs what the customer saw, so nothing here is read through
 * `productId`, which only links to the product while it exists.
 *
 * Two names, because two people read this. `productName` is the supplier's
 * wording (`products.name`), which is what the owner orders by and what the
 * panel and the notification show. `displayName` is the shop's own name for the
 * product (`productName()` in `@catalog/shared`), which is what the customer
 * read, and the only one a message addressed to them may use. Rows written
 * before the cart have no `displayName` and no price: those were never
 * recorded.
 *
 * `unitPrice` is null for a product sold at "Цена при запитване": its price is
 * said on the call. Deleted with its enquiry (`on delete cascade`), so the
 * retention job that deletes an enquiry deletes what it asked for with it.
 */
export const orderInquiryItems = pgTable(
  "order_inquiry_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => orderInquiries.id, { onDelete: "cascade" }),
    /** 0-based, the order the lines were listed in. */
    position: integer("position").notNull().default(0),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name"),
    displayName: text("display_name"),
    productSlug: text("product_slug"),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    currency: text("currency"),
    /**
     * Set when a promotion priced the line: the price without it, the
     * promotion's reduction, and which promotion, under the owner's name for
     * it then. Null on every other line, and on lines stored before 0013.
     */
    regularUnitPrice: numeric("regular_unit_price", { precision: 12, scale: 2 }),
    discountPercent: integer("discount_percent"),
    promotionId: uuid("promotion_id").references(() => promotions.id, { onDelete: "set null" }),
    promotionName: text("promotion_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    index("order_inquiry_items_inquiry_idx").on(table.inquiryId, table.position),
    index("order_inquiry_items_product_idx").on(table.productId),
  ],
);

/**
 * Newsletter subscribers.
 *
 * Consent timestamp and source are stored because they are what makes the
 * subscription lawful to act on later: "who agreed, when, and how" has to be
 * answerable for every row. `consentSource` is a short code naming the form or
 * the way the operator was told (`lib/forms/consent.ts` holds the list).
 *
 * `unsubscribeToken` is what an unsubscribe link carries. It is unguessable,
 * unique, generated by the database so that no insert path can forget it, and
 * never shown anywhere but in a link addressed to the subscriber.
 */
export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull().default(now),
    consentSource: text("consent_source"),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    unsubscribeToken: text("unsubscribe_token")
      .notNull()
      .default(sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`),
    requestMetadata: jsonb("request_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("newsletter_subscribers_email_idx").on(table.email),
    uniqueIndex("newsletter_subscribers_unsubscribe_token_idx").on(table.unsubscribeToken),
    index("newsletter_subscribers_created_idx").on(table.createdAt),
  ],
);

/** Contact-form messages. */
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    subject: text("subject"),
    message: text("message").notNull(),
    status: inquiryStatusEnum("status").notNull().default("new"),
    /**
     * When the status last moved to a closed one (anything but `new` and
     * `contacted`); null while open. Retention counts its 12 months from here.
     * Null on a closed row means it was closed before this column existed, and
     * retention falls back to `createdAt`, which can only be earlier.
     */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    requestMetadata: jsonb("request_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    index("contact_messages_created_idx").on(table.createdAt),
    uniqueIndex("contact_messages_idempotency_idx").on(table.idempotencyKey),
  ],
);
