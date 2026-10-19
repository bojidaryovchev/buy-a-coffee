import "server-only";
import { after } from "next/server";
import type { Resend } from "resend";
import { unsubscribeUrl } from "./links";

/**
 * The newsletter list, mirrored into Resend.
 *
 * The newsletter is written and sent from the admin panel (`send.ts`) to this
 * table's list, and the send does not ask Resend who is subscribed: our table
 * is the source of truth. Resend keeps a copy anyway, because its own pages
 * act on it — the preference page behind its unsubscribe links, and the
 * "unsubscribe from everything" a reader of another site's mail may use — and
 * what a reader does there comes back through the webhook in `webhook.ts`.
 * This module keeps the copy in step in the other direction: a subscription
 * here becomes a contact there, opted in to this site's topic; an unsubscribe
 * here opts it out of that topic.
 *
 * ONE RESEND ACCOUNT, FOUR SITES. buy-a-coffee, buy-a-vend, rent-a-vend and
 * sell-a-vend share an account and therefore share contacts: an address on two
 * of the lists is ONE contact. The contact's own `unsubscribed` flag is
 * account-wide — it silences every broadcast from every site — so this module
 * never writes it, in either direction. What belongs to this site is:
 *
 *   - a TOPIC (RESEND_NEWSLETTER_TOPIC_ID), which carries this site's opt-in
 *     and opt-out, and which the sync needs: without it an opt-out could only
 *     be written account-wide;
 *   - a SEGMENT (RESEND_NEWSLETTER_SEGMENT_ID), optional: a plain record in
 *     Resend of who ever joined, kept when it is configured. Membership is
 *     never removed on unsubscribe.
 *
 * NEVER BLOCKING. The table is the record and the contact is a copy of it, so
 * the copy is made in `after()`, once the visitor has their answer, and nothing
 * here throws: a Resend outage costs a log line and a contact that is mirrored
 * on the next signup by the same address — or by "Копирай списъка в Resend" in
 * the panel (`syncAllSubscribers`) — never a failed form. Without the key or
 * the topic it skips with a log line, which is the whole local-development
 * story.
 *
 * Log lines name the subscriber by id, never by address.
 */

/** What the sync needs to know about a row. */
export interface SyncSubscriber {
  readonly id: string;
  readonly email: string;
  /** For our own unsubscribe link; see `unsubscribe.ts`. */
  readonly unsubscribeToken: string;
}

