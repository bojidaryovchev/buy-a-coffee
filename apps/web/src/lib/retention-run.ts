import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { contactMessages, mailMessages, mailThreads, orderInquiries } from "@catalog/db/schema";
import { db } from "@/lib/db";
import {
  CONVERSATION_CLOSED,
  MAIL_THREAD_DONE,
  NOT_AN_ORDER,
  retentionCutoff,
  selectExpired,
  selectExpiredThreads,
} from "@/lib/retention";
import type { InquiryStatus } from "@/lib/inquiry-status";

/**
 * Apply the retention policy: delete what `selectExpired` selects.
 *
 * Deletion, not anonymisation. These rows are nothing but personal data and
 * free text a stranger typed — a phone number, a name, a message — so a row
 * with those blanked would be an empty husk with no use to the shop, and
 * "irreversibly anonymised" is harder to prove than "gone".
 *
 * The report is counts only. It is returned to a cron log, and the log must
 * never become a second copy of what this job exists to remove.
 */

export interface RetentionReport {
  ranAt: string;
  cutoff: string;
  deleted: { orderInquiries: number; contactMessages: number };
  /** The `info@` mailbox, counted apart from the form records above. */
  mailbox: { threadsDeleted: number; messagesDeleted: number };
  /** Past 12 months, but not settled: left alone for a person to resolve. */
  awaitingDecision: { orderInquiries: number; contactMessages: number };
}

/**
 * A contact message's age basis is older than the cutoff: when it was closed,
 * or, with no closing time, when it came in. Written as SQL because it spans
 * two columns; the instant goes in as text because a bare `sql` fragment has no
 * column to tell the driver how to encode a `Date`.
 */
const closedBefore = (cutoff: Date) =>
  sql`coalesce(${contactMessages.closedAt}, ${contactMessages.createdAt}) < ${cutoff.toISOString()}::timestamptz`;

/**
 * Delete finished mailbox threads and their messages, in one transaction.
 *
 * Messages first, then the thread. The thread rows are locked and re-checked
 * (`done`, last message still older than the cutoff) inside the transaction
 * before anything is deleted: between the read in `runRetention` and here an
 * operator may have reopened a conversation, or a reply may have arrived, and
 * neither must cost them the thread. All or nothing — a thread never loses its
 * messages and survives, or the reverse.
 */
async function deleteMailThreads(
  candidateIds: readonly string[],
  cutoff: Date,
): Promise<{ threads: number; messages: number }> {
  if (candidateIds.length === 0) return { threads: 0, messages: 0 };

  return db.transaction(async (tx) => {
    const confirmed = await tx
      .select({ id: mailThreads.id })
      .from(mailThreads)
      .where(
        and(
          inArray(mailThreads.id, [...candidateIds]),
          eq(mailThreads.status, MAIL_THREAD_DONE),
          lt(mailThreads.lastMessageAt, cutoff),
        ),
      )
      .for("update");
    const ids = confirmed.map((t) => t.id);
    if (ids.length === 0) return { threads: 0, messages: 0 };

    const messages = await tx
      .delete(mailMessages)
      .where(inArray(mailMessages.threadId, ids))
      .returning({ id: mailMessages.id });
    const threads = await tx
      .delete(mailThreads)
      .where(inArray(mailThreads.id, ids))
      .returning({ id: mailThreads.id });
    return { threads: threads.length, messages: messages.length };
  });
}

export async function runRetention(now: Date = new Date()): Promise<RetentionReport> {
  const cutoff = retentionCutoff(now);

  /* Only rows already past the age are read, so the table's whole history is
     not pulled in every day. Selection is still done by the pure function; the
     `lt` here is a pre-filter, not a second opinion. */
  const [orders, contacts, threads] = await Promise.all([
    db
      .select({
        id: orderInquiries.id,
        status: orderInquiries.status,
        createdAt: orderInquiries.createdAt,
      })
      .from(orderInquiries)
      .where(lt(orderInquiries.createdAt, cutoff)),
    db
      .select({
        id: contactMessages.id,
        status: contactMessages.status,
        createdAt: contactMessages.createdAt,
        closedAt: contactMessages.closedAt,
      })
      .from(contactMessages)
      // Age counts from the closing when there is one, so a message closed
      // recently is not even read; `created_at` is the fallback for rows that
      // predate the column.
      .where(closedBefore(cutoff)),
    db
      .select({
        id: mailThreads.id,
        status: mailThreads.status,
        lastMessageAt: mailThreads.lastMessageAt,
      })
      .from(mailThreads)
      // `done` only: an open thread is never read here, let alone deleted.
      .where(and(eq(mailThreads.status, MAIL_THREAD_DONE), lt(mailThreads.lastMessageAt, cutoff))),
  ]);

  const selection = selectExpired({ now, orders, contacts });
  const mailThreadIds = selectExpiredThreads({ now, threads });

  /* The status is re-checked in the DELETE itself. Between the read above and
     here an operator may have marked an enquiry fulfilled, and a delete keyed
     on the id alone would take an order's record with it. */
  const deletedOrders =
    selection.orderIds.length === 0
      ? []
      : await db
          .delete(orderInquiries)
          .where(
            and(
              inArray(orderInquiries.id, selection.orderIds),
              inArray(orderInquiries.status, [...NOT_AN_ORDER] as InquiryStatus[]),
            ),
          )
          .returning({ id: orderInquiries.id });

  const deletedContacts =
    selection.contactIds.length === 0
      ? []
      : await db
          .delete(contactMessages)
          .where(
            and(
              inArray(contactMessages.id, selection.contactIds),
              inArray(contactMessages.status, [...CONVERSATION_CLOSED] as InquiryStatus[]),
              // Closed again since the read? Then its 12 months start over.
              closedBefore(cutoff),
            ),
          )
          .returning({ id: contactMessages.id });

  const deletedMail = await deleteMailThreads(mailThreadIds, cutoff);

  return {
    ranAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    deleted: { orderInquiries: deletedOrders.length, contactMessages: deletedContacts.length },
    mailbox: { threadsDeleted: deletedMail.threads, messagesDeleted: deletedMail.messages },
    awaitingDecision: {
      orderInquiries: selection.awaitingDecision.orders,
      contactMessages: selection.awaitingDecision.contacts,
    },
  };
}
