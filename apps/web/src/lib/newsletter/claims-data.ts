import "server-only";
import { inArray } from "drizzle-orm";
import { promotions, type NewsletterCampaignAttachment } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { isUuid } from "./campaigns";
import type { NamedPromotion, PlannedPromotion, PromotionFacts } from "./claims";
import { letterPlanOf } from "./letter-plan";

/**
 * The facts `claimNotes` checks a letter against (`claims.ts`), read from the
 * database: the promotion a letter announces and the ones its plan says it
 * names, each as written (`letter-plan.ts`) and as it stands now. One read,
 * for the composer's page, the send's press and the top of every run.
 */

export type PromotionRow = {
  id: string;
  name: string;
  label: string | null;
  percentOff: number;
  startsAt: Date;
  endsAt: Date;
  stoppedAt: Date | null;
};

const promotionColumns = {
  id: promotions.id,
  name: promotions.name,
  label: promotions.label,
  percentOff: promotions.percentOff,
  startsAt: promotions.startsAt,
  endsAt: promotions.endsAt,
  stoppedAt: promotions.stoppedAt,
};

/** These promotions as they stand, soonest to end first; an id that names none is absent. */
export async function promotionFacts(ids: readonly (string | null)[]): Promise<PromotionRow[]> {
  const wanted = [
    ...new Set(ids.filter((id): id is string => typeof id === "string" && isUuid(id))),
  ];
  if (wanted.length === 0) return [];
  return db
    .select(promotionColumns)
    .from(promotions)
    .where(inArray(promotions.id, wanted))
    .orderBy(promotions.endsAt, promotions.id);
}

export interface LetterPromotions {
  readonly announced: PromotionFacts | null;
  readonly announcedPlan: PlannedPromotion | null;
  readonly announcedMissing: boolean;
  readonly named: NamedPromotion[];
}

/** What a campaign's words promise about promotions, and what those promotions are now. */
export async function letterPromotions(campaign: {
  template: string | null;
  promotionId: string | null;
  attachments: readonly NewsletterCampaignAttachment[];
}): Promise<LetterPromotions> {
  const plan = letterPlanOf(campaign.attachments);
  const planned = plan?.named ?? [];
  const rows = await promotionFacts([campaign.promotionId, ...planned.map((item) => item.id)]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const announced = campaign.promotionId ? (byId.get(campaign.promotionId) ?? null) : null;
  return {
    announced,
    announcedPlan: plan?.announced ?? null,
    announcedMissing: campaign.template === "promotion" && !announced,
    named: planned.map((item) => ({ planned: item, current: byId.get(item.id) ?? null })),
  };
}
