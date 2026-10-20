import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PromotionActions } from "@/components/admin/promotion-actions";
import { PromotionForm, type CategoryOption } from "@/components/admin/promotion-form";
import { toPriceView } from "@/lib/catalog/format";
import { listProductCardsByIds } from "@/lib/catalog/queries";
import {
  daysFromPeriod,
  formatDay,
  formatDayRange,
  sofiaDayOf,
  todayInSofia,
} from "@/lib/promotions/days";
import { loadEditorChoices } from "@/lib/promotions/editor-data";
import { describeProduct } from "@/lib/promotions/picker";
import {
  PROMOTION_NOTICES,
  PROMOTION_REFUSALS,
  PROMOTION_STATUS_LABEL,
  PROMOTION_STATUS_TONE,
  effectiveEnd,
  productsWord,
  promotionStatus,
} from "@/lib/promotions/status";
import { getPromotion, listMembers, promotionVersion } from "@/lib/promotions/store";

export const metadata: Metadata = { title: "Промоция" };
export const dynamic = "force-dynamic";

/**
 * One promotion. Upcoming or running, it opens in the editor — a running one
 * with its percentage and first day fixed — under a row of the other actions,
 * "Спри сега" first among them, where they are seen without scrolling.
 * Over (ended or stopped), it is the record of what it was and what it
 * covered, with the struck price each product was shown with, and "Дублирай".
 */

type Params = { izvestie?: string | string[]; otkaz?: string | string[] };

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

/** The record of a finished promotion lists this many products, then counts the rest. */
const RECORD_ROWS = 200;

