import "server-only";
import { and, asc, count, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  newsletterCampaigns,
  newsletterDeliveries,
  newsletterSubscribers,
  type NewsletterDeliveryStatus,
} from "@catalog/db/schema";
import { db } from "@/lib/db";
import { isPlausibleToken } from "@/lib/forms/unsubscribe-token";
import { MAIL_FROM } from "@/lib/mail/identity";
import {
  BATCH_SIZE,
  REQUEST_TIMEOUT_MS,
  batchKey,
  composeCampaign,
  personalise,
  sendWithRetry,
  singleKey,
  type BatchClient,
  type BatchEmail,
  type CampaignTemplate,
} from "./batch";
import { STALE_SENDING_MS, ensureProductSnapshot, getCampaign } from "./campaigns";
import { blockProblems, campaignFiles, describeBlockProblems } from "./product-blocks";
import { resolveLetterProducts } from "./product-source";
import { claimNotes } from "./claims";
import { letterPromotions } from "./claims-data";
import { runStopEntry, type RunStopCause } from "./run-stop";
import { lettersPhrase } from "./status";

/**
 * Sending a campaign: the recipients fixed by `startCampaign`, in requests of
 * up to a hundred, until every one has an answer or the run has to stop.
 *
 * NEVER TWICE. Every rule below serves that one:
 *
 *   - A delivery gets the key of the request that will carry it BEFORE that
 *     request goes out: `pending` → `sending`, in a transaction with
 *     `FOR UPDATE SKIP LOCKED`, so two runs cannot claim the same person.
 *   - Its answer is recorded in one statement for the whole request. A run
 *     that dies between the two leaves the deliveries `sending` with their key.
 *   - The next run sends those again, as the same group under the same key,
 *     and Resend, which remembers a key for 24 hours, answers with the ids it
 *     already gave instead of sending. Past 23 hours that memory cannot be
 *     relied on, so such a delivery is marked failed — "may have arrived" —
 *     and is never sent. The clock starts at `attemptedAt`, the first time a
 *     request under the current key actually went out.
 *   - Once any attempt at a request may have been processed (no answer, a
 *     5xx, "still in flight"), its copies are never released or split: they
 *     wait, keyed, for a later run (`maybeSent` in `batch.ts`).
 *   - A request Resend refused with a 4xx sent nothing. One bad address
 *     refuses all hundred, so the request is split: every copy gets its own
 *     key in ONE update before any of them is sent, and then they go one at a
 *     time. A split cut short leaves the rest keyed and never attempted, and
 *     the next run sends them under those keys; nothing that was never tried
 *     is ever marked failed. Three identical refusals in a row mean the
 *     problem is a setting, not the addresses: the run stops and the rest go
 *     back to the queue.
 *   - A resent request refused for being over a rate limit, or for the
 *     account, proves nothing about its earlier attempt — those checks come
 *     before Resend looks at the key — so it, too, waits.
 *
 * The list is ours, not Resend's: who is sent to is decided here, from our
 * table, and somebody who unsubscribed after the snapshot is skipped at their
 * turn.
 *
 * ONE LETTER. The message is rendered once per run, with a placeholder for
 * each reader's unsubscribe token (`composeCampaign`), from the campaign's
 * stored product snapshot (`ensureProductSnapshot`) and never from the catalog
 * as it is now: a resume draws the same products at the same prices as the
 * first request did.
 *
 * TIME. The run is started in `after()` by the action that started or resumed
 * the campaign, so it has that function's lifetime (`maxDuration`, 300 s, on
 * the campaign page). No request starts after `budgetMs` (200 s), each
 * attempt is aborted after 20 s, and no retry waits past the budget: the run
 * ends with a minute and more to spare, marks the campaign `partial`, and the
 * panel offers to continue. Between requests it pauses, because the Resend
 * account is shared with three other sites and their order mail must not meet
 * a rate limit we caused.
 *
 * WHY IT STOPPED. A run that stops says why twice: in words for the owner
 * (`last_error`), and as a cause the daily job reads (`run-stop.ts`) — which
 * picks up only a stop another run can get past, and leaves the rest to the
 * owner's "Продължи" or "Спри изпращането" (`stopRun`).
 */

