import "server-only";
import { Resend } from "resend";
import { findSubscriberByEmail, unsubscribeByEmail } from "@/lib/forms/unsubscribe";

/**
 * Resend's contact events, back into our list.
 *
 * The other half of `sync.ts`. Every broadcast carries Resend's own unsubscribe
 * link, and using it changes the contact in Resend — not the row here. Without
 * this the admin panel would go on showing as active someone who left, and the
 * operator's "add to newsletter" would tell them the address is still on the
 * list.
 *
 * ONE ACCOUNT, FOUR SITES (see `sync.ts`), which decides what counts as leaving
 * THIS list:
 *
 *   - this site's topic switched to `opt_out` — the person left our newsletter
 *     from Resend's preference page, or the owner did it in the dashboard;
 *   - `unsubscribed: true` on the contact — "unsubscribe from everything",
 *     which silences every broadcast on the account, ours included;
 *   - `contact.deleted` — nothing will reach the address any more, whatever
 *     this table says.
 *
 * Each of those stamps `unsubscribed_at`; the row is never deleted. Anything
 * else is ignored — in particular a topic switched back to `opt_in`, because
 * the only way onto this list is a consent recorded HERE, and a contact turned
 * back on in a dashboard has not told us how they agreed.
 *
 * `CONTACT.UPDATED` CARRIES NO TOPICS (`contact.topics.updated` does, and is
 * read as it arrives). `contact.updated` says what the contact's
 * account-wide flag is and nothing about its topic subscriptions, so when the
 * flag alone does not settle it, the contact's topics are fetched before
 * deciding. Before that, the address is looked up here: webhooks are
 * account-wide too, so most contact events belong to the other three sites'
 * lists, and none of them is worth an API call.
 *
 * Its own secret, RESEND_CONTACTS_WEBHOOK_SECRET, and not RESEND_WEBHOOK_SECRET:
 * that one belongs to the inbound-mail endpoint, and the two are rotated,
 * paused and replayed independently.
 */

type UnsubscribeReason = "topic_opt_out" | "global_unsubscribe" | "deleted";

export type ContactEventResult =
  /** The row was stamped. `reason` says which of the three it was. */
  | { status: "unsubscribed"; event: string; reason: UnsubscribeReason }
  /** Understood and nothing to do. Still a 200: a retry would do the same. */
  | { status: "ignored"; reason: string }
  | { status: "unauthorized" }
  /** Our side broke, or Resend's API did. A 500, so Resend retries rather than
   *  dropping the unsubscribe — the one event here that must not be lost. */
  | { status: "failed"; error: string };

/** This site's topic subscription for an address, as Resend has it now. */
async function topicSubscription(
  resend: Resend,
  email: string,
  topicId: string,
): Promise<{ ok: true; subscription: "opt_in" | "opt_out" | null } | { ok: false; error: string }> {
  const { data, error } = await resend.contacts.topics.list({ email, limit: 100 });
  if (error) return { ok: false, error: error.message };
  // Null when the contact has no recorded choice on our topic at all — which
  // is not an opt-out, and is left alone.
  const ours = data?.data.find((topic) => topic.id === topicId);
  return { ok: true, subscription: ours?.subscription ?? null };
}

