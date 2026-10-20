import type { Metadata } from "next";
import Link from "next/link";
import { EMPTY_PROMOTION_TARGETS } from "@catalog/db/schema";
import { PromotionForm, type PromotionFormValues } from "@/components/admin/promotion-form";
import { copyOfPromotion } from "@/lib/promotions/copy";
import { addDays, todayInSofia } from "@/lib/promotions/days";
import { loadEditorChoices } from "@/lib/promotions/editor-data";
import { getPromotion } from "@/lib/promotions/store";

export const metadata: Metadata = { title: "Нова промоция" };
export const dynamic = "force-dynamic";

/**
 * A new promotion, from today for a week at 10% unless the owner chooses
 * otherwise: the commonest case is one press of the dates away, and the
 * preview shows what the default would do before anything is saved.
 * "Запази" writes it and opens it in its own editor.
 *
 * `?ot=<id>` is "Дублирай": the same form filled in from that promotion,
 * starting tomorrow (`lib/promotions/copy.ts`). Nothing is written until
 * "Запази"; a percentage above 20% is asked about again, as for any new one.
 */

type Params = { ot?: string | string[] };

export default async function NewPromotionPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const today = todayInSofia();
  const { ot } = await searchParams;
  const source = typeof ot === "string" ? await getPromotion(ot) : null;

  const initial: PromotionFormValues = source
    ? { id: "", version: "", ...copyOfPromotion(source, today) }
    : {
        id: "",
        version: "",
        name: "",
        label: "",
        percent: "10",
        startDay: today,
        endDay: addDays(today, 6),
        targets: EMPTY_PROMOTION_TARGETS,
      };
  const choices = await loadEditorChoices(initial.targets);

  return (
    <>
      <Link
        href="/admin/promotsii"
        className="inline-flex min-h-11 items-center text-sm text-pine-700 underline underline-offset-4 lg:min-h-7"
      >
        ← Промоции
      </Link>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink-900">Нова промоция</h1>
      {source && (
        <p role="status" className="mt-4 rounded-sm bg-pine-100 px-3 py-2 text-sm text-ink-900">
          Копие на „{source.name}“: същите продукти и отстъпка, за същия брой дни, от утре.
          Проверете ги и натиснете „Запази промоцията“ — дотогава нищо не е създадено.
        </p>
      )}
      <PromotionForm mode="new" today={today} initial={initial} {...choices} />
    </>
  );
}
