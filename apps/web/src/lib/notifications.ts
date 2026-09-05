import "server-only";

/**
 * Notification abstraction.
 *
 * An enquiry is persisted first and notified second, always. If the email
 * provider is down, misconfigured, or simply not set up yet, the order is
 * still safely in the database — losing a customer's order because an SMTP
 * host was unreachable would be the worst possible failure here.
 *
 * The provider is chosen by configuration, not by a wiring call. With
 * `RESEND_API_KEY` and `MAIL_TO` both set, notifications are emailed and carry
 * a link into the admin panel; with either missing, the default sink logs a
 * redacted line so the shop can at least see that something arrived.
 *
 * Neither sink puts the customer's phone number or email in its output. The
 * stored record is the place to read those, behind the panel's password — see
 * `mail/notify-sink.ts`.
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

/**
 * The chosen sink, resolved on first use.
 *
 * It used to be `let sink = logSink`, with a `setNotificationSink` the README
 * told you to call "once at start-up". Nothing ever called it, and there is no
 * start-up here to call it from: on a serverless host every cold start is a new
 * process, so "once" has to mean once per invocation, which is what a lazy
 * resolve does.
 *
 * Deciding by configuration rather than by a call also removes the failure this
 * arrangement invites — an application that ships with a hook nobody remembers
 * to pull, and reports "notification" to a log while the shop waits for an
 * order that arrived three days ago.
 *
 * The import is dynamic because the Resend sink is `server-only` and pulls the
 * SDK in with it; nothing should pay for that until a notification is actually
 * being sent.
 */
let override: NotificationSink | null = null;
let resolved: NotificationSink | null = null;

async function currentSink(): Promise<NotificationSink> {
  if (override) return override;
  if (resolved) return resolved;

  const { canSendNotifications, resendSink } = await import("./mail/notify-sink");
  resolved = canSendNotifications() ? resendSink : logSink;
  return resolved;
}

/** Escape hatch for tests and for a shop that wires its own provider. Wins over
 *  the configured choice for the life of the process. */
export function setNotificationSink(next: NotificationSink): void {
  override = next;
}

export async function getNotificationSinkName(): Promise<string> {
  return (await currentSink()).name;
}

/**
 * Notify, never throw.
 *
 * The caller has already persisted the record, so a delivery failure must not
 * turn a successful order into an error message for the customer.
 */
export async function notify(notification: Notification): Promise<{ delivered: boolean }> {
  try {
    await (await currentSink()).send(notification);
    return { delivered: true };
  } catch (error) {
    /* The record is safe; only the notification is lost. Logged with the id so
       it can be found in the panel, which is the recovery path this failure
       now has and did not before. */
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
