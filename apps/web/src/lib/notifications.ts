import "server-only";

/**
 * Notification abstraction.
 *
 * An enquiry is persisted first and notified second, always. If the email
 * provider is down, misconfigured, or simply not set up yet, the order is
 * still safely in the database — losing a customer's order because an SMTP
 * host was unreachable would be the worst possible failure here.
 *
 * With no provider configured the default sink logs a redacted line so the
 * shop can see that something arrived, and the README explains how to wire a
 * real provider in.
 */

export interface Notification {
  readonly kind: "order_inquiry" | "contact_message" | "newsletter_signup";
  readonly subject: string;
  readonly summary: string;
  /** Reference to the stored row, so the shop can look up the details. */
  readonly recordId: string;
}

export interface NotificationSink {
  readonly name: string;
  send(notification: Notification): Promise<void>;
}

/**
 * Never puts the phone number or email in the log line: the stored record is
 * the place to read those, behind whatever access control the shop applies.
 */
const logSink: NotificationSink = {
  name: "log",
  async send(notification) {
     
    console.info(
      JSON.stringify({
        level: "info",
        msg: "notification",
        kind: notification.kind,
        subject: notification.subject,
        recordId: notification.recordId,
        note: "Няма конфигуриран доставчик за известия; записът е запазен в базата данни.",
      }),
    );
  },
};

let sink: NotificationSink = logSink;

export function setNotificationSink(next: NotificationSink): void {
  sink = next;
}

export function getNotificationSinkName(): string {
  return sink.name;
}

/**
 * Notify, never throw.
 *
 * The caller has already persisted the record, so a delivery failure must not
 * turn a successful order into an error message for the customer.
 */
export async function notify(notification: Notification): Promise<{ delivered: boolean }> {
  try {
    await sink.send(notification);
    return { delivered: true };
  } catch (error) {
     
    console.error(
      JSON.stringify({
        level: "error",
        msg: "notification.failed",
        kind: notification.kind,
        recordId: notification.recordId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { delivered: false };
  }
}
