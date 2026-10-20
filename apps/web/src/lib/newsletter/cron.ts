import "server-only";
import { draftReadyNotice } from "@/lib/mail/newsletter-notices";
import { notify } from "@/lib/notifications";
import type { BatchClient } from "./batch";
import {
  claimResume,
  createPeriodDraft,
  deliveryCounts,
  hasOwnMonthlyDraft,
  hasPeriodDraft,
  resumableByJob,
  resumableCampaigns,
  wentOutSince,
} from "./campaigns";
import { letterPlanEntry } from "./letter-plan";
import { RUN_BUDGET_MS, abandonRun, resendBatchClient, runCampaign } from "./send";
import { sofiaDayOfMonth, sofiaMonthStart, sofiaPeriod } from "./sofia";
import { monthlyPlan } from "./template-data";
import { monthlyLetter } from "./templates";

/**
 * The newsletter's daily job (`/api/cron/newsletter`, 07:00 UTC): prepare the
 * month's letter, and pick up a send that stopped for a reason another run
 * gets past. It never sends a letter to the list on its own — only the
 * owner's "Изпрати" does that; the resume finishes a send the owner already
 * started, as their "Продължи" would.
 *
 * THE MONTHLY DRAFT. In the first week of each Sofia month (days 1 to 7),
 * once: the job runs every day, so a day it missed is made up within the
 * week, and a month whose first week had nothing to say waits for the next.
 * It prepares nothing
 *
 *   - when the month already has its draft (`auto_period`, unique — two runs
 *     at once make one draft and one notice, `createPeriodDraft`), kept even
 *     after the owner deleted it (`deleteDraft`);
 *   - when a letter has already gone out this calendar month, or a monthly
 *     letter the owner started is waiting as a draft: the signup promises one
 *     a month at most. How long ago the last letter went is not a rule here —
 *     the composer warns about a letter within 30 days of the last;
 *   - when there is nothing to write about: nothing new, nothing reduced.
 *
 * Otherwise the draft is the monthly template (`templates.ts`) with its plan
 * (`letter-plan.ts`), and the owner is mailed a link to it through the shop's
 * notifications. A notice that could not be delivered leaves the draft as it
 * is: the panel's front page and the newsletter page both show it, and making
 * it again tomorrow would be the one way to tell the owner twice.
 *
 * THE RESUME. A send stopped by its own time running out or by Resend's bad
 * minute, or one whose sender vanished, within 23 hours of its start
 * (`resumableByJob`), is claimed (`claimResume`, the same lock the button
 * takes) and run in this request, one after another, inside one sender's
 * budget. Anything else waits for the owner. `send.ts` is why a resume is
 * safe: nobody is mailed twice, however many runs pick a send up.
 *
 * Each step is guarded on its own: a failure in one is logged and counted,
 * and the other still runs.
 */

/** The Sofia days of the month the monthly draft may be prepared on. */
export const PREPARE_DAYS = 7;

export type DraftOutcome =
  | "created"
  | "exists"
  | "not_first_week"
  | "sent_this_month"
  | "owner_draft"
  | "nothing_new"
  | "error";

export interface NewsletterCronReport {
  readonly checkedAt: string;
  readonly draft: DraftOutcome;
  readonly draftsCreated: number;
  readonly ownerNotified: number;
  /** Sends picked up and run in this request. */
  readonly resumed: number;
  /** Sends the job may pick up but did not: no key, out of time, or claimed elsewhere. */
  readonly resumeSkipped: number;
  /** Sends stopped for a reason only the owner can see to: left for "Продължи" or "Спри". */
  readonly awaitingOwner: number;
  /** Steps that failed: 0, 1 or 2. */
  readonly errors: number;
}

export interface CronOptions {
  /** Resend, or a stand-in; the real batch client by default. */
  readonly client?: BatchClient;
  /** Start no resume after this long. */
  readonly budgetMs?: number;
  readonly clock?: () => number;
}

/** A resume that would have less than this left is not started: it could not send anything. */
const MIN_RESUME_MS = 20_000;

const failed = (step: string, error: unknown) =>
  console.error(
    JSON.stringify({
      level: "error",
      msg: `newsletter.cron.${step}_failed`,
      error: error instanceof Error ? error.message : String(error),
    }),
  );

