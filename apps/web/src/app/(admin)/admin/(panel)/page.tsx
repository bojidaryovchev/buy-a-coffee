import Link from "next/link";
import { panelCounts } from "@/lib/admin-queries";
import { countAwaitingReply } from "@/lib/mail/store";
import { newsletterNextStep, type NextStep } from "@/lib/newsletter/campaigns";
import { periodMonthName, dayWords } from "@/lib/newsletter/sofia";
import { formatDay, sofiaDayOf } from "@/lib/promotions/days";
import { promotionSummary } from "@/lib/promotions/store";

export const dynamic = "force-dynamic";

/**
 * What is waiting.
 *
 * A number and a link per screen. All but two count something *owed* — new
 * enquiries, new messages, threads where the customer wrote last — rather than
 * something accumulated, because "how many orders have we ever taken" is not a
 * question anyone opens this panel to ask at nine in the morning.
 *
 * The newsletter tile is the exception and is deliberately a total: nothing is
 * owed to a subscriber, and the only useful fact about that list is how large
 * it is. Under it, the newsletter's next step — a send that stopped, the
 * draft waiting to be checked, or when the last letter went out — and the
 * tile leads there.
 *
 * The promotions tile is the other: what is on sale at a reduced price now,
 * and when the first of it ends — the question before a customer calls.
 */

/** The newsletter's next step, in a line, and where the tile leads for it. */
function newsletterNote(step: NextStep): { note: string; href: string } {
  if (!step) return { note: "Още няма изпратен бюлетин.", href: "/admin/byuletin" };
  switch (step.kind) {
    case "stalled":
      return {
        note: `Изпращането на „${step.subject || "без тема"}“ е прекъснато — продължете го.`,
        href: `/admin/byuletin/${step.id}`,
      };
    case "draft":
      return {
        note: step.autoPeriod
          ? `Бюлетинът за ${periodMonthName(step.autoPeriod)} е готов за преглед.`
          : `Чернова чака: „${step.subject || "без тема"}“.`,
        href: `/admin/byuletin/${step.id}`,
      };
    case "sent":
      return {
        note: `Последният бюлетин тръгна на ${dayWords(step.at)}.`,
        href: "/admin/byuletin",
      };
  }
}
export default async function AdminHomePage() {
  const now = new Date();
  const [counts, waiting, nextStep, promotions] = await Promise.all([
    panelCounts(),
    countAwaitingReply(),
    newsletterNextStep(),
    promotionSummary(now),
  ]);
  const newsletter = newsletterNote(nextStep);
  const upcomingNote = `Предстоящи: ${promotions.upcoming}.`;

  const tiles = [
    {
      href: "/admin/zayavki",
      label: "Нови заявки",
      value: counts.newOrders,
      note: "Заявки за поръчка, които още никой не е потърсил.",
    },
    {
      href: "/admin/poshta",
      label: "Чакат отговор",
      value: waiting,
      note: "Разговори, в които последната дума е тяхна.",
    },
    {
      href: "/admin/sabshteniya",
      label: "Нови съобщения",
      value: counts.newContacts,
      note: "От формата за контакт.",
    },
    {
      href: newsletter.href,
      label: "Абонати",
      value: counts.subscribers,
      note: `Активни абонати за бюлетина. ${newsletter.note}`,
    },
    {
      href: "/admin/promotsii",
      label: "Текущи промоции",
      value: promotions.running,
      note: promotions.nearestEnd
        ? `Най-скоро свършва на ${formatDay(sofiaDayOf(promotions.nearestEnd.getTime() - 1), { year: false })}. ${upcomingNote}`
        : upcomingNote,
    },
  ];

  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink-900">Администрация</h1>
      <p className="mt-1 text-base text-ink-500">Какво чака.</p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <li key={tile.href}>
            <Link
              href={tile.href}
              className="block h-full rounded-md border border-line bg-paper-raised p-5 transition-colors hover:border-line-strong"
            >
              <p className="font-display text-4xl font-semibold text-ink-900 tabular-nums">
                {tile.value}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink-900">{tile.label}</p>
              <p className="mt-1 text-sm text-ink-500">{tile.note}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
