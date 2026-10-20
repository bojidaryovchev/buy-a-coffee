"use server";

import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth";

/**
 * "Нов бюлетин" from a starting point: the monthly letter, a promotion's
 * announcement, or a blank page (`templates.ts`).
 *
 * The form sends `template` ("monthly" | "promotion" | "blank") and, for a
 * promotion, `promotionId`. The promotions panel's "Обяви в бюлетина" posts
 * here too. Creates the draft and opens it.
 */
export async function createNewsletterFromTemplate(_formData: FormData): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");
  // Contract only: the newsletter workstream fills this in.
  throw new Error("createNewsletterFromTemplate is not implemented yet");
}
