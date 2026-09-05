import type { Metadata } from "next";
import { listSubscribers } from "@/lib/admin-queries";
import { unsubscribeSubscriber } from "@/lib/admin-actions";

export const metadata: Metadata = { title: "Бюлетин" };
export const dynamic = "force-dynamic";

/**
 * Newsletter subscribers.
 *
 * A list and one action, and deliberately nothing else. This screen does not
 * send a newsletter and should not grow into something that does: a broadcast
 * tool needs unsubscribe links in every message, bounce handling, suppression
 * lists and a sending reputation to protect, and building a bad one here would
 * put the shop's transactional mail — the order replies that actually matter —
 * behind the same domain reputation as an untended bulk sender.
 *
 * What it is for is the two things that cannot be done anywhere else: seeing who
 * is on the list, and taking somebody off it when they ask by phone or in a
 * reply rather than by clicking a link.
 *
 * `consentSource` and `consentAt` are shown because they are the record that
 * makes acting on a subscription lawful. Unsubscribing stamps a date rather than
 * deleting the row, so that record survives the unsubscribe — see
 * `unsubscribeSubscriber`.
 */
export default async function AdminNewsletterPage() {
  const subscribers = await listSubscribers();
  const active = subscribers.filter((s) => !s.unsubscribedAt);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">Бюлетин</h1>
          <p className="mt-1 max-w-prose text-base text-ink-500">
            Списъкът и нищо повече — от тук не се изпраща бюлетин. Отписването се записва с дата, а
            не изтрива съгласието.
          </p>
        </div>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{active.length}</span>{" "}
          <span className="text-ink-500">активни</span>
        </p>
      </div>

      {subscribers.length === 0 ? (
        <p className="mt-10 rounded-md border border-dashed border-line-strong bg-paper-raised p-10 text-center text-ink-500">
          Още няма абонати.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-md border border-line bg-paper-raised">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-line text-left text-xs tracking-wide text-ink-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Имейл</th>
                <th className="px-4 py-3 font-medium">Съгласие</th>
                <th className="px-4 py-3 font-medium">Източник</th>
                <th className="px-4 py-3 font-medium">Състояние</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map((subscriber) => (
                <tr key={subscriber.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink-900">{subscriber.email}</td>
                  <td className="px-4 py-3 text-ink-500 tabular-nums">
                    {subscriber.consentAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-ink-500">{subscriber.consentSource ?? "—"}</td>
                  <td className="px-4 py-3">
                    {subscriber.unsubscribedAt ? (
                      <span className="text-ink-500">
                        отписан {subscriber.unsubscribedAt.toISOString().slice(0, 10)}
                      </span>
                    ) : (
                      <form action={unsubscribeSubscriber}>
                        <input type="hidden" name="id" value={subscriber.id} />
                        <button
                          type="submit"
                          className="min-h-11 rounded-sm border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-900"
                        >
                          Отпиши
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
