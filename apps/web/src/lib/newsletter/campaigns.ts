import "server-only";
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  newsletterCampaigns,
  newsletterDeliveries,
  newsletterSubscribers,
  type NewsletterAttachment,
  type NewsletterDeliveryStatus,
} from "@catalog/db/schema";
import { db } from "@/lib/db";
import { campaignSnapshot, withSnapshot, type ProductBlocksSnapshot } from "./product-blocks";

/**
 * The newsletter's rows: drafts, campaigns, their recipients, and the
 * subscriber list as the panel pages through it.
 *
 * Reads and the few writes that are not sending. Sending itself — claiming
 * recipients, recording what Resend answered — is `send.ts`, which is the only
 * code that moves a delivery out of `pending`.
 *
 * Everything takes an id it has not checked, from a URL or a form, so ids are
 * matched against the uuid shape before a query is built with one: Postgres
 * answers a malformed uuid with an error, not with "no such row".
 */

export type CampaignRow = typeof newsletterCampaigns.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

/**
 * How long a `sending` campaign may go without a heartbeat before the panel
 * treats its sender as gone and offers to resume. The sender writes one after
 * every request, and the slowest request it makes — five attempts with
 * backoff — is well under this.
 */
export const STALE_SENDING_MS = 10 * 60 * 1000;

export function isStale(
  campaign: Pick<CampaignRow, "status" | "updatedAt">,
  now = new Date(),
): boolean {
  return (
    campaign.status === "sending" && now.getTime() - campaign.updatedAt.getTime() > STALE_SENDING_MS
  );
}

/**
 * A campaign the panel can pick up again: stopped with somebody still
 * waiting, or orphaned — a `sending` campaign whose sender is gone, even with
 * nobody left waiting (the run died between its last request and writing the
 * end), because only a run can write that end.
 */
export function isResumable(
  campaign: Pick<CampaignRow, "status" | "updatedAt">,
  waiting: number,
  now = new Date(),
): boolean {
  return (campaign.status === "partial" && waiting > 0) || isStale(campaign, now);
}

/**
 * A draft's version: its `revision`, the count of its saves.
 *
 * The composer is drawn with it and sends it back with every press, so a save
 * or a send from a tab that has not seen the latest save is refused instead of
 * quietly replacing (or sending) what another tab wrote.
 */
export const draftVersion = (campaign: Pick<CampaignRow, "revision">): string =>
  String(campaign.revision);

const atRevision = (revision: number) => eq(newsletterCampaigns.revision, revision);

/* -- drafts ----------------------------------------------------------------- */

export async function createDraft(): Promise<string> {
  const [row] = await db
    .insert(newsletterCampaigns)
    .values({})
    .returning({ id: newsletterCampaigns.id });
  return row!.id;
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(newsletterCampaigns)
    .where(eq(newsletterCampaigns.id, id))
    .limit(1);
  return row ?? null;
}

export async function listCampaigns(limit = 50): Promise<CampaignRow[]> {
  return db
    .select()
    .from(newsletterCampaigns)
    .orderBy(desc(newsletterCampaigns.createdAt))
    .limit(limit);
}

export type SaveOutcome =
  | { ok: true; version: string }
  /** Sending has started (or the draft is gone): the message can no longer change. */
  | { ok: false; reason: "not_draft" }
  /** Another tab saved since this one was drawn. */
  | { ok: false; reason: "conflict" };

/**
 * Write the composer's fields to a draft, and only to a draft: once sending
 * has started, the message is what was sent, and editing it would make the
 * record a lie (and a resumed send a different letter).
 *
 * With `expected`, only if the draft is still at that version; the new
 * version is returned for the next press.
 */
