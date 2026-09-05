import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The `info@` mailbox.
 *
 * Mail to and from the shop's published address, so it can be answered from the
 * admin panel and answered **as** that address — which a forward to a personal
 * inbox can never do, because a reply from Gmail leaves as the Gmail address.
 *
 * Storefront-owned, like `storefront.ts` beside it: the sync never writes here.
 * It is a separate file because it is a separate subject — those tables record
 * what a customer submitted through a form, these record a conversation, and
 * the two have almost nothing in common beyond both involving a customer.
 *
 * Two tables rather than one. A thread has state (has this been dealt with?)
 * and a message does not; hanging a status off every message and updating the
 * lot on each change is the shape you get when you refuse the second table.
 *
 * The two closed sets below are `text ... { enum }` rather than `pgEnum`, which
 * is a deliberate departure from `inquiryStatusEnum` next door. Adding a value
 * to a Postgres enum is an `ALTER TYPE` that cannot run inside a transaction on
 * older servers and cannot be reversed; adding one here is a code change. The
 * TypeScript narrowing is identical either way.
 */

export const MAIL_DIRECTIONS = ["in", "out"] as const;
export type MailDirection = (typeof MAIL_DIRECTIONS)[number];

/** Two states, not five. `inquiryStatusEnum` earns a pipeline because an order
 *  is a sale in progress; a mailbox only needs to know what still owes a
 *  reply. */
export const MAIL_THREAD_STATUSES = ["open", "done"] as const;
export type MailThreadStatus = (typeof MAIL_THREAD_STATUSES)[number];

/**
 * Attachment metadata. The bytes stay in Resend, which keeps them for sent and
 * received mail alike and hands out signed URLs on request — so storing them
 * again would be paying twice to be the second-freshest copy.
 *
 * No Resend id here on purpose. The download route asks Resend for the list
 * afresh and takes the nth entry, which works for a message we sent as well as
 * one we received, and cannot go stale the way a copied id can.
 */
export interface MailAttachment {
  filename: string;
  size: number;
  contentType: string;
}

export const mailThreads = pgTable(
  "mail_threads",
  {
    /**
     * A short uppercase id, not a `uuid`, and the one place this file departs
     * from every other table here.
     *
     * It goes in a URL the shop owner reads off a screen and may quote on the
     * phone. `defaultRandom()` would be right if it were only ever a key; this
     * is also a reference, and eight characters can be read aloud.
     */
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /** Sorted on, so the list reads newest-activity-first without a subquery. */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),

    subject: text("subject").notNull(),
    /** The other party. One thread is one correspondent: this inbox is a shop
        answering customers and suppliers, not a shared mailing list. */
    correspondent: text("correspondent").notNull(),
    correspondentName: text("correspondent_name"),

    status: text("status", { enum: MAIL_THREAD_STATUSES }).notNull().default("open"),
  },
  (table) => [
    index("mail_threads_last_message_at_idx").on(table.lastMessageAt),
    /* Matching an incoming message to an existing thread looks up exactly this
       pair when the References header gives us nothing to go on. */
    index("mail_threads_correspondent_idx").on(table.correspondent),
  ],
);

export const mailMessages = pgTable(
  "mail_messages",
  {
    /** Resend's id: the received-email id inbound, the sent-email id outbound.
        Also the handle the attachment endpoints are keyed by, which is why it
        is the primary key rather than an id of our own. */
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => mailThreads.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    direction: text("direction", { enum: MAIL_DIRECTIONS }).notNull(),

    fromAddress: text("from_address").notNull(),
    toAddresses: text("to_addresses").notNull(),
    subject: text("subject").notNull(),

    bodyText: text("body_text"),
    bodyHtml: text("body_html"),

    /** RFC 5322 Message-ID of an incoming message, and the In-Reply-To of the
        one after it. Kept because they are what makes a reply land in the same
        thread in the customer's mail client rather than starting a new one. */
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),

    attachments: jsonb("attachments").$type<MailAttachment[]>(),
  },
  (table) => [
    index("mail_messages_thread_idx").on(table.threadId, table.createdAt),
    /* Threading an incoming reply means asking "do we know this Message-ID?" */
    index("mail_messages_message_id_idx").on(table.messageId),
  ],
);
