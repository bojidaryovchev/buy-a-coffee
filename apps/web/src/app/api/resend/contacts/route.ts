import { handleContactEvent } from "@/lib/newsletter/webhook";

/**
 * Resend's contact and delivery webhook: unsubscribes made in Resend, back
 * into our list — an opt-out of this site's topic, "unsubscribe from
 * everything", a deleted contact — and permanent bounces and complaints of our
 * newsletter's copies. See `lib/newsletter/webhook.ts` for which events count
 * and why.
 *
 * Register https://buy-a-coffee.com/api/resend/contacts in the Resend dashboard
 * under Webhooks, subscribed to `contact.updated`, `contact.topics.updated`,
 * `contact.deleted`, `email.bounced` and `email.complained`, and put the
 * signing secret it hands back into RESEND_CONTACTS_WEBHOOK_SECRET. Its own
 * endpoint and its own secret rather than a second event type on /api/inbound:
 * the two can then be rotated, paused and replayed independently, and a failure
 * in one never shows up as retries of the other.
 *
 * The status codes follow /api/inbound and are just as load-bearing: Resend
 * retries on 5xx and gives up on 2xx, so "understood, nothing to do" has to be
 * a 200 or it comes back every few minutes for days.
 */
export async function POST(request: Request) {
  /* Raw text, not request.json(). The signature covers the exact bytes. */
  const payload = await request.text();

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");

  if (!id || !timestamp || !signature) {
    return new Response("Missing signature headers", { status: 400 });
  }

  const result = await handleContactEvent(payload, { id, timestamp, signature });

  switch (result.status) {
    case "unsubscribed":
      return Response.json({ unsubscribed: result.event, reason: result.reason });
    case "ignored":
      return Response.json({ ignored: result.reason });
    case "unauthorized":
      return new Response("Invalid signature", { status: 401 });
    case "failed":
      console.error(
        JSON.stringify({ level: "error", msg: "newsletter.webhook_failed", error: result.error }),
      );
      return new Response(result.error, { status: 500 });
  }
}
