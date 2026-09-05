import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContact } from "@/lib/admin-queries";
import { updateContactStatus } from "@/lib/admin-actions";
import type { InquiryStatus } from "@/lib/inquiry-status";
import { MAIL_ADDRESS } from "@/lib/mail/identity";
import { recordReference } from "@/lib/mail/reply";
import { StatusPicker } from "@/components/admin/status-picker";
import { RecordReplyForm } from "@/components/admin/record-reply-form";

export const metadata: Metadata = { title: "Съобщение" };
export const dynamic = "force-dynamic";

/**
 * One contact-form message.
 *
 * The message body is rendered with `whitespace-pre-wrap` and nothing else. It
 * is text a stranger typed into a textarea, and it goes on the page as text —
 * the same rule the mail thread view applies to a message body, for the same
 * reason.
 *
 * The email is validated as required by `contactSchema`, so unlike an order
 * enquiry there is always somebody to reply to. The nullable column is a
 * database-level nicety rather than a state this screen expects, which is why
 * the fallback below is terse rather than a designed empty state.
 */
export default async function AdminContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const message = await getContact(id);
  if (!message) notFound();

  return (
    <>
      <Link href="/admin/sabshteniya" className="text-sm text-ink-500 hover:text-ink-900">
        ← Всички съобщения
      </Link>

      <div className="mt-4">
        <h1 className="font-display text-2xl font-semibold text-ink-900">
          {message.subject || "Съобщение без тема"}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {message.name || "Без име"}
          {message.email && ` · ${message.email}`}
          {message.phone && ` · ${message.phone}`}
        </p>
        <p className="mt-0.5 text-sm text-ink-500">
          Референция {recordReference(message.id)} ·{" "}
          {message.createdAt.toISOString().slice(0, 16).replace("T", " ")}
        </p>
      </div>

      <div className="mt-6 rounded-md border border-line-strong bg-paper-raised p-5">
        <p className="leading-relaxed whitespace-pre-wrap text-ink-700">{message.message}</p>
      </div>

      <div className="mt-6">
        <p className="text-sm font-semibold text-ink-900">Състояние</p>
        <div className="mt-2">
          <StatusPicker
            id={message.id}
            current={message.status as InquiryStatus}
            action={updateContactStatus}
          />
        </div>
      </div>

      {message.email ? (
        <RecordReplyForm
          recordId={message.id}
          kind="contact"
          recipient={message.email}
          sender={MAIL_ADDRESS}
        />
      ) : (
        <p className="mt-6 rounded-md border border-dashed border-line-strong bg-paper-raised p-5 text-sm text-ink-500">
          Няма имейл адрес за отговор.
        </p>
      )}
    </>
  );
}
