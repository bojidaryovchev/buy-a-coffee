import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { syncAlerts, syncChanges, syncRuns } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import {
  MANUAL_LINK_RUN_KIND,
  SYNC_CONDITION_LABEL,
  evaluateIdentityChanges,
  evaluateSyncHealth,
  type IdentityChangeSnapshot,
  type SyncCondition,
  type SyncRunSnapshot,
} from "@/lib/sync-health";

/**
 * The impure half of the sync-health check: read the runs, send what is owed.
 *
 * Kept out of `sync-health.ts` so that file stays free of the database and can
 * be tested with nothing but rows; kept out of the route file because a Next.js
 * route module may export only HTTP handlers, and a function the integration
 * test can call with a chosen "now" is worth a file of its own.
 */

/** Enough history to find a success even through a long streak of failures,
    without reading the table's whole life on every check. */
const RUNS_READ = 50;

export type AlertOutcome = "sent" | "already_sent_today" | "delivery_failed";

export interface SyncHealthReport {
  checkedAt: string;
  runsRead: number;
  /** One entry per condition that holds, whether or not it was mailed. */
  conditions: Array<{ condition: SyncCondition; outcome: AlertOutcome }>;
  sent: number;
}

/** The UTC calendar day: the unit "once per day" is counted in. */
export const alertDay = (now: Date): string => now.toISOString().slice(0, 10);

async function readRuns(): Promise<SyncRunSnapshot[]> {
  return (
    db
      .select({
        status: syncRuns.status,
        dryRun: syncRuns.dryRun,
        startedAt: syncRuns.startedAt,
        completedAt: syncRuns.completedAt,
        circuitBreakerTripped: syncRuns.circuitBreakerTripped,
        catalogSource: syncRuns.catalogSource,
        parserConfidence: syncRuns.parserConfidence,
        imagesFailed: syncRuns.imagesFailed,
        metadata: syncRuns.metadata,
      })
      .from(syncRuns)
      /* Manual links are excluded here as well as in `evaluateSyncHealth`, so a
       burst of them cannot push the real runs out of the window read. */
      .where(
        and(
          eq(syncRuns.dryRun, false),
          sql`${syncRuns.metadata}->>'kind' is distinct from ${MANUAL_LINK_RUN_KIND}`,
        ),
      )
      .orderBy(desc(syncRuns.startedAt))
      .limit(RUNS_READ)
  );
}

/**
 * How far back a rename is looked for: the daily check's interval and the
 * same slack the run rules allow, so a rename in any run between two checks
 * is seen, and at most two hours of runs are seen by two checks.
 */
const IDENTITY_WINDOW_MS = 26 * 60 * 60 * 1000;

/** The most renames one check reads; the summary names five and counts the rest. */
const IDENTITY_READ = 50;

/** Updates and returns in real runs, since the last check, that renamed a product. */
async function readIdentityChanges(now: Date): Promise<IdentityChangeSnapshot[]> {
  return db
    .select({
      sourceKey: syncChanges.sourceKey,
      before: syncChanges.before,
      after: syncChanges.after,
    })
    .from(syncChanges)
    .innerJoin(syncRuns, eq(syncRuns.id, syncChanges.syncRunId))
    .where(
      and(
        eq(syncRuns.dryRun, false),
        inArray(syncChanges.changeType, ["updated", "restored"]),
        sql`${syncChanges.changedFields} @> '["name"]'::jsonb`,
        gte(syncChanges.createdAt, new Date(now.getTime() - IDENTITY_WINDOW_MS)),
      ),
    )
    .orderBy(desc(syncChanges.createdAt))
    .limit(IDENTITY_READ);
}

/**
 * Claim today's slot for a condition. True only for the caller that got it.
 *
 * The insert is the lock: two overlapping invocations (a retry, a manual
 * trigger beside the scheduled one) race on the primary key and exactly one
 * wins. A read-then-write would let both through.
 */
async function claim(condition: SyncCondition, day: string): Promise<boolean> {
  const inserted = await db
    .insert(syncAlerts)
    .values({ condition, day })
    .onConflictDoNothing()
    .returning({ condition: syncAlerts.condition });
  return inserted.length > 0;
}

/** Give the slot back, so the next invocation today may try again. */
async function release(condition: SyncCondition, day: string): Promise<void> {
  await db
    .delete(syncAlerts)
    .where(and(eq(syncAlerts.condition, condition), eq(syncAlerts.day, day)));
}

export async function runSyncHealthCheck(now: Date = new Date()): Promise<SyncHealthReport> {
  const [runs, renamed] = await Promise.all([readRuns(), readIdentityChanges(now)]);
  const identity = evaluateIdentityChanges(renamed);
  const findings = [...evaluateSyncHealth(runs, now), ...(identity ? [identity] : [])];
  const day = alertDay(now);

  const conditions: SyncHealthReport["conditions"] = [];
  let sent = 0;

  for (const finding of findings) {
    if (!(await claim(finding.condition, day))) {
      conditions.push({ condition: finding.condition, outcome: "already_sent_today" });
      continue;
    }

    const { delivered } = await notify({
      kind: "sync_alert",
      subject: `Синхронизация: ${SYNC_CONDITION_LABEL[finding.condition]}`,
      summary: finding.summary,
      recordId: `${finding.condition}:${day}`,
    });

    if (delivered) {
      sent += 1;
      conditions.push({ condition: finding.condition, outcome: "sent" });
    } else {
      /* A claim that was never delivered would silence the condition for the
         rest of the day, which is the failure this whole route exists to
         prevent. */
      await release(finding.condition, day);
      conditions.push({ condition: finding.condition, outcome: "delivery_failed" });
    }
  }

  return { checkedAt: now.toISOString(), runsRead: runs.length, conditions, sent };
}
