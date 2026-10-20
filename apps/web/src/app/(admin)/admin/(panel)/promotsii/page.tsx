import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/primitives";
import { daysFromPeriod, formatDay, formatDayRange, sofiaDayOf } from "@/lib/promotions/days";
import {
  PROMOTION_NOTICES,
  PROMOTION_REFUSALS,
  PROMOTION_STATUS_LABEL,
  PROMOTION_STATUS_TONE,
  productsWord,
} from "@/lib/promotions/status";
import { listPromotions, type PromotionListRow } from "@/lib/promotions/store";

export const metadata: Metadata = { title: "Промоции" };
export const dynamic = "force-dynamic";

/**
 * The shop's own promotions: what runs now, what is coming, what is over.
 *
 * A promotion takes a percentage off chosen brands, categories and products
 * for a run of days, for every customer alike; the shop switches it on and
 * off by itself (`lib/catalog/price-sql.ts`). Each row opens the editor
 * (`/admin/promotsii/[id]`). What is over is folded: it is history, kept
 * because the next reduction's struck price is computed from it, and the
 * place to start a copy from, but not what the owner opens this screen for.
 */

type Params = { izvestie?: string | string[]; otkaz?: string | string[] };

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

/** How many finished promotions are listed; the rest are older than anyone asks about. */
const PAST_LIMIT = 100;

function PromotionList({ rows }: { rows: readonly PromotionListRow[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {rows.map((promotion) => {
        const { startDay, endDay } = daysFromPeriod(promotion);
        const stoppedDay = promotion.stoppedAt ? sofiaDayOf(promotion.stoppedAt) : null;
        return (
          <li key={promotion.id}>
            <Link
              href={`/admin/promotsii/${promotion.id}`}
              className="block rounded-md border border-line bg-paper-raised p-4 transition-colors hover:border-ink-300"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <p className="font-semibold text-ink-900">
                  {promotion.name}
                  <span
                    className={`ml-2 rounded-sm px-1.5 py-0.5 align-middle text-xs font-semibold ${PROMOTION_STATUS_TONE[promotion.status]}`}
                  >
                    {PROMOTION_STATUS_LABEL[promotion.status]}
                  </span>
                </p>
                <p className="font-display text-xl font-semibold text-clay-600 tabular-nums">
                  −{promotion.percentOff}%
                </p>
              </div>
              <p className="mt-1 text-sm text-ink-500 tabular-nums">
                {[
                  formatDayRange(startDay, endDay),
                  stoppedDay ? `спряна на ${formatDay(stoppedDay)}` : null,
                  `${promotion.productCount} ${productsWord(promotion.productCount)}`,
                  promotion.label ? `надпис „${promotion.label}“` : "без надпис",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function AdminPromotionsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const notice = PROMOTION_NOTICES[one(params.izvestie) ?? ""];
  const refusal = PROMOTION_REFUSALS[one(params.otkaz) ?? ""];

  const now = new Date();
  const all = await listPromotions(now);
  const running = all.filter((promotion) => promotion.status === "running");
  // Soonest first: the next one to start is the one to check.
  const upcoming = all.filter((promotion) => promotion.status === "upcoming").reverse();
  const past = all
    .filter((promotion) => promotion.status === "ended" || promotion.status === "stopped")
    .slice(0, PAST_LIMIT);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">Промоции</h1>
          <p className="mt-1 max-w-prose text-base text-ink-500">
            Намаления, които вие избирате: процент от цената на избрани марки, категории или
            продукти, за определени дни. Всеки купувач вижда една и съща цена; промоцията се включва
            и спира сама.
          </p>
        </div>
        <ButtonLink href="/admin/promotsii/nova">Нова промоция</ButtonLink>
      </div>

      {(notice || refusal) && (
        <p
          role="status"
          className={`mt-6 rounded-sm px-3 py-2 text-sm ${
            refusal ? "bg-caution-100 text-ink-900" : "bg-pine-100 text-ink-900"
          }`}
        >
          {refusal ?? notice}
        </p>
      )}

      <section aria-labelledby="running-title" className="mt-8">
        <h2 id="running-title" className="font-display text-xl font-semibold text-ink-900">
          Активни
        </h2>
        {running.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-line-strong bg-paper-raised p-6 text-center text-ink-500">
            В момента не тече промоция.
          </p>
        ) : (
          <PromotionList rows={running} />
        )}
      </section>

      <section aria-labelledby="upcoming-title" className="mt-8">
        <h2 id="upcoming-title" className="font-display text-xl font-semibold text-ink-900">
          Предстоящи
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-line-strong bg-paper-raised p-6 text-center text-ink-500">
            Няма насрочени промоции.
          </p>
        ) : (
          <PromotionList rows={upcoming} />
        )}
      </section>

      <details className="mt-8 rounded-md border border-line bg-paper-raised p-4">
        <summary className="cursor-pointer font-display text-xl font-semibold text-ink-900">
          Приключили <span className="text-base font-normal text-ink-500">({past.length})</span>
        </summary>
        <p className="mt-2 max-w-prose text-sm text-ink-500">
          Приключилите не се трият: по тях се смята най-ниската цена за последните 30 дни, която
          магазинът показва зачертана при следващото намаление. От всяка може да започнете нова със
          същия избор — „Дублирай“.
        </p>
        {past.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">Още няма приключили промоции.</p>
        ) : (
          <PromotionList rows={past} />
        )}
      </details>
    </>
  );
}