function describe(what: string, error: unknown): string {
  return `${what}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function handleContactEvent(
  /** The raw body, byte for byte — the signature covers the exact bytes. */
  payload: string,
  headers: { id: string; timestamp: string; signature: string },
): Promise<ContactEventResult> {
  const secret = process.env.RESEND_CONTACTS_WEBHOOK_SECRET;
  if (!secret) {
    // A 500, not a 200. Resend keeps retrying for a while, so setting the
    // variable within that window still delivers the unsubscribes that arrived
    // before it — answering 200 here would have thrown them away.
    return { status: "failed", error: "RESEND_CONTACTS_WEBHOOK_SECRET is not set" };
  }

  // Verification is local cryptography and needs no key; the topic lookup
  // below does, and checks for it itself. The placeholder only satisfies the
  // SDK's constructor, which refuses to exist without one.
  const resend = new Resend(process.env.RESEND_API_KEY || "re_verify_only");

  let event;
  try {
    event = resend.webhooks.verify({ payload, headers, webhookSecret: secret });
  } catch {
    return { status: "unauthorized" };
  }

  /*
   * `contact.topics.updated` is what Resend fires when a topic subscription
   * changes - including an opt-out on the preference page behind
   * {{{RESEND_UNSUBSCRIBE_URL}}}. The installed SDK's event union predates
   * topics, so the type is widened here; the payload is documented as
   * `data.email` plus the changed `data.topics` ({ id, subscription }), which
   * answers the question without a topic lookup.
   */
  const type = event.type as string;
  if (
    type !== "contact.updated" &&
    type !== "contact.deleted" &&
    type !== "contact.topics.updated"
  ) {
    return { status: "ignored", reason: type };
  }
  const data = event.data as {
    email?: string;
    unsubscribed?: boolean;
    topics?: { id: string; subscription: string }[];
  };

  const email = (data.email ?? "").trim().toLowerCase();
  if (!email) return { status: "ignored", reason: "event without an email" };

  let subscriber;
  try {
    subscriber = await findSubscriberByEmail(email);
  } catch (error) {
    return { status: "failed", error: describe("subscriber lookup", error) };
  }
  if (!subscriber) {
    // Another site's contact on the shared account, or one created by hand in
    // the dashboard. Not ours to record.
    return { status: "ignored", reason: "not on this list" };
  }
  if (subscriber.unsubscribedAt) {
    // Also the echo of our own opt-out, when Resend reports the change we made.
    return { status: "ignored", reason: "already unsubscribed" };
  }

  let reason: UnsubscribeReason;
  if (type === "contact.deleted") {
    reason = "deleted";
  } else if (type === "contact.topics.updated") {
    const topicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;
    const ours = topicId ? data.topics?.find((t) => t.id === topicId) : undefined;
    if (ours?.subscription !== "opt_out") {
      // Another site's topic, or ours switched on — our own signup sync
      // produces exactly that.
      return { status: "ignored", reason: "this site's topic was not opted out" };
    }
    reason = "topic_opt_out";
  } else if (data.unsubscribed) {
    reason = "global_unsubscribe";
  } else {
    const topicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;
    if (!topicId) {
      // No topic, so nothing of ours to read — and the account-wide flag,
      // which is false here, is the only other thing that could have meant
      // anything.
      return { status: "ignored", reason: "RESEND_NEWSLETTER_TOPIC_ID is not set" };
    }
    if (!process.env.RESEND_API_KEY) {
      // A 500: the topic exists and cannot be checked. Retried, the event
      // lands once the key is back; ignored, a real opt-out would be lost.
      return { status: "failed", error: "RESEND_API_KEY is not set" };
    }

    const topic = await topicSubscription(resend, email, topicId);
    if (!topic.ok) return { status: "failed", error: `contact topics: ${topic.error}` };
    if (topic.subscription !== "opt_out") {
      // Our own signup sync produces exactly this event, with `opt_in`.
      return { status: "ignored", reason: "still opted in to this site's topic" };
    }
    reason = "topic_opt_out";
  }

  /*
   * When it happened, for the stale check in `unsubscribeByEmail`.
   *
   * The event's own `created_at` rather than the time it reached us: a retry
   * carries the original payload, so an unsubscribe retried an hour later still
   * reads as an hour old — and loses to a signup made in between, which is the
   * person's latest word. That holds for the fetched topic state too: it may
   * still read `opt_out` because the re-subscription's own sync has not landed
   * yet, and the event's age is what keeps that from undoing the signup.
   */
  const at = new Date(event.created_at);
  const when = Number.isNaN(at.getTime()) ? new Date() : at;

  try {
    switch (await unsubscribeByEmail(email, when)) {
      case "unsubscribed":
        return { status: "unsubscribed", event: type, reason };
      case "already_unsubscribed":
        return { status: "ignored", reason: "already unsubscribed" };
      case "not_found":
        return { status: "ignored", reason: "not on this list" };
      case "stale":
        return { status: "ignored", reason: "older than the latest signup" };
    }
  } catch (error) {
    return { status: "failed", error: describe("recording the unsubscribe", error) };
  }
}
