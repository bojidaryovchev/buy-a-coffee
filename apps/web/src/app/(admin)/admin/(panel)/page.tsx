import Link from "next/link";
import { panelCounts } from "@/lib/admin-queries";
import { countAwaitingReply } from "@/lib/mail/store";

export const dynamic = "force-dynamic";

/**
 * What is waiting.
 *
 * Four numbers and four links. Every one of them counts something *owed* — new
 * enquiries, new messages, threads where the customer wrote last — rather than
 * something accumulated, because "how many orders have we ever taken" is not a
 * question anyone opens this panel to ask at nine in the morning.
 *
 * The newsletter tile is the exception and is deliberately a total: nothing is
 * owed to a subscriber, and the only useful fact about that list is how large
 * it is.
 */
export default async function AdminHomePage() {
  const [counts, waiting] = await Promise.all([panelCounts(), countAwaitingReply()]);

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
      href: "/admin/byuletin",
      label: "Абонати",
      value: counts.subscribers,
      note: "Активни абонати за бюлетина.",
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
