import "server-only";
import { and, asc, count, gt, isNull } from "drizzle-orm";
import type { Resend } from "resend";
import { newsletterSubscribers } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { pacedClient, subscribeConfig, syncSubscribed } from "./sync";

/**
 * "Копирай списъка в Resend": every active subscriber mirrored into Resend
 * again, for the copies that never got there — a sync that failed at signup,
 * a subscriber from before the topic existed.
 *
 * Idempotent: mirroring a subscriber who is already there in the right state
 * changes nothing (`syncSubscribed` creates, or brings an existing contact to
 * the same state). Paced: the calls are spaced (`pacedClient`), because the
 * Resend account is shared with three other sites. Bounded: it stops after
 * `budgetMs` and says where, and the next press carries on from there
 * (`after`, a subscriber id — the list is walked in id order), so a long list
 * takes several presses and no press outlives its function.
 *
 * The send does not depend on any of this (`batch.ts`): it is Resend's own
 * pages — its preference page, its suppression list — that read the copy.
 */

export interface ResyncReport {
  synced: number;
  failed: number;
  skipped: number;
  /** Active subscribers after the last one handled; 0 when the walk is done. */
  remaining: number;
  /** Where the next press starts ("" for the beginning), or null when nobody is left. */
  next: string | null;
  /** The first failure's reason, for the panel. */
  firstError?: string;
}

/** Spacing between Resend calls: under the default two requests a second. */
export const RESYNC_GAP_MS = 600;

const PAGE = 500;

export async function resyncActiveSubscribers(options: {
  after?: string | null;
  budgetMs?: number;
  resend?: Resend;
  now?: () => number;
}): Promise<ResyncReport | { error: string }> {
  const config = subscribeConfig();
  if (!config.ok) return { error: config.reason };

  const now = options.now ?? Date.now;
  const started = now();
  const budget = options.budgetMs ?? 200_000;
  const resend = options.resend ?? (await pacedClient(config.key, RESYNC_GAP_MS));
  const report: ResyncReport = { synced: 0, failed: 0, skipped: 0, remaining: 0, next: null };

  const active = isNull(newsletterSubscribers.unsubscribedAt);
  const after = options.after ?? null;
  let cursor = after;
  let stopped = false;

  outer: while (true) {
    const rows = await db
      .select({
        id: newsletterSubscribers.id,
        email: newsletterSubscribers.email,
        unsubscribeToken: newsletterSubscribers.unsubscribeToken,
      })
      .from(newsletterSubscribers)
      .where(and(active, cursor ? gt(newsletterSubscribers.id, cursor) : undefined))
      .orderBy(asc(newsletterSubscribers.id))
      .limit(PAGE);
    if (rows.length === 0) break;

    for (const row of rows) {
      if (now() - started > budget) {
        stopped = true;
        break outer;
      }
      const result = await syncSubscribed(row, resend);
      if (result.status === "synced") report.synced += 1;
      else if (result.status === "skipped") report.skipped += 1;
      else {
        report.failed += 1;
        report.firstError ??= result.error;
      }
      cursor = row.id;
    }
    if (rows.length < PAGE) break;
  }

  if (stopped && cursor !== null) {
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(newsletterSubscribers)
      .where(and(active, gt(newsletterSubscribers.id, cursor)));
    report.remaining = n;
    report.next = n > 0 ? cursor : null;
  } else if (stopped) {
    // Out of time before the first subscriber: start from where we were asked to.
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(newsletterSubscribers)
      .where(and(active, after ? gt(newsletterSubscribers.id, after) : undefined));
    report.remaining = n;
    // "" is "from the start": not null, which would read as "nobody left".
    report.next = after ?? "";
  }
  return report;
}
