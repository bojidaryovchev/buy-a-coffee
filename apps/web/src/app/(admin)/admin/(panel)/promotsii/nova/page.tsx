import type { Metadata } from "next";
import Link from "next/link";
import { EMPTY_PROMOTION_TARGETS } from "@catalog/db/schema";
import { PromotionForm } from "@/components/admin/promotion-form";
import { addDays, todayInSofia } from "@/lib/promotions/days";
import { loadEditorChoices } from "@/lib/promotions/editor-data";

export const metadata: Metadata = { title: "Нова промоция" };
export const dynamic = "force-dynamic";

/**
 * A new promotion, from today for a week at 10% unless the owner chooses
 * otherwise: the commonest case is one press of the dates away, and the
 * preview shows what the default would do before anything is saved.
 * "Запази" writes it and opens it in its own editor.
 */
export default async function NewPromotionPage() {
  const today = todayInSofia();
  const choices = await loadEditorChoices(EMPTY_PROMOTION_TARGETS);
  return (
    <>
      <Link
        href="/admin/promotsii"
        className="inline-flex min-h-11 items-center text-sm text-pine-700 underline underline-offset-4 lg:min-h-7"
      >
        ← Промоции
      </Link>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink-900">Нова промоция</h1>
      <PromotionForm
        mode="new"
        today={today}
        initial={{
          id: "",
          version: "",
          name: "",
          label: "",
          percent: "10",
          startDay: today,
          endDay: addDays(today, 6),
          targets: EMPTY_PROMOTION_TARGETS,
        }}
        {...choices}
      />
    </>
  );
}
