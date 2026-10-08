import "server-only";
import { and, inArray, lt } from "drizzle-orm";
import { contactMessages, orderInquiries } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { CONVERSATION_CLOSED, NOT_AN_ORDER, retentionCutoff, selectExpired } from "@/lib/retention";
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
  /** Past 12 months, but not settled: left alone for a person to resolve. */
  awaitingDecision: { orderInquiries: number; contactMessages: number };
}

export async function runRetention(now: Date = new Date()): Promise<RetentionReport> {
  const cutoff = retentionCutoff(now);

  /* Only rows already past the age are read, so the table's whole history is
     not pulled in every day. Selection is still done by the pure function; the
     `lt` here is a pre-filter, not a second opinion. */
  const [orders, contacts] = await Promise.all([
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
      })
      .from(contactMessages)
      .where(lt(contactMessages.createdAt, cutoff)),
  ]);

  const selection = selectExpired({ now, orders, contacts });

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
            ),
          )
          .returning({ id: contactMessages.id });

  return {
    ranAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    deleted: { orderInquiries: deletedOrders.length, contactMessages: deletedContacts.length },
    awaitingDecision: {
      orderInquiries: selection.awaitingDecision.orders,
      contactMessages: selection.awaitingDecision.contacts,
    },
  };
}