export default async function AdminPromotionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Params>;
}) {
  const { id } = await params;
  const promotion = await getPromotion(id);
  if (!promotion) notFound();
  const query = await searchParams;
  const notice = PROMOTION_NOTICES[one(query.izvestie) ?? ""];
  const refusal = PROMOTION_REFUSALS[one(query.otkaz) ?? ""];

  const now = new Date();
  const today = todayInSofia(now);
  const status = promotionStatus(promotion, now);
  const { startDay, endDay } = daysFromPeriod(promotion);
  const members = await listMembers(promotion.id);
  const current = members.filter((member) => member.removedAt === null);

  const header = (
    <>
      <Link
        href="/admin/promotsii"
        className="inline-flex min-h-11 items-center text-sm text-pine-700 underline underline-offset-4 lg:min-h-7"
      >
        ← Промоции
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">{promotion.name}</h1>
          <p className="mt-1 text-sm text-ink-500 tabular-nums">
            −{promotion.percentOff}% · {formatDayRange(startDay, endDay)}
            {promotion.stoppedAt && (
              <> · спряна на {formatDay(sofiaDayOf(promotion.stoppedAt))}</>
            )}{" "}
            · {current.length} {productsWord(current.length)}
          </p>
        </div>
        <span
          className={`rounded-sm px-2 py-1 text-sm font-semibold ${PROMOTION_STATUS_TONE[status]}`}
        >
          {PROMOTION_STATUS_LABEL[status]}
        </span>
      </div>
      <PromotionActions promotionId={promotion.id} name={promotion.name} status={status} />
      {(notice || refusal) && (
        <p
          role="status"
          className={`mt-4 rounded-sm px-3 py-2 text-sm ${
            refusal ? "bg-caution-100 text-ink-900" : "bg-pine-100 text-ink-900"
          }`}
        >
          {refusal ?? notice}
        </p>
      )}
    </>
  );

  if (status === "upcoming" || status === "running") {
    const choices = await loadEditorChoices(promotion.targets);
    return (
      <>
        {header}
        {/* Keyed by the status: a save that starts the promotion (its first day
            moved to today) redraws the page as running, and the form must be
            rebuilt with the running rules, not keep the upcoming ones. */}
        <PromotionForm
          key={`${promotion.id}:${status}`}
          mode={status}
          today={today}
          initial={{
            id: promotion.id,
            version: promotionVersion(promotion),
            name: promotion.name,
            label: promotion.label ?? "",
            percent: String(promotion.percentOff),
            startDay,
            endDay,
            targets: promotion.targets,
          }}
          {...choices}
        />
      </>
    );
  }

  /* -- over: the record ------------------------------------------------------ */
  const [choices, cards] = await Promise.all([
    loadEditorChoices(promotion.targets),
    listProductCardsByIds(current.slice(0, RECORD_ROWS).map((member) => member.productId)),
  ]);
  const brandNames = choices.brands
    .filter((brand) => promotion.targets.brandIds.includes(brand.id))
    .map((brand) => (brand.inactive ? `${brand.name} (неактивна)` : brand.name));
  const flatCategories = (nodes: readonly CategoryOption[]): CategoryOption[] =>
    nodes.flatMap((node) => [node, ...flatCategories(node.children)]);
  const categoryNames = flatCategories(choices.categories)
    .filter((category) => promotion.targets.categoryIds.includes(category.id))
    .map((category) => (category.inactive ? `${category.name} (неактивна)` : category.name));
  const named = (ids: readonly string[]) =>
    ids.map((productId) => {
      const product = choices.chosenProducts[productId];
      return product ? describeProduct(product) : "продукт, който вече не се продава";
    });
  const ended = effectiveEnd(promotion);

  const facts: { term: string; value: string }[] = [
    { term: "Надпис за клиентите", value: promotion.label ?? "без надпис" },
    { term: "Отстъпка", value: `−${promotion.percentOff}%` },
    {
      term: "Период",
      value: promotion.stoppedAt
        ? `${formatDayRange(startDay, endDay)}, спряна на ${formatDay(sofiaDayOf(ended))} в ${ended.toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Sofia" })}`
        : formatDayRange(startDay, endDay),
    },
    { term: "Марки", value: brandNames.join(", ") || "—" },
    { term: "Категории", value: categoryNames.join(", ") || "—" },
    { term: "Отделни продукти", value: named(promotion.targets.productIds).join("; ") || "—" },
    {
      term: "Без тези продукти",
      value: named(promotion.targets.excludedProductIds).join("; ") || "—",
    },
  ];

  return (
    <>
      {header}
      <p className="mt-6 max-w-prose text-sm text-ink-500">
        Приключила промоция не се променя и не се трие: по нея се смята най-ниската цена за
        последните 30 дни при следващото намаление. За същото намаление отново — „Дублирай“.
      </p>
      <dl className="mt-4 grid max-w-3xl gap-x-6 gap-y-2 rounded-md border border-line bg-paper-raised p-5 text-sm sm:grid-cols-[12rem_1fr]">
        {facts.map((fact) => (
          <div key={fact.term} className="contents">
            <dt className="text-ink-500">{fact.term}</dt>
            <dd className="text-ink-900">{fact.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="members-title" className="mt-8">
        <h2 id="members-title" className="font-display text-xl font-semibold text-ink-900">
          Продукти в нея при края
        </h2>
        {current.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">Няма.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border border-line bg-paper-raised">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="border-b border-line text-left text-xs tracking-wide text-ink-500 uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Продукт</th>
                  <th className="px-4 py-3 font-medium">Най-ниската цена за 30-те дни преди нея</th>
                </tr>
              </thead>
              <tbody>
                {current.slice(0, RECORD_ROWS).map((member) => {
                  const card = cards.get(member.productId);
                  return (
                    <tr key={member.productId} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 text-ink-900">
                        {card
                          ? describeProduct({
                              title: card.title ?? card.name,
                              detail: card.detail ?? null,
                            })
                          : "Продукт, който вече не се продава"}
                      </td>
                      <td className="px-4 py-3 text-ink-700 tabular-nums">
                        {toPriceView(member.referencePrice, card?.price?.currency ?? "EUR")
                          ?.formatted ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {current.length > RECORD_ROWS && (
          <p className="mt-2 text-sm text-ink-500">
            + още {current.length - RECORD_ROWS} {productsWord(current.length - RECORD_ROWS)}
          </p>
        )}
      </section>
    </>
  );
}