export type SyncResult =
  | { status: "synced"; contactId: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

type ContactProperties = Record<string, string>;

/**
 * The contact properties this site writes, by name.
 *
 * PREFIXED, because properties are account-wide like the contact itself: an
 * address on two of the four lists is one contact with one set of properties,
 * and an unprefixed `unsubscribe_url` written by buy-a-vend would silently
 * replace ours, sending a coffee reader to the other site's page. `bac_` is
 * buy-a-coffee (`bav_` is buy-a-vend); each site writes only its own.
 *
 * Exported so the admin screen prints the merge tags from the same strings the
 * sync writes: a tag that drifted from the key would render as an empty link
 * in every inbox, and nobody would see it before a reader did.
 *
 * Resend's rules for a key are letters, digits and underscores, at most 50,
 * case-sensitive — which these satisfy and a hyphenated prefix would not.
 */
export const PROPERTY_PREFIX = "bac_";
export const PROPERTY_KEYS = {
  /** Our own page, which opts the reader out of this site's topic only. A
      second link, never a replacement for `{{{RESEND_UNSUBSCRIBE_URL}}}`. */
  unsubscribeUrl: `${PROPERTY_PREFIX}unsubscribe_url`,
} as const;

/* The subscriber's own unsubscribe link: the page plus the row's token. Built
   in `links.ts`, which the newsletter's own footer uses too; re-exported for
   the callers that always had it from here. */
export { unsubscribeUrl };

/**
 * What a broadcast can use about a contact.
 *
 * The key has to exist as a contact property in Resend first (Audience ->
 * Properties, type string): Resend refuses a create or update that names a
 * property it has not been told about. The sync then retries without it rather
 * than failing — see `syncSubscribed`.
 */
export function contactProperties(subscriber: SyncSubscriber): ContactProperties {
  return { [PROPERTY_KEYS.unsubscribeUrl]: unsubscribeUrl(subscriber.unsubscribeToken) };
}

/** What the admin screen reports, so a half-configured sync is visible there
 *  rather than only in the logs. */
export function newsletterSyncStatus() {
  return {
    apiKey: Boolean(process.env.RESEND_API_KEY),
    segment: Boolean(process.env.RESEND_NEWSLETTER_SEGMENT_ID),
    topic: Boolean(process.env.RESEND_NEWSLETTER_TOPIC_ID),
    webhook: Boolean(process.env.RESEND_CONTACTS_WEBHOOK_SECRET),
  };
}

export async function client(key: string): Promise<Resend> {
  // Dynamic, like the mailer: only the requests that use the SDK load it.
  const { Resend } = await import("resend");
  return new Resend(key);
}

type Upsert =
  | { ok: true; contactId: string | null; globallyUnsubscribed: boolean }
  | { ok: false; error: string };

/**
 * Create the contact in the segment and opted in to the topic, or bring an
 * existing one to the same state.
 *
 * Create first, because for an address no site has seen it is one call that
 * does everything. It fails for an address the account already knows — most
 * often someone already on another of the four lists — and then the existing
 * contact is updated in place: properties, segment, topic. Its account-wide
 * `unsubscribed` flag is read but never written (see the note at the top).
 *
 * `properties: undefined` is the retry without properties, which skips the
 * update call entirely: an update with nothing in it is not worth a request.
 */
async function upsertContact(
  resend: Resend,
  ids: { segmentId: string | null; topicId: string },
  email: string,
  properties: ContactProperties | undefined,
): Promise<Upsert> {
  const created = await resend.contacts.create({
    email,
    properties,
    ...(ids.segmentId ? { segments: [{ id: ids.segmentId }] } : {}),
    topics: [{ id: ids.topicId, subscription: "opt_in" }],
  });
  if (!created.error) {
    return { ok: true, contactId: created.data?.id ?? null, globallyUnsubscribed: false };
  }

  let contactId: string | null = null;
  if (properties) {
    const updated = await resend.contacts.update({ email, properties });
    if (updated.error) {
      return {
        ok: false,
        error: `create: ${created.error.message}; update: ${updated.error.message}`,
      };
    }
    contactId = updated.data?.id ?? null;
  }

  // Asked rather than assumed: adding a contact to a segment it is already in
  // is not something the SDK documents as harmless.
  if (ids.segmentId) {
    const membership = await resend.contacts.segments.list({ email, limit: 100 });
    if (membership.error) {
      return { ok: false, error: `segments: ${membership.error.message}` };
    }
    if (!membership.data?.data.some((segment) => segment.id === ids.segmentId)) {
      const added = await resend.contacts.segments.add({ email, segmentId: ids.segmentId });
      if (added.error) return { ok: false, error: `segment: ${added.error.message}` };
    }
  }

  const topic = await resend.contacts.topics.update({
    email,
    topics: [{ id: ids.topicId, subscription: "opt_in" }],
  });
  if (topic.error) return { ok: false, error: `topic: ${topic.error.message}` };

  // Read, never written. A contact that used "unsubscribe from everything" on
  // another site's mail stays silenced for ours too — their decision, and not
  // one a signup form on one of four sites gets to undo.
  const contact = await resend.contacts.get({ email });
  return {
    ok: true,
    contactId: contactId ?? topic.data?.id ?? contact.data?.id ?? null,
    globallyUnsubscribed: contact.data?.unsubscribed === true,
  };
}

/** The key and the topic a subscription needs (the segment is optional), or
    the reason it cannot happen. */
export function subscribeConfig():
  | { ok: true; key: string; segmentId: string | null; topicId: string }
  | { ok: false; reason: string } {
  const key = process.env.RESEND_API_KEY;
  const segmentId = process.env.RESEND_NEWSLETTER_SEGMENT_ID?.trim() || null;
  const topicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;
  if (!key || !topicId) {
    return { ok: false, reason: "RESEND_API_KEY or RESEND_NEWSLETTER_TOPIC_ID is not set" };
  }
  return { ok: true, key, segmentId, topicId };
}

/** The key and the topic an unsubscribe needs. Not the segment: it is left as it is. */
function unsubscribeConfig():
  { ok: true; key: string; topicId: string } | { ok: false; reason: string } {
  const key = process.env.RESEND_API_KEY;
  const topicId = process.env.RESEND_NEWSLETTER_TOPIC_ID;
  if (!key || !topicId) {
    return { ok: false, reason: "RESEND_API_KEY or RESEND_NEWSLETTER_TOPIC_ID is not set" };
  }
  return { ok: true, key, topicId };
}

/**
 * Mirror one subscription. `resend` may be supplied — the panel's bulk repair
 * passes one that paces its calls (`pacedClient`) — and is otherwise made here.
 */
export async function syncSubscribed(
  subscriber: SyncSubscriber,
  resend?: Resend,
): Promise<SyncResult> {
  const config = subscribeConfig();
  if (!config.ok) return { status: "skipped", reason: config.reason };

  resend ??= await client(config.key);

  /*
   * Once with the properties, and if that fails, once without.
   *
   * Resend refuses a property it has not been told about, and ours is created
   * by hand in the dashboard — so the likeliest reason for a failure on a
   * working key is that nobody has done that yet. Without it the contact still
   * gets the newsletter and Resend's own unsubscribe link; a missing column in
   * a dashboard is no reason to leave a subscriber out of the list.
   */
  let result = await upsertContact(resend, config, subscriber.email, contactProperties(subscriber));
  if (!result.ok) {
    const first = result.error;
    result = await upsertContact(resend, config, subscriber.email, undefined);
    if (!result.ok) return { status: "failed", error: `${first} | ${result.error}` };
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "newsletter.sync_without_properties",
        subscriber: subscriber.id,
        note: `Create the contact property ${PROPERTY_KEYS.unsubscribeUrl} (type string) in Resend -> Audience -> Properties.`,
        error: first,
      }),
    );
  }

  if (result.globallyUnsubscribed) {
    // Not a failure: our row and the topic both say "subscribed". It is the one
    // state in which that is still not enough, and the owner should know why
    // this address will receive nothing.
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "newsletter.globally_unsubscribed",
        subscriber: subscriber.id,
        note: "Opted in to this site's topic, but unsubscribed from everything on the shared Resend account, so no broadcast reaches it.",
      }),
    );
  }

  return { status: "synced", contactId: result.contactId };
}

