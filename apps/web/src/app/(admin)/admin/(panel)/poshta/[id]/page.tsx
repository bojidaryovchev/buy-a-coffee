import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateThreadStatus } from "@/lib/admin-actions";
import { MAIL_ADDRESS } from "@/lib/mail/identity";
import { getThread, type MailMessage } from "@/lib/mail/store";
import { ReplyForm } from "@/components/admin/reply-form";

export const metadata: Metadata = { title: "Разговор" };
export const dynamic = "force-dynamic";

/**
 * One conversation, and the box to answer it from.
 *
 * Bodies are rendered as TEXT, never as the sender's HTML. This is a page an
 * administrator opens, holding markup written by whoever felt like writing to
 * the shop; `dangerouslySetInnerHTML` here would be a stored-XSS hole in the one
 * session on the site that can send mail as the company and read every
 * customer's phone number. The plain-text part is what mail clients have always
 * been required to carry, and where a sender omits it the markup is flattened
 * rather than trusted.
 *
 * The app has a sanitiser — `lib/sanitize.ts` — and it is deliberately NOT
 * used here. Sanitising would mean choosing to render a stranger's markup and
 * betting on the sanitiser; flattening means never rendering it at all. The
 * bet is only worth taking where the markup adds something, and in a support
 * thread it adds a signature image.
 *
 * (That sanitiser used to be `isomorphic-dompurify`, named here by package.
 * It is now `sanitize-html`, because the former could not load in Vercel's
 * bundle — see `lib/sanitize.ts`. Naming the module rather than the vendor
 * means this note survives the next such change.)
 */

/** Last-resort readable text for a message that arrived as HTML only. */
function flatten(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Drop our own signature block from a message we sent.
 *
 * `--` on a line of its own is the standard signature delimiter, and the block
 * beneath it is `SIGNATURE` in `lib/mail/reply.ts`: the same three lines under
 * every outgoing message. Repeated down a transcript it buries the sentence
 * someone actually wrote.
 *
 * Trimmed for display only — `bodyText` keeps exactly what left the building,
 * which is the version worth having if anyone ever asks what was sent. Applied
 * to our messages alone; a signature on an incoming one is the sender's content
 * and not ours to tidy.
 */
function withoutSignature(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.trimEnd() === "--") return lines.slice(0, i).join("\n").trimEnd();
  }
  return text;
}

function readableBody(message: MailMessage): string {
  const text = message.bodyText?.trim();
  if (text) return message.direction === "out" ? withoutSignature(text) : text;
  if (message.bodyHtml) return flatten(message.bodyHtml);
  return "(празно съобщение)";
}

const kilobytes = (bytes: number): string =>
  bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;

export default async function AdminThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const thread = await getThread(id);
  if (!thread) notFound();

  const nextStatus = thread.status === "open" ? "done" : "open";

  return (
    <>
      <Link href="/admin/poshta" className="text-sm text-ink-500 hover:text-ink-900">
        ← Всички разговори
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900">{thread.subject}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {thread.correspondentName
              ? `${thread.correspondentName} · ${thread.correspondent}`
              : thread.correspondent}
          </p>
        </div>

        <form action={updateThreadStatus}>
          <input type="hidden" name="id" value={thread.id} />
          <input type="hidden" name="status" value={nextStatus} />
          <button
            type="submit"
            className="min-h-11 rounded-sm border border-line-strong px-4 py-2.5 text-sm font-medium transition-colors hover:border-ink-300"
          >
            {thread.status === "open" ? "Приключи" : "Отвори отново"}
          </button>
        </form>
      </div>

      <ol className="mt-8 flex flex-col gap-3">
        {thread.messages.map((message) => {
          const outgoing = message.direction === "out";

          return (
            <li
              key={message.id}
              className={`rounded-md border p-5 ${
                outgoing ? "border-line bg-paper-sunken" : "border-line-strong bg-paper-raised"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <p className="text-sm font-semibold text-ink-900">
                  {outgoing ? `Вие (${MAIL_ADDRESS})` : message.fromAddress}
                </p>
                <p className="text-sm text-ink-500 tabular-nums">
                  {message.createdAt.slice(0, 16).replace("T", " ")}
                </p>
              </div>

              <p className="mt-3 leading-relaxed whitespace-pre-wrap text-ink-700">
                {readableBody(message)}
              </p>

              {message.attachments && message.attachments.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {message.attachments.map((file, index) => (
                    <li key={`${message.id}-${index}`}>
                      <a
                        href={`/admin/poshta/fail/${encodeURIComponent(message.id)}/${index}`}
                        className="inline-block rounded-sm border border-line-strong px-3 py-2 text-sm transition-colors hover:border-ink-300"
                      >
                        {file.filename} <span className="text-ink-500">{kilobytes(file.size)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <ReplyForm threadId={thread.id} sender={MAIL_ADDRESS} />
    </>
  );
}