export async function saveDraft(
  id: string,
  draft: { subject: string; preheader: string; body: string; attachments: NewsletterAttachment[] },
  expected?: number,
): Promise<SaveOutcome> {
  if (!isUuid(id)) return { ok: false, reason: "not_draft" };
  const [changed] = await db
    .update(newsletterCampaigns)
    .set({
      ...draft,
      revision: sql`${newsletterCampaigns.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(newsletterCampaigns.id, id),
        eq(newsletterCampaigns.status, "draft"),
        expected === undefined ? undefined : atRevision(expected),
      ),
    )
    .returning({ revision: newsletterCampaigns.revision });
  if (changed) return { ok: true, version: String(changed.revision) };
  const current = await getCampaign(id);
  return current?.status === "draft"
    ? { ok: false, reason: "conflict" }
    : { ok: false, reason: "not_draft" };
}

/** Drafts only. A campaign that went out is the record of what was sent. */
export async function deleteDraft(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db
    .delete(newsletterCampaigns)
    .where(and(eq(newsletterCampaigns.id, id), eq(newsletterCampaigns.status, "draft")))
    .returning({ id: newsletterCampaigns.id });
  return deleted.length > 0;
}

/* -- starting and resuming -------------------------------------------------- */

const active = isNull(newsletterSubscribers.unsubscribedAt);

export async function countActiveSubscribers(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(newsletterSubscribers).where(active);
  return row?.n ?? 0;
}

export type StartOutcome =
  | { ok: true; recipients: number }
  | { ok: false; reason: "not_draft" }
  /** The draft changed after the version that was confirmed. */
  | { ok: false; reason: "changed" }
  | { ok: false; reason: "no_subscribers" }
  /** The list changed between the confirmation and the press. */
  | { ok: false; reason: "count_changed"; recipients: number };

/**
 * Fix the recipients and mark the campaign as sending — in one transaction,
 * so a campaign is never `sending` without its list or the other way round.
 *
 * The recipients are the active subscribers at this moment, copied into
 * `newsletter_deliveries`. Somebody who subscribes a minute later is not on
 * this campaign; somebody who unsubscribes before their turn is skipped by the
 * sender. The number the owner confirmed must still be the number: if the list
 * moved in between, nothing starts and the screen asks again.
 *
 * Only a draft starts, by the `status = 'draft'` condition on the update — two
 * presses of the button cannot start two sends — and only the version that
 * was confirmed (`version`): a save from another tab in between changes the
 * letter, and that letter has not been confirmed by anybody.
 *
 * `products` is what the letter's product blocks resolved to a moment ago,
 * from that same version's body; it is stored with the campaign in the same
 * transaction, and every request of the send draws from it
 * (`ensureProductSnapshot`).
 */
export async function startCampaign(
  id: string,
  confirmed: number,
  version?: number,
  products?: ProductBlocksSnapshot,
): Promise<StartOutcome> {
  if (!isUuid(id)) return { ok: false, reason: "not_draft" };
  try {
    return await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(newsletterCampaigns)
        .set({ status: "sending", startedAt: new Date(), updatedAt: new Date(), lastError: null })
        .where(
          and(
            eq(newsletterCampaigns.id, id),
            eq(newsletterCampaigns.status, "draft"),
            version === undefined ? undefined : atRevision(version),
          ),
        )
        .returning({ id: newsletterCampaigns.id, attachments: newsletterCampaigns.attachments });
      if (!claimed) {
        const [current] = await tx
          .select({ status: newsletterCampaigns.status })
          .from(newsletterCampaigns)
          .where(eq(newsletterCampaigns.id, id));
        throw new StartRefused({
          ok: false,
          reason: current?.status === "draft" ? "changed" : "not_draft",
        });
      }

      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(newsletterSubscribers)
        .where(active);
      // Thrown, not returned: the throw is what rolls the status back to draft.
      if (n === 0) throw new StartRefused({ ok: false, reason: "no_subscribers" });
      if (n !== confirmed) {
        throw new StartRefused({ ok: false, reason: "count_changed", recipients: n });
      }

      const inserted = await tx.execute<{ id: string }>(sql`
        insert into ${newsletterDeliveries} (campaign_id, subscriber_id, email)
        select ${id}::uuid, s.id, s.email
        from ${newsletterSubscribers} s
        where s.unsubscribed_at is null
        on conflict (campaign_id, subscriber_id) do nothing
        returning id
      `);
      const recipients = Array.from(inserted).length;
      await tx
        .update(newsletterCampaigns)
        .set({
          recipientCount: recipients,
          ...(products ? { attachments: withSnapshot(claimed.attachments, products) } : {}),
        })
        .where(eq(newsletterCampaigns.id, id));
      return { ok: true, recipients } as const;
    });
  } catch (error) {
    if (error instanceof StartRefused) return error.outcome;
    throw error;
  }
}

class StartRefused extends Error {
  constructor(readonly outcome: Exclude<StartOutcome, { ok: true }>) {
    super(outcome.reason);
  }
}

const SNAPSHOT_ENTRY = sql`'[{"kind":"product-blocks"}]'::jsonb`;

/**
 * The products every copy of this campaign draws: the snapshot its start
 * stored. A send that started without one — begun before snapshots existed,
 * or by a caller that passed none — takes it now, at its first run, and stores
 * it only if there is still none, so of two runs the first snapshot written
 * is the one both draw, and every later request and resume draws it too.
 *
 * An entry that is there but does not read as a snapshot (a row edited by
 * hand) draws no products, consistently, rather than being taken again.
 */
export async function ensureProductSnapshot(
  campaign: CampaignRow,
  resolve: (letter: { subject: string; body: string }) => Promise<ProductBlocksSnapshot>,
): Promise<ProductBlocksSnapshot | null> {
  if (campaign.attachments.some((entry) => entry.kind === "product-blocks")) {
    return campaignSnapshot(campaign.attachments);
  }
  const snapshot = await resolve(campaign);
  const [stored] = await db
    .update(newsletterCampaigns)
    .set({ attachments: withSnapshot(campaign.attachments, snapshot) })
    .where(
      and(
        eq(newsletterCampaigns.id, campaign.id),
        sql`not (${newsletterCampaigns.attachments} @> ${SNAPSHOT_ENTRY})`,
      ),
    )
    .returning({ attachments: newsletterCampaigns.attachments });
  if (stored) return campaignSnapshot(stored.attachments);
  const current = await getCampaign(campaign.id);
  return current ? campaignSnapshot(current.attachments) : null;
}

/**
 * Take a stopped or orphaned campaign back to `sending`, for one sender.
 *
 * The condition is the lock: of two presses, or a press and a sender that was
 * merely slow, only one update matches, and only its caller starts a run.
 */
export async function claimResume(id: string, now = new Date()): Promise<boolean> {
  if (!isUuid(id)) return false;
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS);
  const claimed = await db
    .update(newsletterCampaigns)
    .set({ status: "sending", updatedAt: now, lastError: null })
    .where(
      and(
        eq(newsletterCampaigns.id, id),
        or(
          eq(newsletterCampaigns.status, "partial"),
          and(
            eq(newsletterCampaigns.status, "sending"),
            lt(newsletterCampaigns.updatedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning({ id: newsletterCampaigns.id });
  return claimed.length > 0;
}

/* -- the record of a send --------------------------------------------------- */

export type DeliveryCounts = Record<NewsletterDeliveryStatus, number> & { total: number };

export async function deliveryCounts(campaignId: string): Promise<DeliveryCounts> {
  const counts: DeliveryCounts = {
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    bounced: 0,
    complained: 0,
    total: 0,
  };
  if (!isUuid(campaignId)) return counts;
  const rows = await db
    .select({ status: newsletterDeliveries.status, n: count() })
    .from(newsletterDeliveries)
    .where(eq(newsletterDeliveries.campaignId, campaignId))
    .groupBy(newsletterDeliveries.status);
  for (const row of rows) {
    counts[row.status] = row.n;
    counts.total += row.n;
  }
  return counts;
}

export interface DeliveryRow {
  id: string;
  email: string;
  status: NewsletterDeliveryStatus;
  error: string | null;
  sentAt: Date | null;
}

/** Problems first — the rows the owner opens this page to find — then the rest. */
export async function listDeliveries(
  campaignId: string,
  {
    page,
    pageSize,
    statuses,
  }: { page: number; pageSize: number; statuses?: NewsletterDeliveryStatus[] },
): Promise<{ rows: DeliveryRow[]; total: number }> {
  if (!isUuid(campaignId)) return { rows: [], total: 0 };
  const where = and(
    eq(newsletterDeliveries.campaignId, campaignId),
    statuses && statuses.length > 0 ? inArray(newsletterDeliveries.status, statuses) : undefined,
  );
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(newsletterDeliveries)
    .where(where);
  const rows = await db
    .select({
      id: newsletterDeliveries.id,
      email: newsletterDeliveries.email,
      status: newsletterDeliveries.status,
      error: newsletterDeliveries.error,
      sentAt: newsletterDeliveries.sentAt,
    })
    .from(newsletterDeliveries)
    .where(where)
    .orderBy(
      sql`case ${newsletterDeliveries.status} when 'failed' then 0 when 'bounced' then 1 when 'complained' then 1 when 'sending' then 2 when 'pending' then 3 when 'skipped' then 4 else 5 end`,
      newsletterDeliveries.email,
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { rows, total: n };
}

/* -- the list --------------------------------------------------------------- */

export interface SubscriberListRow {
  id: string;
  email: string;
  consentAt: Date;
  consentSource: string | null;
  unsubscribedAt: Date | null;
}

export async function subscriberCounts(): Promise<{ active: number; unsubscribed: number }> {
  const rows = await db
    .select({ left: sql<boolean>`${newsletterSubscribers.unsubscribedAt} is not null`, n: count() })
    .from(newsletterSubscribers)
    .groupBy(sql`${newsletterSubscribers.unsubscribedAt} is not null`);
  return {
    active: rows.find((row) => !row.left)?.n ?? 0,
    unsubscribed: rows.find((row) => row.left)?.n ?? 0,
  };
}

/**
 * One page of the list, newest consent first. Paged rather than capped: the
 * panel's other lists stop at 200, and a list somebody exports and sends to is
 * the one place a silent cap would be a wrong answer.
 */
export async function listSubscribersPage({
  page,
  pageSize,
  includeUnsubscribed,
}: {
  page: number;
  pageSize: number;
  includeUnsubscribed: boolean;
}): Promise<SubscriberListRow[]> {
  return db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      consentAt: newsletterSubscribers.consentAt,
      consentSource: newsletterSubscribers.consentSource,
      unsubscribedAt: newsletterSubscribers.unsubscribedAt,
    })
    .from(newsletterSubscribers)
    .where(includeUnsubscribed ? undefined : active)
    .orderBy(desc(newsletterSubscribers.consentAt), newsletterSubscribers.id)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/** The whole list for the CSV, consent and all; the active part unless asked. */
export async function allSubscribers(includeUnsubscribed: boolean): Promise<SubscriberListRow[]> {
  return db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      consentAt: newsletterSubscribers.consentAt,
      consentSource: newsletterSubscribers.consentSource,
      unsubscribedAt: newsletterSubscribers.unsubscribedAt,
    })
    .from(newsletterSubscribers)
    .where(includeUnsubscribed ? undefined : active)
    .orderBy(desc(newsletterSubscribers.consentAt), newsletterSubscribers.id);
}
