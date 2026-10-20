import { z } from "zod";
import type { NewsletterCampaignAttachment, NewsletterRunStop } from "@catalog/db/schema";

/**
 * Why the last run of a send stopped, in a word: an entry of the campaign's
 * `attachments` (no column, no migration), written by the run as it ends
 * (`finish` in `send.ts`) beside the message the owner reads in `last_error`.
 *
 * The daily job picks a send up without the owner only when another run can
 * get past what stopped it, and only within the 23 hours Resend remembers a
 * request (`resumableByJob`):
 *
 *   time         the run used its budget, or Resend's answer took too long
 *   transient    a rate limit, the network, a 5xx — Resend's bad minute
 *
 * Everything else waits for the owner, because running again would meet the
 * same wall, or something needs a look first:
 *
 *   account      Resend refused the key, the sender, the quota
 *   refusals     the same refusal for address after address: a setting
 *   products     the letter's products could not be drawn
 *   template     the letter itself could not be drawn
 *   exception    the run died on an error of its own
 *   unexplained  it stopped with copies waiting and no reason recorded
 */

export const RUN_STOP_CAUSES = [
  "time",
  "transient",
  "account",
  "refusals",
  "products",
  "template",
  "exception",
  "unexplained",
] as const;
export type RunStopCause = (typeof RUN_STOP_CAUSES)[number];

/** What a later run gets past on its own. */
export const PASSING_CAUSES: ReadonlySet<RunStopCause> = new Set(["time", "transient"]);

const runStopSchema = z.object({
  kind: z.literal("run-stop"),
  cause: z.enum(RUN_STOP_CAUSES),
  at: z.string(),
});

export type RunStop = z.infer<typeof runStopSchema>;

export function runStopOf(entries: readonly NewsletterCampaignAttachment[]): RunStop | null {
  const entry = entries.find((item) => item.kind === "run-stop");
  if (!entry) return null;
  const parsed = runStopSchema.safeParse(entry);
  return parsed.success ? parsed.data : null;
}

export function runStopEntry(cause: RunStopCause, at: Date): NewsletterRunStop {
  return { kind: "run-stop", cause, at: at.toISOString() };
}
