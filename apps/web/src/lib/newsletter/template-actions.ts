"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth";
import { formText } from "@/lib/forms/schemas";
import { createDraft } from "./campaigns";
import { letterPlanEntry } from "./letter-plan";
import { monthlyPlan, promotionPlan } from "./template-data";
import { monthlyLetter, promotionLetter } from "./templates";

/**
 * "Нов бюлетин" from a starting point: the monthly letter, a promotion's
 * announcement, or a blank page (`templates.ts`).
 *
 * The form sends `template` ("monthly" | "promotion" | "blank") and, for a
 * promotion, `promotionId`. The promotions panel's "Обяви в бюлетина" posts
 * here too. Creates the draft and opens it.
 *
 * The letter is written from the catalog as it is at the press, and is the
 * owner's from then on: the draft remembers what it was started from
 * (`template`, `promotion_id`) and its plan — when the data was read, which
 * promotions it names, what was left out and why (`letter-plan.ts`) — which
 * the send's checks and the next monthly letter read. A
 * promotion that has ended or been stopped, an id that names none, or a
 * promotion none of whose products can carry its reduction on their own
 * badge (no 30-day price history yet, cheaper lately, sold out) is not
 * announced: the press lands back on the newsletter page, which says why.
 */
export async function createNewsletterFromTemplate(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");

  const chosen = formText(formData, "template");
  let id: string;
  if (chosen === "monthly") {
    const plan = await monthlyPlan();
    id = await createDraft({
      ...monthlyLetter(plan.input),
      template: chosen,
      attachments: [letterPlanEntry(plan.plan)],
    });
  } else if (chosen === "promotion") {
    const promotionId = formText(formData, "promotionId");
    const plan = await promotionPlan(promotionId);
    if (!plan) redirect("/admin/byuletin?promotsiya=nyama");
    /* No product whose own badge carries the reduction: a letter that says
       "−20%" over nothing is not started; the list says why. */
    if (plan.empty) redirect(`/admin/byuletin?promotsiya=prazna&p=${plan.row.id}`);
    id = await createDraft({
      ...promotionLetter(plan.input),
      template: chosen,
      promotionId: plan.row.id,
      attachments: [letterPlanEntry(plan.plan)],
    });
  } else {
    id = await createDraft();
  }
  revalidatePath("/admin/byuletin");
  redirect(`/admin/byuletin/${id}`);
}
