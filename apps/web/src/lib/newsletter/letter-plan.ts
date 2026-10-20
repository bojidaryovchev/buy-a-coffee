import { z } from "zod";
import type { NewsletterCampaignAttachment, NewsletterLetterPlan } from "@catalog/db/schema";

/**
 * What a draft was written from, kept with it: an entry of the campaign's
 * `attachments`, beside the files, like the send's product snapshot — no
 * column of its own, so no migration.
 *
 *   - `preparedAt` is when the monthly letter's data was read. Once the
 *     letter goes out it is where the next monthly letter starts counting new
 *     arrivals (`newArrivalsSince`): a product that arrived between the
 *     preparation and the send was never in this letter, and is new in the
 *     next one.
 *   - `named` are the shop's promotions the monthly letter names in words,
 *     each as it was when the letter was written — its days, its name for
 *     customers — with the exact line written for it ("**Есенни дни** —
 *     намалени цени до 15 ноември") and the reductions it priced. While the
 *     body still holds the line or one of those reductions, the promotion
 *     must still run, and must still be the promotion the line describes
 *     (`claims.ts`).
 *   - `announced` is a promotion's letter's own promotion, as written about:
 *     days, name and reduction. Changed since, the letter is wrong.
 *   - `leftOut` says, in counts, what the template could not put in and why,
 *     for the owner reading the draft.
 *
 * The composer posts only files, and a save keeps this entry as it is
 * (`saveDraft`). A copy of the letter does not take it (`duplicateCampaign`):
 * the copy was not written from today's data.
 */

const plannedSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  percentOff: z.number().int(),
  startsAt: z.string(),
  endsAt: z.string(),
  line: z.string().nullable(),
  slugs: z.array(z.string()).default([]),
});

export const letterPlanSchema = z.object({
  kind: z.literal("letter-plan"),
  version: z.literal(1),
  preparedAt: z.string(),
  named: z.array(plannedSchema).default([]),
  announced: plannedSchema.nullable().default(null),
  leftOut: z
    .object({
      /** Members whose badge could not carry the promotion's percentage. */
      unbacked: z.number().int().nonnegative(),
      /** Members that cannot be ordered now. */
      soldOut: z.number().int().nonnegative(),
      /** Members a larger promotion prices instead. */
      elsewhere: z.number().int().nonnegative(),
      /** Honest members beyond what one block shows. */
      overflow: z.number().int().nonnegative(),
      /** New arrivals beyond what the letter has room for. */
      newOverflow: z.number().int().nonnegative(),
    })
    .partial()
    .default({}),
});

export type LetterPlan = z.infer<typeof letterPlanSchema>;
export type LetterPlanInput = z.input<typeof letterPlanSchema>;

/** The plan a campaign was written from, if it has one that reads as one. */
export function letterPlanOf(entries: readonly NewsletterCampaignAttachment[]): LetterPlan | null {
  const entry = entries.find((item) => item.kind === "letter-plan");
  if (!entry) return null;
  const parsed = letterPlanSchema.safeParse(entry);
  return parsed.success ? parsed.data : null;
}

/** The entry as it is stored. */
export function letterPlanEntry(
  plan: Omit<LetterPlanInput, "kind" | "version">,
): NewsletterLetterPlan {
  return { ...letterPlanSchema.parse({ ...plan, kind: "letter-plan", version: 1 }) };
}
