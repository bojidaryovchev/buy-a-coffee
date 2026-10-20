import "server-only";
import { draftReadyNotice } from "@/lib/mail/newsletter-notices";
import { notify } from "@/lib/notifications";
import type { BatchClient } from "./batch";
import {
  claimResume,
  createPeriodDraft,
  hasMonthlyDraftSince,
  hasPeriodDraft,
  resumableCampaigns,
  wentOutSince,
} from "./campaigns";
import { RUN_BUDGET_MS, abandonRun, resendBatchClient, runCampaign } from "./send";
import { sofiaMonthStart, sofiaPeriod } from "./sofia";
import { monthlyPlan } from "./template-data";
import { monthlyLetter } from "./templates";

/**
 * The newsletter's daily job (`/api/cron/newsletter`, 07:00 UTC): prepare the
 * month's letter, and pick up a send that stopped. It never sends a letter to
 * the list on its own — only the owner's "Изпрати" does that; the resume
 * finishes a send the owner already started, exactly as their "Продължи"
 * would.
 *
 * THE MONTHLY DRAFT. From the 1st of each Sofia month, once a month: the job
 * runs every day, so a day it missed is made up the next. It prepares nothing
 *
 *   - when the month already has its draft (`auto_period`, unique — two runs
 *     at once make one draft and one notice, `createPeriodDraft`);
 *   - when a letter has already gone out this month, or the owner has started
 *     a monthly letter of their own: the signup promises one a month;
 *   - when there is nothing to write about: nothing new since the last letter,
 *     and nothing reduced.
 *
 * Otherwise the draft is the monthly template (`templates.ts`), and the owner
 * is mailed a link to it through the shop's notifications. A notice that
 * could not be delivered leaves the draft as it is: the panel's front page
 * and the newsletter page both show it, and making it again tomorrow would be
 * the one way to tell the owner twice.
 *
 * THE RESUME. Every campaign the panel would offer "Продължи" for — stopped
 * with somebody waiting, or `sending` with no heartbeat for ten minutes — is
 * claimed (`claimResume`, the same lock the button takes) and run in this
 * request, one after another, inside one sender's budget. `send.ts` is why
 * that is safe: nobody is mailed twice, however many runs pick a send up.
 */

export type DraftOutcome = "created" | "exists" | "sent_this_month" | "owner_draft" | "nothing_new";

export interface NewsletterCronReport {
  readonly checkedAt: string;
  readonly draft: DraftOutcome;
  readonly draftsCreated: number;
  readonly ownerNotified: number;
  /** Sends picked up and run in this request. */
  readonly resumed: number;
  /** Sends that wanted picking up but were not: no key, out of time, or claimed elsewhere. */
  readonly resumeSkipped: number;
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

export async function runNewsletterCron(
  now: Date = new Date(),
  options: CronOptions = {},
): Promise<NewsletterCronReport> {
  const clock = options.clock ?? Date.now;
  const deadline = clock() + (options.budgetMs ?? RUN_BUDGET_MS);

  const prepared = await prepareMonthlyDraft(now);
  const resumes = await resumeStalled(deadline, clock, options.client);

  return {
    checkedAt: now.toISOString(),
    draft: prepared.outcome,
    draftsCreated: prepared.outcome === "created" ? 1 : 0,
    ownerNotified: prepared.notified ? 1 : 0,
    ...resumes,
  };
}

async function prepareMonthlyDraft(
  now: Date,
): Promise<{ outcome: DraftOutcome; notified: boolean }> {
  const period = sofiaPeriod(now);
  if (await hasPeriodDraft(period)) return { outcome: "exists", notified: false };
  const monthStart = sofiaMonthStart(now);
  if (await wentOutSince(monthStart)) return { outcome: "sent_this_month", notified: false };
  if (await hasMonthlyDraftSince(monthStart)) return { outcome: "owner_draft", notified: false };

  const plan = await monthlyPlan(now);
  if (plan.input.newArrivals.length === 0 && plan.input.reduced.length === 0) {
    return { outcome: "nothing_new", notified: false };
  }
  const id = await createPeriodDraft(period, monthlyLetter(plan.input));
  // Another run made the month's draft between the check and the insert.
  if (!id) return { outcome: "exists", notified: false };

  const { delivered } = await notify(
    draftReadyNotice({
      id,
      period,
      newProducts: plan.input.newArrivals.length,
      reducedProducts: plan.input.reduced.length,
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
): Promise<{ resumed: number; resumeSkipped: number }> {
  const waiting = await resumableCampaigns(new Date(clock()));
  if (waiting.length === 0) return { resumed: 0, resumeSkipped: 0 };
  const key = process.env.RESEND_API_KEY;
  if (!client && !key) return { resumed: 0, resumeSkipped: waiting.length };
  const sender = client ?? (await resendBatchClient(key!));

  let resumed = 0;
  let skipped = 0;
  for (const campaign of waiting) {
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
          ...report,
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
  return { resumed, resumeSkipped: skipped };
}
