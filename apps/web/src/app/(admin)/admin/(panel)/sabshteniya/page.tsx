import type { Metadata } from "next";
import Link from "next/link";
import { listContacts } from "@/lib/admin-queries";
import { INQUIRY_STATUS_LABEL, type InquiryStatus } from "@/lib/inquiry-status";

export const metadata: Metadata = { title: "Съобщения" };
export const dynamic = "force-dynamic";

/**
 * Contact-form messages.
 *
 * A separate screen from Заявки rather than one list with a type column,
 * because the two are answered differently: an order enquiry is a phone call
 * about a product, and this is a written question that usually wants a written
 * answer. Merging them would mean one list sorted by time in which the operator
 * has to read each row to know which of two jobs it is.
 *
 * The message itself is on the list, one line of it. Unlike a phone number, the
 * useful fact here is what was actually asked, and a subject line alone is
 * routinely empty — the form does not require one.
 */

const STATUS_TONE: Record<InquiryStatus, string> = {
  new: "bg-clay-100 text-clay-600",
  contacted: "bg-pine-100 text-pine-700",
  converted: "bg-pine-100 text-pine-700",
  cancelled: "bg-paper-sunken text-ink-500",
  spam: "bg-paper-sunken text-ink-500",
};

export default async function AdminContactsPage() {
  const messages = await listContacts();
  const fresh = messages.filter((m) => m.status === "new").length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink-900">Съобщения</h1>
          <p className="mt-1 text-base text-ink-500">От формата за контакт.</p>
        </div>
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{fresh}</span>{" "}
          <span className="text-ink-500">нови</span>
        </p>
      </div>

      {messages.length === 0 ? (
        <p className="mt-10 rounded-md border border-dashed border-line-strong bg-paper-raised p-10 text-center text-ink-500">
          Още няма съобщения.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {messages.map((message) => (
            <li key={message.id}>
              <Link
                href={`/admin/sabshteniya/${message.id}`}
                className={`block rounded-md border bg-paper-raised p-4 transition-colors hover:border-ink-300 ${
                  message.status === "new" ? "border-line-strong" : "border-line opacity-80"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <p className="font-semibold text-ink-900">
                    {message.name || message.email || "Без име"}
                    <span
                      className={`ml-2 rounded-sm px-1.5 py-0.5 align-middle text-xs font-semibold ${STATUS_TONE[message.status as InquiryStatus]}`}
                    >
                      {INQUIRY_STATUS_LABEL[message.status as InquiryStatus]}
                    </span>
                  </p>
                  <p className="text-sm text-ink-500 tabular-nums">
                    {message.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </p>
                </div>

                {message.subject && (
                  <p className="mt-1 text-sm font-medium text-ink-700">{message.subject}</p>
                )}
                <p className="mt-0.5 line-clamp-1 text-sm text-ink-500">{message.message}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
