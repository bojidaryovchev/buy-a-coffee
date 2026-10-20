import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { products, syncAlerts, syncChanges, syncRuns } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import {
  MANUAL_LINK_RUN_KIND,
  SYNC_CONDITION_LABEL,
  evaluateIdentityChanges,
  evaluateSyncHealth,
  evaluateUnauditedFlavoured,
  unauditedFlavoured,
  type FlavouredProductSnapshot,
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

/** `already_raised`: a held-back flavoured product was named in an earlier mail. */
export type AlertOutcome = "sent" | "already_sent_today" | "already_raised" | "delivery_failed";

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
 * How far back a rename is looked for: one day, the check's own interval. The
 * check runs once a day at a fixed time and the sync at fixed times, so each
 * sync run falls in exactly one check's window and a rename is named once.
 */
const IDENTITY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The most renames one check reads; the summary names five and counts the rest. */
export const IDENTITY_READ = 50;

/**
 * Updates, returns and moves in real runs of the last day that renamed a
 * product. A move is included: pairing a renamed source URL with the wrong
 * product is a substitution too.
 */
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
        inArray(syncChanges.changeType, ["updated", "restored", "moved"]),
        sql`${syncChanges.changedFields} @> '["name"]'::jsonb`,
        gte(syncChanges.createdAt, new Date(now.getTime() - IDENTITY_WINDOW_MS)),
      ),
    )
    .orderBy(desc(syncChanges.createdAt))
    .limit(IDENTITY_READ);
}

/**
 * The rename finding, or null. A failure to read is logged and left out: the
 * check exists for the run conditions above all, and one new query must not
 * take them down with it.
 */
async function identityFinding(now: Date) {
  try {
    const renamed = await readIdentityChanges(now);
    return evaluateIdentityChanges(renamed, { more: renamed.length >= IDENTITY_READ });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "sync_health.identity_read_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
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

/* --- Flavoured products nobody has classified ---------------------------- */

/**
 * The claim key of one held-back product: the condition and the product's
 * slug, in `sync_alerts.condition`. Kept by product rather than by day, so a
 * product is mailed about once — the first check that finds it unaudited —
 * and not every morning until somebody classifies it; a product found later
 * is a new occurrence and is mailed about in its turn.
 */
const unauditedKey = (slug: string): string => `flavoured_unaudited:${slug}`;

/** Every product on sale flagged flavoured, with what the audit and the hint read. */
async function readFlavoured(): Promise<FlavouredProductSnapshot[]> {
  const rows = await db
    .select({
      slug: products.slug,
      previousSlugs: products.previousSlugs,
      name: products.name,
      descriptionText: products.descriptionText,
      descriptionTextOverride: products.descriptionTextOverride,
      descriptionHtmlOverride: products.descriptionHtmlOverride,
    })
    .from(products)
    // The listings' filter's own test, as `isFlavoured` in `lib/catalog/landings.ts`.
    .where(
      and(eq(products.status, "active"), sql`lower(${products.attributes}->>'aromas') = 'yes'`),
    );
  return rows.map((row) => ({
    slug: row.slug,
    previousSlugs: row.previousSlugs ?? [],
    name: row.name,
    descriptions: [
      row.descriptionText,
      row.descriptionTextOverride,
      row.descriptionHtmlOverride,
    ].filter((text): text is string => typeof text === "string" && text.trim() !== ""),
  }));
}

/** The held-back products some earlier check already mailed about, on any day. */
async function raisedBefore(slugs: readonly string[]): Promise<ReadonlySet<string>> {
  if (slugs.length === 0) return new Set();
  const rows = await db
    .select({ condition: syncAlerts.condition })
    .from(syncAlerts)
    .where(inArray(syncAlerts.condition, slugs.map(unauditedKey)));
  return new Set(rows.map((row) => row.condition));
}

/**
 * Raise what is new among the held-back products: one mail naming them all,
 * claimed product by product so two overlapping checks name each once. The
 * claims are given back when the mail does not go, so the next check tries
 * again. A failure to read is logged and left out, as the rename read is.
 */
async function raiseUnauditedFlavoured(
  day: string,
): Promise<{ readonly outcome: AlertOutcome; readonly sent: number } | null> {
  let held: FlavouredProductSnapshot[];
  try {
    held = unauditedFlavoured(await readFlavoured());
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "sync_health.flavoured_read_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
  if (held.length === 0) return null;

  const raised = await raisedBefore(held.map((product) => product.slug));
  const fresh = held.filter((product) => !raised.has(unauditedKey(product.slug)));
  if (fresh.length === 0) return { outcome: "already_raised", sent: 0 };

  const claimed = new Set(
    (
      await db
        .insert(syncAlerts)
        .values(fresh.map((product) => ({ condition: unauditedKey(product.slug), day })))
        .onConflictDoNothing()
        .returning({ condition: syncAlerts.condition })
    ).map((row) => row.condition),
  );
  const mine = fresh.filter((product) => claimed.has(unauditedKey(product.slug)));
  if (mine.length === 0) return { outcome: "already_raised", sent: 0 };

  const finding = evaluateUnauditedFlavoured(mine, {
    alreadyRaised: held.length - fresh.length,
  });
  const { delivered } = await notify({
    kind: "sync_alert",
    subject: `Синхронизация: ${SYNC_CONDITION_LABEL.flavoured_unaudited}`,
    summary: finding!.summary,
    recordId: `flavoured_unaudited:${day}`,
  });
  if (delivered) return { outcome: "sent", sent: 1 };

  await db.delete(syncAlerts).where(
    and(
      inArray(
        syncAlerts.condition,
        mine.map((product) => unauditedKey(product.slug)),
      ),
      eq(syncAlerts.day, day),
    ),
  );
  return { outcome: "delivery_failed", sent: 0 };
}

export async function runSyncHealthCheck(now: Date = new Date()): Promise<SyncHealthReport> {
  const [runs, identity] = await Promise.all([readRuns(), identityFinding(now)]);
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

  const flavoured = await raiseUnauditedFlavoured(day);
  if (flavoured) {
    sent += flavoured.sent;
    conditions.push({ condition: "flavoured_unaudited", outcome: flavoured.outcome });
  }

  return { checkedAt: now.toISOString(), runsRead: runs.length, conditions, sent };
}
