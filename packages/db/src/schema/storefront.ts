import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./catalog.ts";

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
 * Quick-order enquiries.
 *
 * The reference storefront has no cart, no checkout and no payment: ordering
 * is a single phone number and the shop calls back. This table reproduces that
 * functional intent against our own database.
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

    customerName: text("customer_name"),
    phone: text("phone").notNull(),
    email: text("email"),
    quantity: integer("quantity").notNull().default(1),
    notes: text("notes"),

    status: inquiryStatusEnum("status").notNull().default("new"),
    sourcePage: text("source_page"),

    /**
     * Duplicate-submission guard. A hash of (phone, product, time bucket), so
     * a double-clicked button or a retried request cannot create two orders.
     */
    idempotencyKey: text("idempotency_key"),

    /** Non-identifying request context. Never the raw IP: a truncated hash. */
    requestMetadata: jsonb("request_metadata").$type<Record<string, unknown>>().notNull().default({}),

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
 * Newsletter subscribers.
 *
 * Consent timestamp and source are stored because they are what makes the
 * subscription lawful to act on later.
 */
export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull().default(now),
    consentSource: text("consent_source"),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    requestMetadata: jsonb("request_metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    uniqueIndex("newsletter_subscribers_email_idx").on(table.email),
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
    idempotencyKey: text("idempotency_key"),
    requestMetadata: jsonb("request_metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    index("contact_messages_created_idx").on(table.createdAt),
    uniqueIndex("contact_messages_idempotency_idx").on(table.idempotencyKey),
  ],
);
