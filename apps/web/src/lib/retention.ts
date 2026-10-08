import type { InquiryStatus } from "@/lib/inquiry-status";

/**
 * Which stored enquiries and messages are past the retention the privacy policy
 * promises. Pure: rows and "now" in, ids out.
 *
 * The policy (`content/legal.ts`, "Колко дълго ги пазим") says:
 *
 *  - order enquiries that did not lead to an order are kept up to 12 months;
 *  - contact-form messages are kept up to 12 months after the conversation
 *    closes.
 *
 * Both sentences are promises about a MAXIMUM, which is why the code leans one
 * way: a row is deleted only when it is certain to be in scope, and anything
 * that might still be an order or a live conversation is left alone and merely
 * counted, so a person can decide. Deleting an order's record is the error that
 * cannot be undone; keeping an unresolved enquiry for a few more weeks while
 * somebody is nagged to resolve it is not.
 *
 * What the statuses mean here (see `inquiry-status.ts`):
 *
 *  - `converted` ("Изпълнена") — it became an order. Never selected, at any age:
 *    the accounting documents behind it have their own, longer, statutory clock.
 *  - `cancelled`, `spam` — decided against by the operator: definitely not an
 *    order. Selected once old enough.
 *  - `new`, `contacted` — undecided. A `contacted` enquiry is the shop having
 *    rung back, which is exactly the state an order is in a moment before it is
 *    marked fulfilled. Not selected; counted as awaiting a decision.
 *
 * For a contact message "closed" has the same reading, except that `converted`
 * ("Изпълнена") is a closed conversation too, since a message has no order to
 * protect: the operator marking it done is the closing.
 *
 * ⚠ The age is measured from `created_at`, because neither table records when
 * it was closed. For an enquiry that is the promise exactly. For a message it is
 * earlier than "12 months after closing", so a message may go a little before
 * its due date — inside the promise, since 12 months is the ceiling — and never
 * after it. A `closed_at` column would make it exact.
 */

export const RETENTION_MONTHS = 12;

/** Statuses that settle an enquiry as NOT having become an order. */
export const NOT_AN_ORDER: readonly InquiryStatus[] = ["cancelled", "spam"];

/** Statuses that mean a contact conversation is over. */
export const CONVERSATION_CLOSED: readonly InquiryStatus[] = ["converted", "cancelled", "spam"];

export interface RetentionRow {
  readonly id: string;
  readonly status: string;
  readonly createdAt: Date;
}

export interface RetentionSelection {
  readonly orderIds: string[];
  readonly contactIds: string[];
  /** Past retention by age, but not by status: left in place until a person
      decides what they were. Counts only. */
  readonly awaitingDecision: { readonly orders: number; readonly contacts: number };
}

/** The instant `months` calendar months before `now`, in UTC. */
export function retentionCutoff(now: Date, months: number = RETENTION_MONTHS): Date {
  const cutoff = new Date(now.getTime());
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  /* 31 March minus 1 month is not "31 February": clamp to the month's last
     day instead of letting Date roll it into the next month. */
  const lastDay = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return cutoff;
}

export function selectExpired(input: {
  readonly now: Date;
  readonly orders: readonly RetentionRow[];
  readonly contacts: readonly RetentionRow[];
}): RetentionSelection {
  const cutoff = retentionCutoff(input.now).getTime();
  const old = (row: RetentionRow) => row.createdAt.getTime() < cutoff;

  const oldOrders = input.orders.filter(old);
  const oldContacts = input.contacts.filter(old);

  const isNotAnOrder = (r: RetentionRow) => NOT_AN_ORDER.includes(r.status as InquiryStatus);
  const isClosed = (r: RetentionRow) => CONVERSATION_CLOSED.includes(r.status as InquiryStatus);

  /* Undecided is written as the complement of "settled", not as `new` or
     `contacted`, so a status added later is counted rather than silently
     ignored. */
  return {
    orderIds: oldOrders.filter(isNotAnOrder).map((r) => r.id),
    contactIds: oldContacts.filter(isClosed).map((r) => r.id),
    awaitingDecision: {
      orders: oldOrders.filter((r) => r.status !== "converted" && !isNotAnOrder(r)).length,
      contacts: oldContacts.filter((r) => !isClosed(r)).length,
    },
  };
}
