import "server-only";
import { asHtml } from "./html";
import { MAIL_FROM, NOTIFY_TO, adminUrl } from "./identity";
import type { Notification, NotificationSink } from "@/lib/notifications";

/**
 * The real notification provider `notifications.ts` was written to accept.
 *
 * That module has shipped since the beginning with a `NotificationSink`
 * interface, a `setNotificationSink` hook and one implementation that writes a
 * redacted line to the server log — which meant an order enquiry produced a
 * console entry on a serverless host nobody was reading, and nothing else. This
 * is the implementation it was waiting for.
 *
 * ⚠ IT STILL DOES NOT PUT THE CUSTOMER'S DETAILS IN THE MAIL, and that is a
 * deliberate carry-over rather than an omission. The log sink's rule — "the
 * stored record is the place to read those, behind whatever access control the
 * shop applies" — was the right instinct and is now actually satisfiable: there
 * is a panel, it is password-gated, and this message links straight into it. A
 * notification that copies the phone number into an inbox spreads it to a
 * second place with weaker access control, permanently, for the saving of one
 * click.
 *
 * The link is the whole design. Everything else here is envelope.
 */

/** Where each kind of record is read. Kept beside the sink because it is the
 *  one thing that has to change when a screen moves. */
const DESTINATION: Record<Notification["kind"], (id: string) => string> = {
  order_inquiry: (id) => `/admin/zayavki/${id}`,
  contact_message: (id) => `/admin/sabshteniya/${id}`,
  newsletter_signup: () => `/admin/byuletin`,
};

const LABEL: Record<Notification["kind"], string> = {
  order_inquiry: "заявка за поръчка",
  contact_message: "съобщение от формата за контакт",
  newsletter_signup: "нов абонат за бюлетина",
};

/**
 * Send, or throw.
 *
 * Throwing is correct here and the caller is built for it: `notify()` wraps
 * every send in a try/catch and logs the failure, because the record is already
 * safely in the database by the time this runs. A sink that swallowed its own
 * errors would report success for mail that never left.
 */
export const resendSink: NotificationSink = {
  name: "resend",
  async send(notification: Notification) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    if (!NOTIFY_TO) throw new Error("MAIL_TO is not set");

    const link = adminUrl(DESTINATION[notification.kind](notification.recordId));

    const text = [
      notification.summary,
      "",
      `Отворете в панела: ${link}`,
      "",
      "--",
      `Автоматично известие за ${LABEL[notification.kind]}.`,
      "Данните за контакт са в записа, не в това писмо.",
    ].join("\n");

    const { Resend } = await import("resend");
    const { error } = await new Resend(key).emails.send({
      from: MAIL_FROM,
      to: NOTIFY_TO,
      subject: notification.subject,
      text,
      html: asHtml(text),
    });

    if (error) throw new Error(error.message);
  },
};

/**
 * Whether the Resend sink can actually do anything.
 *
 * Both halves or neither: a key with no recipient sends nowhere, and a recipient
 * with no key cannot send. `notifications.ts` consults this to decide between
 * this sink and the log one, rather than picking the mail sink and failing on
 * every notification.
 */
export const canSendNotifications = (): boolean =>
  Boolean(process.env.RESEND_API_KEY) && Boolean(NOTIFY_TO);
