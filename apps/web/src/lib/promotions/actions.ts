"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth";
import { db } from "@/lib/db";
import { splitErrors } from "@/lib/forms/admin-schemas";
import { formText } from "@/lib/forms/schemas";
import { todayInSofia } from "./days";
import type { Executor } from "./history";
import { lockPromotions, refreshWithin } from "./refresh";
import { revalidateShop } from "./revalidate";
import { PROMOTION_FIELDS, promotionFormSchema, type PromotionFormMode } from "./schemas";
import { promotionStatus } from "./status";
import {
  deletePromotion as deleteRow,
  getPromotion,
  insertPromotion,
  stopPromotion as stopRow,
  updatePromotion,
  type UpdateOutcome,
} from "./store";

/**
 * The promotions panel's actions: save the editor, stop a running promotion,
 * delete one that has not started. ("Дублирай" is a link: it opens the
 * new-promotion editor filled in, and writes nothing.)
 *
 * Each checks the session first: the panel's layout redirects a visitor who
 * is not signed in, but an action is a public endpoint, and these change
 * every price in the shop.
 *
 * Each write and the refresh after it (`refresh.ts`: membership and the
 * 30-day lowest prices, for all promotions, which depend on one another) are
 * one transaction, under the promotions lock taken before the write. So the
 * shop never sees new dates or products beside old references: if the
 * refresh fails, the write is undone and the owner is told nothing changed.
 * Only once it is committed is the whole shop revalidated (`revalidate.ts`),
 * so the owner who saves and opens the product page sees the new price, not
 * the one cached up to five minutes ago.
 *
 * What may change when is decided from the promotion as the database has it
 * at the press, not as the page showed it: a page opened before midnight may
 * be showing an upcoming promotion that is running by now.
 */

const SESSION_EXPIRED = "Сесията е изтекла. Влезте отново и опитайте пак.";
const MISSING = "Тази промоция вече не съществува. Презаредете страницата.";
const CHANGED_ELSEWHERE =
  "Промоцията е променена в друг раздел или прозорец, след като отворихте тази страница, и нищо не е записано. Вашите промени са още тук: натиснете „Запази“ отново, за да ги запишете върху другите, или презаредете страницата, за да видите другите.";
const OVER =
  "Тази промоция е приключила и не може да се променя. „Дублирай“ започва нова със същия избор.";
const LOCKED =
  "Промоцията вече тече: отстъпката и първият ден не могат да се променят. За друга отстъпка спрете тази и започнете нова.";
const NOT_SAVED =
  "Нищо не е записано: цените в магазина не можаха да се обновят. Опитайте отново след минута.";

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
  /**
   * Someone else saved first. The tab keeps what was typed and takes this
   * version, so the next press writes over theirs, knowingly.
   */
  conflictVersion?: string;
};

/**
 * One write and the refresh it needs, as one transaction under the lock. A
 * write that changes nothing (`changed` false) commits nothing and skips the
 * refresh. Throws whatever the write or the refresh threw, after the rollback.
 */
async function writeAndRefresh<T>(
  now: Date,
  write: (tx: Executor) => Promise<T>,
  changed: (result: T) => boolean,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockPromotions(tx);
    const result = await write(tx);
    if (changed(result)) await refreshWithin(tx, now);
    return result;
  });
}

function logFailure(action: string, error: unknown): void {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "promotions.write_failed",
      action,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

/** After a committed write: the shop, the list and the dashboard drawn afresh. */
function revalidateAfterWrite(): void {
  revalidateShop();
  revalidatePath(LIST);
  revalidatePath("/admin");
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
    let created: string;
    try {
      created = await writeAndRefresh(
        now,
        (tx) => insertPromotion(tx, draft, now),
        () => true,
      );
    } catch (error) {
      logFailure("create", error);
      return { error: NOT_SAVED };
    }
    revalidateAfterWrite();
    redirect(`${editor(created)}?izvestie=zapazena`);
  }

  let outcome: UpdateOutcome;
  try {
    outcome = await writeAndRefresh(
      now,
      (tx) => updatePromotion(tx, existing.id, draft.version, draft, now),
      (result) => result.ok,
    );
  } catch (error) {
    logFailure("save", error);
    return { error: NOT_SAVED };
  }
  if (!outcome.ok) {
    switch (outcome.reason) {
      case "missing":
        return { error: MISSING };
      case "conflict":
        return { error: CHANGED_ELSEWHERE, conflictVersion: outcome.version };
      case "over":
        return { error: OVER };
      case "locked":
        return { error: LOCKED };
    }
  }
  revalidateAfterWrite();
  return { savedAt: now.toISOString(), version: outcome.version };
}

/** "Спри сега": the reduction ends at this moment. Only a running promotion. */
export async function stopPromotion(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");
  const id = formText(formData, "id");
  const now = new Date();
  const promotion = await getPromotion(id);
  if (!promotion) redirect(`${LIST}?otkaz=lipsva`);
  let stopped: boolean;
  try {
    stopped = await writeAndRefresh(
      now,
      (tx) => stopRow(tx, promotion.id, now),
      (done) => done,
    );
  } catch (error) {
    logFailure("stop", error);
    redirect(`${editor(promotion.id)}?otkaz=greshka`);
  }
  if (!stopped) redirect(`${editor(promotion.id)}?otkaz=ne-teche`);
  revalidateAfterWrite();
  redirect(`${editor(promotion.id)}?izvestie=spryana`);
}

/** "Изтрий": only before the start; a started promotion is history. */
export async function deletePromotion(formData: FormData): Promise<void> {
  if (!(await isSignedIn())) redirect("/admin/vhod");
  const id = formText(formData, "id");
  const now = new Date();
  const promotion = await getPromotion(id);
  if (!promotion) redirect(`${LIST}?otkaz=lipsva`);
  let deleted: boolean;
  try {
    deleted = await writeAndRefresh(
      now,
      (tx) => deleteRow(tx, promotion.id, now),
      (done) => done,
    );
  } catch (error) {
    logFailure("delete", error);
    redirect(`${editor(promotion.id)}?otkaz=greshka`);
  }
  if (!deleted) redirect(`${editor(promotion.id)}?otkaz=zapochnala`);
  revalidateAfterWrite();
  redirect(`${LIST}?izvestie=iztrita`);
}
