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
 * The age of an enquiry is measured from `created_at`: that is the promise
 * exactly. The age of a contact message is measured from `closed_at`, when it
 * has one — the time its status last moved to a closed one — which is the
 * promise exactly too ("12 months after the conversation closes"). A message
 * closed before that column existed has none, and falls back to `created_at`:
 * earlier than the closing, so it can only go a little before its due date,
 * inside the promise (12 months is a ceiling) and never after it.
 *
 * The mailbox (`mail_threads`, the `info@` conversations) follows the rule the
 * privacy policy now states: a thread whose status is `done` goes 12 months
 * after its LAST message, with its messages. An `open` thread is never selected,
 * whatever its age: it is a conversation somebody still owes an answer to.
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
  /** Contact messages only. When the status last moved to a closed one. */
  readonly closedAt?: Date | null;
}

export interface MailThreadRetentionRow {
  readonly id: string;
  readonly status: string;
  readonly lastMessageAt: Date;
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

/** The statuses of `mail_threads`. `done` is the only one that can expire. */
export const MAIL_THREAD_DONE = "done";

/**
 * The moment a contact message's 12 months start from: when it was closed,
 * or, for a row that predates `closed_at` (or was never closed), when it came
 * in.
 */
export function contactAgeBasis(row: Pick<RetentionRow, "createdAt" | "closedAt">): Date {
  return row.closedAt ?? row.createdAt;
}

export function selectExpired(input: {
  readonly now: Date;
  readonly orders: readonly RetentionRow[];
  readonly contacts: readonly RetentionRow[];
}): RetentionSelection {
  const cutoff = retentionCutoff(input.now).getTime();

  const oldOrders = input.orders.filter((row) => row.createdAt.getTime() < cutoff);
  const oldContacts = input.contacts.filter((row) => contactAgeBasis(row).getTime() < cutoff);

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

/**
 * Which mailbox threads are past retention: `done`, and the last message — not
 * the first — more than 12 months ago. An `open` thread is never returned, at
 * any age, and a status this code does not know is treated like `open`: kept.
 *
 * Separate from `selectExpired` because the mailbox is a different subject from
 * the two form tables (a conversation, not a submission) and is deleted by a
 * different procedure (messages first, in one transaction).
 */
export function selectExpiredThreads(input: {
  readonly now: Date;
  readonly threads: readonly MailThreadRetentionRow[];
}): string[] {
  const cutoff = retentionCutoff(input.now).getTime();
  return input.threads
    .filter((t) => t.status === MAIL_THREAD_DONE && t.lastMessageAt.getTime() < cutoff)
    .map((t) => t.id);
}
