import type { Notification } from "@/lib/notifications";
import { orderLinesText, storedLine } from "@/lib/orders/lines";

/**
 * What the shop is told about a new record, built from the whole record and
 * keeping back what must not travel.
 *
 * The record arrives with everything the customer gave — phone, address,
 * name, a note — and the notification is the one place they are dropped
 * (`notify-sink.ts` explains why: an inbox is a second copy with weaker access
 * control, and the panel is one tap away). So the builders take the whole
 * record on purpose: `test/owner-notices.test.ts` hands them one full of
 * contact details and checks that none of it reaches the mail, which a test of
 * the mail template alone, fed a summary somebody already cleaned, could not.
 *
 * No `server-only` and no database: the order form's action and the test call
 * the same functions.
 */

interface OrderedItem {
  /** The supplier's name: what the owner orders by. */
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: string | null;
  readonly currency: string | null;
}

export interface OrderRecord {
  readonly id: string;
  readonly subject: string;
  readonly items: readonly OrderedItem[];
  /* Contact details, present on every order and kept out of the notice. */
  readonly phone: string;
  readonly email: string | null;
  readonly customerName: string | null;
  readonly notes?: string | null;
}

export function orderNotice(order: OrderRecord): Notification {
  const lines = order.items.map((item) => storedLine(item, item.productName));
  return {
    kind: "order_inquiry",
    subject: order.subject,
    summary: orderLinesText(lines).join("\n"),
    lines,
    recordId: order.id,
  };
}

export interface ContactRecord {
  readonly id: string;
  /** What the customer typed as the subject; it is theirs to word. */
  readonly subject: string | null;
  readonly name: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly message: string;
}

export function contactNotice(message: ContactRecord): Notification {
  return {
    kind: "contact_message",
    subject: `Форма за контакт: ${message.subject || "без тема"}`,
    summary: "Съобщението и данните за контакт са в записа в базата.",
    recordId: message.id,
  };
}

export function signupNotice(subscriber: { id: string; email: string }): Notification {
  return {
    kind: "newsletter_signup",
    subject: "Нов абонат за бюлетина",
    summary: "Адресът е в записа в базата.",
    recordId: subscriber.id,
  };
}
