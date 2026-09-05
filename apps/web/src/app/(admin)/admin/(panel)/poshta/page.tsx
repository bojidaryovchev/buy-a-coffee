import type { Metadata } from "next";
import Link from "next/link";
import { MAIL_ADDRESS } from "@/lib/mail/identity";
import { listThreads, type MailThreadSummary } from "@/lib/mail/store";

export const metadata: Metadata = { title: "Поща" };
export const dynamic = "force-dynamic";

/**
 * The `info@` inbox.
 *
 * Sorted by activity, not by arrival, and counted at the top by what still owes
 * an answer. The one question this screen exists to answer is "who is waiting on
 * me", and a plain reverse-chronological list answers it only by accident — the
 * oldest unanswered message is the one furthest down.
 */

/** Waiting on us: still open, and the last word was theirs. */
const awaitingReply = (t: MailThreadSummary): boolean =>
  t.status === "open" && t.lastDirection === "in";

export default async function AdminMailboxPage() {
  const threads = await listThreads();
  const waiting = threads.filter(awaitingReply);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">Поща</h1>
          <p className="mt-1 text-base text-ink-500">
            Всичко, писано до {MAIL_ADDRESS}. Отговорът тръгва от същия адрес.
          </p>
        </div>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{waiting.length}</span>{" "}
          <span className="text-ink-500">чакат отговор</span>
        </p>
      </div>

      {threads.length === 0 ? (
        <div className="mt-10 rounded-md border border-dashed border-line-strong bg-paper-raised p-10 text-center">
          <p className="text-ink-500">Още няма получена поща.</p>
          {/**
           * The empty state names the DNS first because that is the likeliest
           * cause by a wide margin, and because an empty inbox and an inbox that
           * cannot receive look identical from here.
           */}
          <p className="mx-auto mt-2 max-w-prose text-sm text-ink-500">
            Проверете дали {MAIL_ADDRESS} изобщо приема поща: домейнът има нужда от MX запис в
            Resend, иначе писмата се отказват още при подателя. След това — дали е настроен webhook
            за <code className="font-mono">email.received</code> и дали е зададен
            RESEND_WEBHOOK_SECRET.
          </p>
          <p className="mx-auto mt-4 max-w-prose text-sm text-ink-500">
            Заявките и съобщенията от формите не идват тук. Отговорът на такова от{" "}
            <Link href="/admin/zayavki" className="underline">
              Заявки
            </Link>{" "}
            или{" "}
            <Link href="/admin/sabshteniya" className="underline">
              Съобщения
            </Link>{" "}
            отваря разговор, който после се появява на тази страница.
          </p>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/admin/poshta/${thread.id}`}
                className={`block rounded-md border bg-paper-raised p-4 transition-colors hover:border-ink-300 ${
                  awaitingReply(thread) ? "border-line-strong" : "border-line opacity-80"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <p className="font-semibold text-ink-900">
                    {thread.correspondentName ?? thread.correspondent}
                    {awaitingReply(thread) && (
                      <span className="ml-2 rounded-sm bg-clay-100 px-1.5 py-0.5 align-middle text-xs font-semibold text-clay-600">
                        чака отговор
                      </span>
                    )}
                    {thread.status === "done" && (
                      <span className="ml-2 align-middle text-xs font-normal text-ink-500">
                        приключена
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-ink-500 tabular-nums">
                    {thread.lastMessageAt.slice(0, 16).replace("T", " ")}
                    {thread.messageCount > 1 && ` · ${thread.messageCount} писма`}
                  </p>
                </div>

                <p className="mt-1 text-sm font-medium text-ink-700">{thread.subject}</p>
                {thread.snippet && (
                  <p className="mt-0.5 line-clamp-1 text-sm text-ink-500">
                    {thread.lastDirection === "out" && "Вие: "}
                    {thread.snippet}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
