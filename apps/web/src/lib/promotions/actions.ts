"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth";
import { splitErrors } from "@/lib/forms/admin-schemas";
import { formText } from "@/lib/forms/schemas";
import { addDays, daysFromPeriod, periodLength, todayInSofia } from "./days";
import { refreshPromotions } from "./refresh";
import { revalidateShop } from "./revalidate";
import {
  PROMOTION_FIELDS,
  PROMOTION_MAX_DAYS,
  PROMOTION_NAME_MAX,
  promotionFormSchema,
  type PromotionFormMode,
} from "./schemas";
import { promotionStatus } from "./status";
import {
  deletePromotion as deleteRow,
  getPromotion,
  insertPromotion,
  stopPromotion as stopRow,
  updatePromotion,
} from "./store";

/**
 * The promotions panel's actions: save the editor, stop a running promotion,
 * delete one that has not started, and start a copy of any.
 *
 * Each checks the session first: the panel's layout redirects a visitor who
 * is not signed in, but an action is a public endpoint, and these change
 * every price in the shop.
 *
 * After every write, all promotions are refreshed (`refresh.ts`: membership
 * and the 30-day lowest prices, which depend on one another) and the whole
 * shop is revalidated (`revalidate.ts`), so the owner who saves and opens the
 * product page sees the new price, not the one cached up to five minutes ago.
 *
 * What may change when is decided from the promotion as the database has it
 * at the press, not as the page showed it: a page opened before midnight may
 * be showing an upcoming promotion that is running by now.
 */

const SESSION_EXPIRED = "Сесията е изтекла. Влезте отново и опитайте пак.";
const MISSING = "Тази промоция вече не съществува. Презаредете страницата.";
const CHANGED_ELSEWHERE =
  "Промоцията е променена в друг раздел или прозорец, след като е отворена тук. Нищо не е записано: презаредете страницата.";
const OVER =
  "Тази промоция е приключила и не може да се променя. „Дублирай“ започва нова със същия избор.";
const LOCKED =
  "Промоцията вече тече: отстъпката и първият ден не могат да се променят. За друга отстъпка спрете тази и започнете нова.";
const NOT_REFRESHED =
  "Запазено, но цените в магазина не можаха да се обновят сега. Ще се обновят сами до час; ако искате веднага, запазете още веднъж.";

const LIST = "/admin/promotsii";
const editor = (id: string) => `${LIST}/${id}`;

export type PromotionFormState = {
  error?: string;
  /** Under the field each belongs to. */
  fieldErrors?: Record<string, string>;
  /** Written; when, for the line under the button. */
  savedAt?: string;
  /** The version this tab now holds (`promotionVersion`). */
  version?: string;
};

/**
 * Refresh and revalidate after a write. A refresh that fails leaves the write
 * standing — the hourly cron finishes it — and says so; the shop is
 * revalidated either way, since the write itself may have moved a price.
 */
async function afterChange(now: Date): Promise<boolean> {
  let refreshed = true;
  try {
    await refreshPromotions(now);
  } catch (error) {
    refreshed = false;
    console.error(
      JSON.stringify({
        level: "error",
        msg: "promotions.refresh_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  revalidateShop();
  revalidatePath(LIST);
  revalidatePath("/admin");
  return refreshed;
}

function formFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {
    id: formText(formData, "id"),
    version: formText(formData, "version"),
  };
  for (const name of PROMOTION_FIELDS) fields[name] = formText(formData, name);
  return fields;
}

/**
 * The editor's "Запази": a new promotion, or the one the editor was drawn
 * for, over the version it was drawn from. A new one opens in its own editor.
 */
export async function savePromotion(
  _previous: PromotionFormState,
  formData: FormData,
): Promise<PromotionFormState> {
  if (!(await isSignedIn())) return { error: SESSION_EXPIRED };
  const now = new Date();

  const id = formText(formData, "id");
  const existing = id ? await getPromotion(id) : null;
  if (id && !existing) return { error: MISSING };
  const status = existing ? promotionStatus(existing, now) : null;
  if (status === "ended" || status === "stopped") return { error: OVER };
  const mode: PromotionFormMode = status ?? "new";

  const parsed = promotionFormSchema(mode, todayInSofia(now)).safeParse(formFields(formData));
  if (!parsed.success) return splitErrors(parsed.error, PROMOTION_FIELDS);
  const draft = parsed.data;

  if (!existing) {
    const created = await insertPromotion(draft, now);
    await afterChange(now);
    redirect(`${editor(created)}?izvestie=zapazena`);
  }

  const outcome = await updatePromotion(existing.id, draft.version, draft, now);
  if (!outcome.ok) {
    switch (outcome.reason) {
      case "missing":
        return { error: MISSING };
      case "conflict":
        return { error: CHANGED_ELSEWHERE };
      case "over":
        return { error: OVER };
      case "locked":
        return { error: LOCKED };
    }
  }
  const refreshed = await afterChange(now);
  return {
    savedAt: now.toISOString(),
    version: outcome.version,
    ...(refreshed ? {} : { error: NOT_REFRESHED }),
  };
}

/** "Спри сега": the reduction ends at this moment. Only a running promotion. */
export async function stopPromotion(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");
  const id = formText(formData, "id");
  const now = new Date();
  const promotion = await getPromotion(id);
  if (!promotion) redirect(`${LIST}?otkaz=lipsva`);
  if (!(await stopRow(promotion.id, now))) redirect(`${editor(promotion.id)}?otkaz=ne-teche`);
  await afterChange(now);
  redirect(`${editor(promotion.id)}?izvestie=spryana`);
}

/** "Изтрий": only before the start; a started promotion is history. */
export async function deletePromotion(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");
  const id = formText(formData, "id");
  const now = new Date();
  const promotion = await getPromotion(id);
  if (!promotion) redirect(`${LIST}?otkaz=lipsva`);
  if (!(await deleteRow(promotion.id, now))) redirect(`${editor(promotion.id)}?otkaz=zapochnala`);
  await afterChange(now);
  redirect(`${LIST}?izvestie=iztrita`);
}

/**
 * "Дублирай": a new promotion with the same name (marked as a copy), words,
 * percentage and choice of products, for as many days, starting tomorrow —
 * so it is upcoming, every part of it can still be changed, and nothing
 * reaches the shop before the owner has looked at it. Opens in the editor.
 */
export async function duplicatePromotion(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");
  const id = formText(formData, "id");
  const now = new Date();
  const source = await getPromotion(id);
  if (!source) redirect(`${LIST}?otkaz=lipsva`);

  const { startDay, endDay } = daysFromPeriod(source);
  const length = Math.min(Math.max(periodLength(startDay, endDay), 1), PROMOTION_MAX_DAYS);
  const start = addDays(todayInSofia(now), 1);
  const suffix = " (копие)";
  const created = await insertPromotion(
    {
      name: `${source.name.slice(0, PROMOTION_NAME_MAX - suffix.length)}${suffix}`,
      label: source.label,
      percentOff: source.percentOff,
      startDay: start,
      endDay: addDays(start, length - 1),
      targets: source.targets,
    },
    now,
  );
  await afterChange(now);
  redirect(`${editor(created)}?izvestie=kopie`);
}
