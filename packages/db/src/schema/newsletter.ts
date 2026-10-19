import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { newsletterSubscribers } from "./storefront.ts";

const now = sql`now()`;

/**
 * Newsletters the shop sends from its own panel, and who each one went to.
 *
 * Storefront-owned, like `storefront.ts`, whose subscriber list these send to:
 * the sync never writes here. A file of its own because it is a subject of its
 * own — a subscriber is a consent, a campaign is a piece of mail and its
 * delivery record — and because the two tables only make sense together.
 *
 * Sent by us through Resend's batch endpoint rather than as a Resend
 * Broadcast, and the reason is the second table. Each subscriber gets their own
 * unsubscribe link and one-click header, so every message is rendered for its
 * reader; and with a row per reader, "who has this already gone to" is a
 * question this database answers, which is what makes an interrupted send
 * safe to resume without mailing anybody twice (`lib/newsletter/send.ts`).
 *
 * The closed sets are `text ... { enum }` rather than `pgEnum`, as in
 * `mail.ts`: adding a state is then a code change, not an `ALTER TYPE`.
 */

/**
 * Where a campaign is.
 *
 *   draft    being written; the only state in which it can be edited
 *   sending  recipients are fixed and mail is going out (or the run that was
 *            sending it died — the panel tells the two apart by `updatedAt`)
 *   sent     every recipient has an answer and none of them is a failure
 *   partial  some went, and some failed or are still waiting for a resume
 *   failed   nothing went
 */
export const NEWSLETTER_CAMPAIGN_STATUSES = [
  "draft",
  "sending",
  "sent",
  "partial",
  "failed",
] as const;
export type NewsletterCampaignStatus = (typeof NEWSLETTER_CAMPAIGN_STATUSES)[number];

/**
 * Where one recipient's copy is.
 *
 *   pending     in the snapshot, not yet handed to Resend
 *   sending     given its own idempotency key (`batchKey`), and either handed
 *               over in a request whose answer we have not recorded, or
 *               waiting its turn in a request split one address at a time.
 *               Not "pending": a request that may have reached Resend is sent
 *               again only under the same key, so Resend answers it from
 *               memory instead of mailing the person twice. `attemptedAt` is
 *               null until a request under the current key has gone out
 *   sent        Resend accepted it; `resendEmailId` is its id there
 *   failed      Resend refused it, or we cannot know whether it went (`error`)
 *   skipped     the person left the list, or the row was removed, between the
 *               snapshot and their turn — not mailed, on purpose
 *   bounced     accepted, then bounced permanently (Resend's `email.bounced`)
 *   complained  accepted, then reported as spam (`email.complained`)
 *
 * The last two arrive by webhook after the send, matched on `resendEmailId`,
 * and take the subscriber off the list.
 */
export const NEWSLETTER_DELIVERY_STATUSES = [
  "pending",
  "sending",
  "sent",
  "failed",
  "skipped",
  "bounced",
  "complained",
] as const;
export type NewsletterDeliveryStatus = (typeof NEWSLETTER_DELIVERY_STATUSES)[number];

/**
 * A file the newsletter carries, hosted on Vercel Blob under `newsletter/`.
 *
 * Hosted rather than attached because Resend's batch endpoint takes no
 * attachments — and a 2 MB PDF attached to every copy is also the heaviest
 * possible way to send it. An image is drawn in the message; anything else is
 * a download button.
 */
export interface NewsletterAttachment {
  url: string;
  /** The name it was uploaded with, shown to the reader. */
  name: string;
  contentType: string;
  /** Bytes, as the browser reported them at upload. For display only. */
  size: number;
  kind: "image" | "file";
  /** What an image shows, for a reader who cannot see it. Images only. */
  alt?: string;
}

export const newsletterCampaigns = pgTable(
  "newsletter_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Empty while a draft is being written; a send refuses an empty one. */
    subject: text("subject").notNull().default(""),
    /** The line a mail client shows after the subject. Never shown in the body. */
    preheader: text("preheader").notNull().default(""),
    /**
     * What the owner typed, in the small Markdown subset `emails/markdown.ts`
     * reads. Stored as source, never as HTML: the message is rendered from it
     * at send time by the same code that drew the preview.
     */
    body: text("body").notNull().default(""),
    attachments: jsonb("attachments").$type<NewsletterAttachment[]>().notNull().default([]),
    /**
     * Counts the draft's saves. The composer is drawn with it and sends it
     * back with every press, and a save or a send is refused unless it still
     * matches: a tab that has not seen another tab's save must neither
     * overwrite that save nor send a letter nobody confirmed. A counter, not
     * `updatedAt`: two saves can share a millisecond.
     */
    revision: integer("revision").notNull().default(0),

    status: text("status", { enum: NEWSLETTER_CAMPAIGN_STATUSES }).notNull().default("draft"),
    /** Fixed when sending starts: the active subscribers at that moment. */
    recipientCount: integer("recipient_count").notNull().default(0),
    /** Recomputed from the deliveries after every request, never incremented. */
    sentCount: integer("sent_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    /** The last thing that went wrong, in Bulgarian, for the panel. */
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
    /** Also the sender's heartbeat: a `sending` campaign whose row has not
        moved for minutes has lost the process that was sending it. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(now),
    /** When the recipients were fixed and the first request went out. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** When the last recipient got an answer. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [index("newsletter_campaigns_created_idx").on(table.createdAt)],
);

export const newsletterDeliveries = pgTable(
  "newsletter_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => newsletterCampaigns.id, { onDelete: "cascade" }),
    /** Null once the subscriber row is gone; the address below stays as the
        record of who it was sent to. */
    subscriberId: uuid("subscriber_id").references(() => newsletterSubscribers.id, {
      onDelete: "set null",
    }),
    /** The address at the snapshot. */
    email: text("email").notNull(),

    status: text("status", { enum: NEWSLETTER_DELIVERY_STATUSES }).notNull().default("pending"),
    /** The Idempotency-Key of the request that carries this copy. See `sending`. */
    batchKey: text("batch_key"),
    /** Resend's id for this copy. A bounce or complaint is matched on it and on
        nothing else: the account and its webhooks serve four sites, and an
        address alone could be another site's subscriber. */
    resendEmailId: text("resend_email_id"),
    error: text("error"),
    /** When a request under the current `batchKey` first went out. The 23-hour
        "may have arrived" rule counts from here; null means none has. */
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(now),
  },
  (table) => [
    /* One copy per person per campaign, whatever retries and resumes do: the
       snapshot inserts with ON CONFLICT DO NOTHING against this. */
    uniqueIndex("newsletter_deliveries_campaign_subscriber_idx").on(
      table.campaignId,
      table.subscriberId,
    ),
    /* The sender's one query: the next pending rows of a campaign. */
    index("newsletter_deliveries_campaign_status_idx").on(table.campaignId, table.status),
    /* The bounce and complaint webhook's lookup. */
    index("newsletter_deliveries_resend_email_id_idx").on(table.resendEmailId),
  ],
);