/** Past this a request's key may be forgotten by Resend (it keeps them 24 h). */
const KEY_MEMORY_MS = 23 * 60 * 60 * 1000;

/** Between requests: Resend's default rate limit is a few requests a second. */
const REQUEST_SPACING_MS = 1_000;

/** No request starts this long after the run began. */
export const RUN_BUDGET_MS = 200_000;

/** Identical single-address refusals in a row that stop a split. */
export const IDENTICAL_REFUSALS_TO_HALT = 3;

/** The one real "may have arrived": a key older than Resend's memory of it. */
export const UNKNOWN_OUTCOME =
  "Не е ясно дали е изпратено: заявката остана без отговор повече от 23 часа. Не е изпратено повторно.";
const GONE_IN_FLIGHT =
  "Абонатът беше изтрит, докато писмото му се изпращаше. Може да го е получил; не е изпратено повторно.";
const LEFT_THE_LIST = "Отписа се, преди да дойде редът му.";
const NO_ROW = "Абонатът вече не е в списъка.";
const TIME_UP =
  "Изпращането спря, за да не надхвърли времето на една заявка. Натиснете „Продължи“.";

export interface RunOptions {
  client: BatchClient;
  from?: string;
  /** Start no request after this long. */
  budgetMs?: number;
  /** Abort each attempt after this long. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RunReport {
  status: "not_sending" | "done" | "stopped";
  requests: number;
  reason?: string;
}

interface Claimed {
  id: string;
  email: string;
  token: string;
}

/** What became of the copies in one request. */
type Result =
  | { kind: "sent" }
  | { kind: "refused"; message: string }
  /** Left `sending` with their key, for a later run. */
  | { kind: "held" }
  /** Back in the queue: nothing was sent. */
  | { kind: "released" }
  | { kind: "split" };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runCampaign(campaignId: string, options: RunOptions): Promise<RunReport> {
  const campaign = await getCampaign(campaignId);
  if (!campaign || campaign.status !== "sending") return { status: "not_sending", requests: 0 };

  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const deadline = now() + (options.budgetMs ?? RUN_BUDGET_MS);
  const retry = {
    sleep,
    now,
    deadline,
    timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  };
  const envelope = { from: options.from ?? MAIL_FROM, campaignId };

  let template: CampaignTemplate;
  try {
    const products = await ensureProductSnapshot(campaign, resolveLetterProducts);
    /* Every block the body draws must be in the snapshot, with products: one
       that cannot be read, or a block left with nothing, stops the run rather
       than send its heading over nothing. A start that went through the
       composer was checked the same way; this is for every other road in. */
    const problems = blockProblems(campaign.body, products);
    if (problems.length > 0) {
      await finish(campaignId, {
        message: `Изпращането спря, без да тръгне нито едно писмо повече: продуктите в писмото не могат да бъдат показани (${describeBlockProblems(problems)}).`,
        cause: "products",
      });
      return { status: "stopped", requests: 0, reason: "products" };
    }
    /* And what it says of the shop's promotions, against the promotions as
       they stand now, at the top of every run: a resume a day later must not
       carry a reduction that ended overnight (`claims.ts`). */
    const claims = claimNotes({
      ...(await letterPromotions(campaign)),
      body: campaign.body,
      products: products?.blocks.flatMap((block) => block.products) ?? [],
      now: new Date(now()),
    }).filter((note) => note.blocksSend);
    if (claims.length > 0) {
      await finish(campaignId, {
        message: `Изпращането спря, без да тръгне нито едно писмо повече: ${claims.map((note) => `${note.title} — ${note.detail}`).join(" ")} Изпращащо се писмо не може да се промени: натиснете „Спри изпращането“, за да не тръгне към останалите.`,
        cause: "claims",
      });
      return { status: "stopped", requests: 0, reason: "claims" };
    }
    template = await composeCampaign({
      subject: campaign.subject,
      preheader: campaign.preheader,
      body: campaign.body,
      attachments: campaignFiles(campaign.attachments),
      products,
    });
  } catch (error) {
    await finish(campaignId, {
      message: `Писмото не може да бъде съставено: ${message(error)}`,
      cause: "template",
    });
    return { status: "stopped", requests: 0, reason: "template" };
  }

  let requests = 0;
  let halt: Halt | null = null;
  const stop = (reason: string, cause: RunStopCause) => {
    halt ??= { message: reason, cause };
  };
  const outOfTime = () => {
    if (now() < deadline) return false;
    stop(TIME_UP, "time");
    return true;
  };

  /**
   * One request and what it means for its copies. `resent` is true when an
   * earlier run already made a request under this key: then only a refusal
   * that looks at the messages themselves (a 4xx about their content) proves
   * nothing went.
   */
  const send = async (rows: Claimed[], key: string, resent: boolean): Promise<Result> => {
    if (requests > 0) await sleep(REQUEST_SPACING_MS);
    requests += 1;
    const emails = rows.map((row) => personalise(template, row, envelope));
    const outcome = await sendWithRetry(options.client, emails, key, retry);

    if (outcome.ok) {
      await recordSent(rows, outcome.ids);
      return { kind: "sent" };
    }
    const wait = outcome.maybeSent || (resent && outcome.kind !== "message");
    if (wait) {
      if (outcome.kind === "transient") {
        stop(
          `Resend не отговори (${outcome.message}). Част от писмата чакат потвърждение: натиснете „Продължи“ след няколко минути — изпращат се отново със същия ключ и никой не получава писмото два пъти.`,
          "transient",
        );
      } else if (outcome.kind === "account") {
        stop(
          `Resend отказа изпращането: ${outcome.message}. След като оправите настройката, натиснете „Продължи“.`,
          "account",
        );
      }
      // Ambiguous: these copies wait; the run goes on with the others.
      return { kind: "held" };
    }
    switch (outcome.kind) {
      case "transient":
        // Only rate limits and the deadline: nothing was processed.
        await release(rows);
        stop(
          `Resend ограничи изпращането (${outcome.message}). Нищо не е изгубено: натиснете „Продължи“ след няколко минути.`,
          "transient",
        );
        return { kind: "released" };
      case "account":
        await release(rows);
        stop(
          `Resend отказа изпращането: ${outcome.message}. Нищо от тази заявка не е изпратено; след като оправите настройката, натиснете „Продължи“.`,
          "account",
        );
        return { kind: "released" };
      case "ambiguous":
        // `sendWithRetry` always marks it maybe-sent; kept for exhaustiveness.
        return { kind: "held" };
      case "message":
        if (rows.length > 1) {
          await split(rows);
          return { kind: "split" };
        }
        await recordFailed(rows, `Resend отказа този адрес: ${outcome.message}`);
        return { kind: "refused", message: outcome.message };
    }
  };

  /**
   * A request refused whole, one address at a time. Every copy gets its own
   * key first, in one statement, so a split cut short leaves each of the rest
   * resendable on its own and none of them failed.
   */
  const split = async (rows: Claimed[]): Promise<void> => {
    await assignSingleKeys(campaignId, rows);
    let streak = null as { message: string; count: number } | null;
    for (const [index, row] of rows.entries()) {
      if (halt || outOfTime()) return;
      await markAttempted([row], new Date(now()));
      const result = await send([row], singleKey(campaignId, row.id), false);
      if (result.kind !== "refused") {
        streak = null;
        continue;
      }
      streak =
        streak?.message === result.message
          ? { message: result.message, count: streak.count + 1 }
          : { message: result.message, count: 1 };
      if (streak.count >= IDENTICAL_REFUSALS_TO_HALT) {
        // Never attempted under their own keys: back in the queue, unharmed.
        await release(rows.slice(index + 1));
        stop(
          `Resend отказа ${streak.count} поредни адреса с една и съща грешка (${streak.message}). Това по-скоро е настройка, отколкото адресите: останалите чакат. След като я оправите, натиснете „Продължи“.`,
          "refusals",
        );
        return;
      }
    }
  };

  /* 1. Copies an earlier run left `sending`. */
  await settleUnresendable(campaignId, new Date(now() - KEY_MEMORY_MS));
  for (const [key, group] of await inFlight(campaignId)) {
    if (halt || outOfTime()) break;
    const resent = group.some((row) => row.attemptedAt !== null);
    let rows = group;
    if (!resent) {
      /* Never sent under this key (the rest of a split), so whoever has left
         since can be skipped without changing a request Resend has seen. */
      const left = rows.filter((row) => row.unsubscribedAt !== null);
      if (left.length > 0) await markSkipped(left, LEFT_THE_LIST);
      rows = rows.filter((row) => row.unsubscribedAt === null);
      if (rows.length === 0) continue;
    }
    await markAttempted(rows, new Date(now()));
    await send(rows, key, resent);
    await heartbeat(campaignId);
  }

  /* 2. The queue, a request at a time, while there is time. */
  while (!halt && !outOfTime()) {
    const next = await claimNext(campaignId, new Date(now()));
    if (!next) break;
    await send(next.rows, next.key, false);
    await heartbeat(campaignId);
  }

  const ended = halt as Halt | null;
  await finish(campaignId, ended);
  return ended
    ? { status: "stopped", requests, reason: ended.message }
    : { status: "done", requests };
}

/** Why a run stopped: the owner's words, and the daily job's cause. */
interface Halt {
  readonly message: string;
  readonly cause: RunStopCause;
}

/* -- claiming --------------------------------------------------------------- */

/**
 * The next request's worth of recipients, claimed. Whoever left the list
 * since the snapshot is marked skipped in the same transaction, before the
 * group — and so its key — is fixed.
 */
async function claimNext(
  campaignId: string,
  at: Date,
): Promise<{ key: string; rows: Claimed[] } | null> {
  return db
    .transaction(async (tx) => {
      const candidates = await tx.execute<{
        id: string;
        email: string;
        token: string | null;
        unsubscribed_at: Date | null;
      }>(sql`
      select d.id, d.email, s.unsubscribe_token as token, s.unsubscribed_at
      from ${newsletterDeliveries} d
      left join ${newsletterSubscribers} s on s.id = d.subscriber_id
      where d.campaign_id = ${campaignId} and d.status = 'pending'
      order by d.id
      limit ${BATCH_SIZE}
      for update of d skip locked
    `);
      const rows = Array.from(candidates);
      if (rows.length === 0) return null;

      const gone = rows.filter((row) => !isPlausibleToken(row.token));
      const left = rows.filter(
        (row) => isPlausibleToken(row.token) && row.unsubscribed_at !== null,
      );
      if (gone.length > 0) {
        await tx
          .update(newsletterDeliveries)
          .set({ status: "skipped", error: NO_ROW })
          .where(
            inArray(
              newsletterDeliveries.id,
              gone.map((row) => row.id),
            ),
          );
      }
      if (left.length > 0) {
        await tx
          .update(newsletterDeliveries)
          .set({ status: "skipped", error: LEFT_THE_LIST })
          .where(
            inArray(
              newsletterDeliveries.id,
              left.map((row) => row.id),
            ),
          );
      }

      const claimed = rows
        .filter((row) => isPlausibleToken(row.token) && row.unsubscribed_at === null)
        .map((row) => ({ id: row.id, email: row.email, token: row.token as string }));
      // Everybody in this page had left: try the next page.
      if (claimed.length === 0) return { key: "", rows: [] };

      const key = batchKey(
        campaignId,
        claimed.map((row) => row.id),
      );
      await tx
        .update(newsletterDeliveries)
        .set({ status: "sending", batchKey: key, attemptedAt: at })
        .where(
          inArray(
            newsletterDeliveries.id,
            claimed.map((row) => row.id),
          ),
        );
      return { key, rows: claimed };
    })
    .then(async (next) => {
      // A page of nothing but skips is not the end of the queue.
      if (next && next.rows.length === 0) return claimNext(campaignId, at);
      return next;
    });
}

/**
 * Before resending anything, settle the `sending` copies that cannot be sent
 * again as they were:
 *
 *   - attempted under their key more than 23 hours ago: Resend may have
 *     forgotten the key, so a resend could deliver twice. Failed, "may have
 *     arrived" — the one place that wording is used;
 *   - subscriber row gone: the copy cannot be drawn again. If it was
 *     attempted, it may have arrived; if not, it is simply skipped;
 *   - no key at all, which nothing writes: never attempted, back in the queue.
 */
async function settleUnresendable(campaignId: string, keyForgottenBefore: Date): Promise<void> {
  const inCampaign = and(
    eq(newsletterDeliveries.campaignId, campaignId),
    eq(newsletterDeliveries.status, "sending"),
  );
  await db
    .update(newsletterDeliveries)
    .set({ status: "failed", error: UNKNOWN_OUTCOME })
    .where(and(inCampaign, lt(newsletterDeliveries.attemptedAt, keyForgottenBefore)));
  await db
    .update(newsletterDeliveries)
    .set({ status: "failed", error: GONE_IN_FLIGHT })
    .where(
      and(
        inCampaign,
        isNull(newsletterDeliveries.subscriberId),
        isNotNull(newsletterDeliveries.attemptedAt),
      ),
    );
  await db
    .update(newsletterDeliveries)
    .set({ status: "skipped", error: NO_ROW })
    .where(
      and(
        inCampaign,
        isNull(newsletterDeliveries.subscriberId),
        isNull(newsletterDeliveries.attemptedAt),
      ),
    );
  await db
    .update(newsletterDeliveries)
    .set({ status: "pending", attemptedAt: null })
    .where(and(inCampaign, isNull(newsletterDeliveries.batchKey)));
}

interface InFlight extends Claimed {
  attemptedAt: Date | null;
  unsubscribedAt: Date | null;
}

/** Copies left `sending` by an earlier run, grouped by the key they went with. */
async function inFlight(campaignId: string): Promise<Map<string, InFlight[]>> {
  const rows = await db
    .select({
      id: newsletterDeliveries.id,
      email: newsletterDeliveries.email,
      key: newsletterDeliveries.batchKey,
      attemptedAt: newsletterDeliveries.attemptedAt,
      token: newsletterSubscribers.unsubscribeToken,
      unsubscribedAt: newsletterSubscribers.unsubscribedAt,
    })
    .from(newsletterDeliveries)
    .innerJoin(
      newsletterSubscribers,
      eq(newsletterSubscribers.id, newsletterDeliveries.subscriberId),
    )
    .where(
      and(
        eq(newsletterDeliveries.campaignId, campaignId),
        eq(newsletterDeliveries.status, "sending"),
        isNotNull(newsletterDeliveries.batchKey),
      ),
    )
    .orderBy(asc(newsletterDeliveries.batchKey), asc(newsletterDeliveries.id));

  const groups = new Map<string, InFlight[]>();
  for (const row of rows) {
    const group = groups.get(row.key!) ?? [];
    group.push({
      id: row.id,
      email: row.email,
      token: row.token,
      attemptedAt: row.attemptedAt,
      unsubscribedAt: row.unsubscribedAt,
    });
    groups.set(row.key!, group);
  }
  return groups;
}

/* -- recording -------------------------------------------------------------- */

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

/** One statement for the whole request: all of its answers land, or none do. */
async function recordSent(rows: Claimed[], resendIds: string[]): Promise<void> {
  const pairs = rows.map((row, index) => sql`(${row.id}::uuid, ${resendIds[index]!})`);
  await db.execute(sql`
    update ${newsletterDeliveries} as d
    set status = 'sent', resend_email_id = v.resend_id, sent_at = now(), error = null
    from (values ${sql.join(pairs, sql`, `)}) as v(id, resend_id)
    where d.id = v.id
  `);
}

/** Each copy its own key, in one statement, none of them attempted yet. */
async function assignSingleKeys(campaignId: string, rows: Claimed[]): Promise<void> {
  const pairs = rows.map((row) => sql`(${row.id}::uuid, ${singleKey(campaignId, row.id)})`);
  await db.execute(sql`
    update ${newsletterDeliveries} as d
    set batch_key = v.key, attempted_at = null
    from (values ${sql.join(pairs, sql`, `)}) as v(id, key)
    where d.id = v.id
  `);
}

/** A request under the current key is going out now — unless one already did. */
async function markAttempted(rows: Claimed[], at: Date): Promise<void> {
  await db
    .update(newsletterDeliveries)
    .set({
      attemptedAt: sql`coalesce(${newsletterDeliveries.attemptedAt}, ${at.toISOString()}::timestamptz)`,
    })
    .where(inArray(newsletterDeliveries.id, ids(rows)));
}

async function recordFailed(rows: Claimed[], error: string): Promise<void> {
  await db
    .update(newsletterDeliveries)
    .set({ status: "failed", error: error.slice(0, 500) })
    .where(inArray(newsletterDeliveries.id, ids(rows)));
}

async function markSkipped(rows: Claimed[], reason: string): Promise<void> {
  await db
    .update(newsletterDeliveries)
    .set({ status: "skipped", error: reason })
    .where(inArray(newsletterDeliveries.id, ids(rows)));
}

async function release(rows: Claimed[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .update(newsletterDeliveries)
    .set({ status: "pending", batchKey: null, attemptedAt: null })
    .where(inArray(newsletterDeliveries.id, ids(rows)));
}

export async function tally(campaignId: string): Promise<Record<NewsletterDeliveryStatus, number>> {
  const tallies: Record<NewsletterDeliveryStatus, number> = {
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    bounced: 0,
    complained: 0,
  };
  const rows = await db
    .select({ status: newsletterDeliveries.status, n: count() })
    .from(newsletterDeliveries)
    .where(eq(newsletterDeliveries.campaignId, campaignId))
    .groupBy(newsletterDeliveries.status);
  for (const row of rows) tallies[row.status] = row.n;
  return tallies;
}

/** Accepted by Resend, whatever became of the copy afterwards. */
export const acceptedCount = (tallies: Record<NewsletterDeliveryStatus, number>): number =>
  tallies.sent + tallies.bounced + tallies.complained;

/** The counts the panel shows, and the proof of life `isStale` reads. */
async function heartbeat(campaignId: string): Promise<void> {
  const tallies = await tally(campaignId);
  await db
    .update(newsletterCampaigns)
    .set({ sentCount: acceptedCount(tallies), failedCount: tallies.failed, updatedAt: new Date() })
    .where(eq(newsletterCampaigns.id, campaignId));
}

/** The final status for these tallies: `partial` while anybody waits, as below. */
function finalStatus(
  tallies: Record<NewsletterDeliveryStatus, number>,
): "sent" | "partial" | "failed" {
  const waiting = tallies.pending + tallies.sending;
  const accepted = acceptedCount(tallies);
  return waiting > 0
    ? "partial"
    : tallies.failed === 0
      ? "sent"
      : accepted === 0
        ? "failed"
        : "partial";
}

/**
 * The campaign's attachments with its run-stop entry replaced (or, with no
 * cause, removed), and every other entry — the files, the snapshot, the
 * letter's plan — kept as it was, in its order.
 */
function withRunStop(cause: RunStopCause | null, at: Date) {
  const entry = JSON.stringify(cause ? [runStopEntry(cause, at)] : []);
  return sql`(
    select coalesce(jsonb_agg(kept.entry order by kept.position), '[]'::jsonb)
    from jsonb_array_elements("newsletter_campaigns"."attachments") with ordinality as kept(entry, position)
    where kept.entry->>'kind' is distinct from 'run-stop'
  ) || ${entry}::jsonb`;
}

/**
 * Where the campaign ends up, from its deliveries rather than from this run's
 * memory: `partial` while anybody is still waiting, else `sent` if nobody
 * failed, `failed` if nobody got it, and `partial` in between. With somebody
 * still waiting, why it stopped is recorded for the daily job (`run-stop.ts`).
 */
async function finish(campaignId: string, halt: Halt | null): Promise<void> {
  const tallies = await tally(campaignId);
  const accepted = acceptedCount(tallies);
  const waiting = tallies.pending + tallies.sending;
  const status = finalStatus(tallies);
  const cause: RunStopCause | null = waiting > 0 ? (halt?.cause ?? "unexplained") : null;
  const lastError =
    halt?.message ??
    (tallies.sending > 0
      ? `${lettersPhrase(tallies.sending, "чака", "чакат")} потвърждение от Resend. Натиснете „Продължи“ по-късно: изпращат се отново със същия ключ и никой не получава писмото два пъти.`
      : tallies.pending > 0
        ? "Изпращането спря преди края. Натиснете „Продължи“."
        : tallies.failed > 0
          ? `${lettersPhrase(tallies.failed, "не беше прието", "не бяха приети")} от Resend. Причината е до всеки адрес по-долу.`
          : null);

  await db
    .update(newsletterCampaigns)
    .set({
      status,
      sentCount: accepted,
      failedCount: tallies.failed,
      lastError,
      updatedAt: new Date(),
      attachments: withRunStop(cause, new Date()),
      ...(waiting === 0 ? { sentAt: sql`coalesce(${newsletterCampaigns.sentAt}, now())` } : {}),
    })
    .where(and(eq(newsletterCampaigns.id, campaignId), eq(newsletterCampaigns.status, "sending")));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A run that died on an exception, said so on the campaign. Its in-flight
 * deliveries keep their keys, so "Продължи" resends them safely; without this
 * the panel would show "sending" until the ten-minute staleness gave it away.
 */
export async function abandonRun(campaignId: string, error: unknown): Promise<void> {
  await db
    .update(newsletterCampaigns)
    .set({
      status: "partial",
      lastError: `Изпращането прекъсна: ${message(error).slice(0, 300)}. Натиснете „Продължи“.`,
      updatedAt: new Date(),
      attachments: withRunStop("exception", new Date()),
    })
    .where(and(eq(newsletterCampaigns.id, campaignId), eq(newsletterCampaigns.status, "sending")));
}

const STOPPED_BY_OWNER = "Изпращането беше спряно, преди да дойде редът му.";
const STOPPED_IN_FLIGHT =
  "Изпращането беше спряно, докато писмото чакаше потвърждение от Resend. Може да го е получил; не е изпратено повторно.";

/**
 * "Спри изпращането": the owner ends a send that stopped (or lost its
 * sender) instead of continuing it. Nobody else is mailed: whoever was
 * waiting is marked skipped — or, for a copy that may already have gone out
 * under its key, failed with "may have arrived", which is the truth — and the
 * campaign takes its final status from its deliveries, as `finish` would.
 *
 * Only a campaign the panel would offer "Продължи" for: `partial`, or
 * `sending` with no heartbeat for `STALE_SENDING_MS`, with somebody waiting. The update of the
 * campaign is the lock, in one transaction with the deliveries, so a resume
 * that starts at the same moment finds it no longer resumable.
 */
export async function stopRun(campaignId: string, now = new Date()): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS);
  return db.transaction(async (tx) => {
    // Nobody waiting: nothing to stop.
    const [{ waiting } = { waiting: 0 }] = await tx
      .select({ waiting: count() })
      .from(newsletterDeliveries)
      .where(
        and(
          eq(newsletterDeliveries.campaignId, campaignId),
          inArray(newsletterDeliveries.status, ["pending", "sending"]),
        ),
      );
    if (waiting === 0) return false;
    const [claimed] = await tx
      .update(newsletterCampaigns)
      .set({ updatedAt: now })
      .where(
        and(
          eq(newsletterCampaigns.id, campaignId),
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
    if (!claimed) return false;

    const inCampaign = eq(newsletterDeliveries.campaignId, campaignId);
    await tx
      .update(newsletterDeliveries)
      .set({ status: "failed", error: STOPPED_IN_FLIGHT })
      .where(
        and(
          inCampaign,
          eq(newsletterDeliveries.status, "sending"),
          isNotNull(newsletterDeliveries.attemptedAt),
        ),
      );
    await tx
      .update(newsletterDeliveries)
      .set({ status: "skipped", error: STOPPED_BY_OWNER, batchKey: null })
      .where(
        and(
          inCampaign,
          or(
            eq(newsletterDeliveries.status, "pending"),
            and(
              eq(newsletterDeliveries.status, "sending"),
              isNull(newsletterDeliveries.attemptedAt),
            ),
          ),
        ),
      );

    const tallies: Record<NewsletterDeliveryStatus, number> = {
      pending: 0,
      sending: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      bounced: 0,
      complained: 0,
    };
    const rows = await tx
      .select({ status: newsletterDeliveries.status, n: count() })
      .from(newsletterDeliveries)
      .where(inCampaign)
      .groupBy(newsletterDeliveries.status);
    for (const row of rows) tallies[row.status] = row.n;
    const stopped = tallies.skipped;
    await tx
      .update(newsletterCampaigns)
      .set({
        status: finalStatus(tallies),
        sentCount: acceptedCount(tallies),
        failedCount: tallies.failed,
        lastError: `Изпращането е спряно. ${lettersPhrase(stopped, "не беше изпратено", "не бяха изпратени")} на тези, до които още не беше стигнало.`,
        updatedAt: now,
        sentAt: sql`coalesce(${newsletterCampaigns.sentAt}, now())`,
        attachments: withRunStop(null, now),
      })
      .where(eq(newsletterCampaigns.id, campaignId));
    return true;
  });
}

/* -- Resend ----------------------------------------------------------------- */

/**
 * The real client: `resend.batch.send` with the idempotency key as a request
 * option (the SDK puts it in the `Idempotency-Key` header) and the abort
 * signal, which the SDK passes through to `fetch` with the rest of the request
 * options — an aborted request comes back as an error with no status, which
 * `batch.ts` treats as "may have been processed". Strict validation, the
 * default, so a refused request has sent nothing.
 */
export async function resendBatchClient(key: string): Promise<BatchClient> {
  const { Resend } = await import("resend");
  const resend = new Resend(key);
  return {
    async send(emails: BatchEmail[], { idempotencyKey, signal }) {
      const requestOptions = { idempotencyKey, signal };
      const response = await resend.batch.send(emails, requestOptions);
      return {
        data: response.data?.data ?? null,
        error: response.error
          ? {
              name: response.error.name,
              message: response.error.message,
              statusCode: response.error.statusCode,
            }
          : null,
        headers: response.headers,
      };
    },
  };
}