export async function runNewsletterCron(
  now: Date = new Date(),
  options: CronOptions = {},
): Promise<NewsletterCronReport> {
  const clock = options.clock ?? Date.now;
  const deadline = clock() + (options.budgetMs ?? RUN_BUDGET_MS);
  let errors = 0;

  let prepared: { outcome: DraftOutcome; notified: boolean };
  try {
    prepared = await prepareMonthlyDraft(now);
  } catch (error) {
    failed("draft", error);
    errors += 1;
    prepared = { outcome: "error", notified: false };
  }

  let resumes = { resumed: 0, resumeSkipped: 0, awaitingOwner: 0 };
  try {
    resumes = await resumeStalled(deadline, clock, options.client);
  } catch (error) {
    failed("resume", error);
    errors += 1;
  }

  return {
    checkedAt: new Date(clock()).toISOString(),
    draft: prepared.outcome,
    draftsCreated: prepared.outcome === "created" ? 1 : 0,
    ownerNotified: prepared.notified ? 1 : 0,
    ...resumes,
    errors,
  };
}

async function prepareMonthlyDraft(
  now: Date,
): Promise<{ outcome: DraftOutcome; notified: boolean }> {
  if (sofiaDayOfMonth(now) > PREPARE_DAYS) return { outcome: "not_first_week", notified: false };
  const period = sofiaPeriod(now);
  if (await hasPeriodDraft(period)) return { outcome: "exists", notified: false };
  if (await wentOutSince(sofiaMonthStart(now))) {
    return { outcome: "sent_this_month", notified: false };
  }
  if (await hasOwnMonthlyDraft()) return { outcome: "owner_draft", notified: false };

  const prepared = await monthlyPlan(now);
  if (prepared.input.newArrivals.length === 0 && prepared.input.reduced.length === 0) {
    return { outcome: "nothing_new", notified: false };
  }
  const id = await createPeriodDraft(period, {
    ...monthlyLetter(prepared.input),
    attachments: [letterPlanEntry(prepared.plan)],
  });
  // Another run made the month's draft between the check and the insert.
  if (!id) return { outcome: "exists", notified: false };

  const { delivered } = await notify(
    draftReadyNotice({
      id,
      period,
      newProducts: prepared.input.newArrivals.length,
      reducedProducts: prepared.input.reduced.length,
    }),
  );
  console.info(
    JSON.stringify({ level: "info", msg: "newsletter.cron.draft", period, notified: delivered }),
  );
  return { outcome: "created", notified: delivered };
}

async function resumeStalled(
  deadline: number,
  clock: () => number,
  client: BatchClient | undefined,
): Promise<{ resumed: number; resumeSkipped: number; awaitingOwner: number }> {
  const at = new Date(clock());
  const stalled = await resumableCampaigns(at);
  const ours = [];
  for (const campaign of stalled) {
    const counts = await deliveryCounts(campaign.id);
    if (resumableByJob(campaign, counts.pending + counts.sending, at)) ours.push(campaign);
  }
  const awaitingOwner = stalled.length - ours.length;
  if (ours.length === 0) return { resumed: 0, resumeSkipped: 0, awaitingOwner };
  const key = process.env.RESEND_API_KEY;
  if (!client && !key) return { resumed: 0, resumeSkipped: ours.length, awaitingOwner };
  const sender = client ?? (await resendBatchClient(key!));

  let resumed = 0;
  let skipped = 0;
  for (const campaign of ours) {
    const left = deadline - clock();
    if (left < MIN_RESUME_MS || !(await claimResume(campaign.id, new Date(clock())))) {
      skipped += 1;
      continue;
    }
    try {
      const report = await runCampaign(campaign.id, { client: sender, budgetMs: left });
      console.info(
        JSON.stringify({
          level: "info",
          msg: "newsletter.cron.resumed",
          campaignId: campaign.id,
          status: report.status,
          requests: report.requests,
        }),
      );
      resumed += 1;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "newsletter.cron.resume_failed",
          campaignId: campaign.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await abandonRun(campaign.id, error).catch(() => undefined);
    }
  }
  return { resumed, resumeSkipped: skipped, awaitingOwner };
}