/**
 * Opt the contact out of this site's topic — and out of nothing else.
 *
 * Never `unsubscribed: true`: that would stop buy-a-vend's, rent-a-vend's and
 * sell-a-vend's mail to the same person, who asked to leave only this list.
 */
export async function syncUnsubscribed(
  subscriber: Pick<SyncSubscriber, "id" | "email">,
): Promise<SyncResult> {
  const config = unsubscribeConfig();
  if (!config.ok) return { status: "skipped", reason: config.reason };

  const resend = await client(config.key);
  const updated = await resend.contacts.topics.update({
    email: subscriber.email,
    topics: [{ id: config.topicId, subscription: "opt_out" }],
  });
  if (updated.error) return { status: "failed", error: updated.error.message };
  return { status: "synced", contactId: updated.data?.id ?? null };
}

/* -- the entry points callers use ------------------------------------------ */

function report(result: SyncResult, action: "subscribe" | "unsubscribe", id: string): void {
  if (result.status === "skipped") {
    console.info(
      JSON.stringify({
        level: "info",
        msg: "newsletter.sync_skipped",
        action,
        subscriber: id,
        reason: result.reason,
      }),
    );
  } else if (result.status === "failed") {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "newsletter.sync_failed",
        action,
        subscriber: id,
        error: result.error,
      }),
    );
  }
}

/** Mirror a subscription. Never throws. */
export async function pushSubscribed(subscriber: SyncSubscriber): Promise<void> {
  try {
    report(await syncSubscribed(subscriber), "subscribe", subscriber.id);
  } catch (error) {
    report({ status: "failed", error: String(error) }, "subscribe", subscriber.id);
  }
}

/** Mirror an unsubscribe. Never throws. */
export async function pushUnsubscribed(
  subscriber: Pick<SyncSubscriber, "id" | "email">,
): Promise<void> {
  try {
    report(await syncUnsubscribed(subscriber), "unsubscribe", subscriber.id);
  } catch (error) {
    report({ status: "failed", error: String(error) }, "unsubscribe", subscriber.id);
  }
}

/**
 * Run a sync once the response has been sent.
 *
 * Outside a request — a script, a test calling an action directly — `after()`
 * has no response to wait for and throws. That is logged and the sync is
 * dropped: it is a copy, and whatever wrote the row has already succeeded.
 */
function later(action: "subscribe" | "unsubscribe", id: string, task: () => Promise<void>): void {
  try {
    after(task);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "newsletter.sync_not_scheduled",
        action,
        subscriber: id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Called by every path that writes a subscription, once the row is written.
 *
 * The configuration is checked here as well as in `syncSubscribed`, so that an
 * unconfigured deployment logs its skip at once and schedules nothing.
 */
export function syncSubscribedLater(subscriber: SyncSubscriber): void {
  const config = subscribeConfig();
  if (!config.ok) {
    report({ status: "skipped", reason: config.reason }, "subscribe", subscriber.id);
    return;
  }
  later("subscribe", subscriber.id, () => pushSubscribed(subscriber));
}

/** Called by every path that writes an unsubscribe, once the row is stamped. */
export function syncUnsubscribedLater(subscriber: Pick<SyncSubscriber, "id" | "email">): void {
  const config = unsubscribeConfig();
  if (!config.ok) {
    report({ status: "skipped", reason: config.reason }, "unsubscribe", subscriber.id);
    return;
  }
  later("unsubscribe", subscriber.id, () => pushUnsubscribed(subscriber));
}

/**
 * A client whose contact calls are spaced at least `gapMs` apart.
 *
 * For the panel's bulk repair, which syncs every subscriber in one go: one
 * subscription can take six calls, and the Resend account is shared with three
 * other sites whose order mail must not meet a rate limit this caused. The
 * signup path does not need it — it syncs one subscriber, after the response.
 */
export async function pacedClient(
  key: string,
  gapMs: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<Resend> {
  const resend = await client(key);
  let next = 0;
  const wait = async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gapMs;
    if (at > now) await sleep(at - now);
  };
  const pace = <T extends object>(target: T, names: readonly (keyof T)[]) => {
    for (const name of names) {
      const original = target[name];
      if (typeof original !== "function") continue;
      const bound = (original as (...args: unknown[]) => unknown).bind(target);
      (target as Record<keyof T, unknown>)[name] = async (...args: unknown[]) => {
        await wait();
        return bound(...args);
      };
    }
  };
  pace(resend.contacts, ["create", "update", "get"]);
  pace(resend.contacts.segments, ["list", "add"]);
  pace(resend.contacts.topics, ["update"]);
  return resend;
}
