"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth";
import { formText } from "@/lib/forms/schemas";
import { createDraft } from "./campaigns";
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
 * (`template`, `promotion_id`) and nothing else ties it to the data. A
 * promotion that has ended or been stopped, or an id that names none, is not
 * announced: the press lands back on the newsletter page, which says why.
 */
export async function createNewsletterFromTemplate(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");

  const chosen = formText(formData, "template");
  let id: string;
  if (chosen === "monthly") {
    const plan = await monthlyPlan();
    id = await createDraft({ ...monthlyLetter(plan.input), template: chosen });
  } else if (chosen === "promotion") {
    const promotionId = formText(formData, "promotionId");
    const plan = await promotionPlan(promotionId);
    if (!plan) redirect("/admin/byuletin?promotsiya=nyama");
    id = await createDraft({
      ...promotionLetter(plan.input),
      template: chosen,
      promotionId: plan.row.id,
    });
  } else {
    id = await createDraft();
  }
  revalidatePath("/admin/byuletin");
  redirect(`/admin/byuletin/${id}`);
}
