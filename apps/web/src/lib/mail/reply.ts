import "server-only";
import { randomUUID } from "node:crypto";
import { siteConfig } from "@/config/site";
import { asHtml } from "./html";
import { MAIL_ADDRESS, MAIL_FROM } from "./identity";
import {
  addMessage,
  createThread,
  findThreadByCorrespondent,
  getThread,
  normalizeSubject,
  parseMessageIds,
  setThreadStatus,
  type MailAttachment,
  type MailThreadDetail,
} from "./store";

/**
 * Replying as the shop.
 *
 * This is the half a forward to Gmail cannot do. Pressing Reply in Gmail sends
 * from the Gmail address, so the customer's thread shows a shop address on the
 * way in and a personal one on the way out — which on a question about an order
 * reads either as a different person or as no shop at all. Sent from here it
 * leaves as the published address, signed by our own DKIM.
 *
 * Threading is the other half. `In-Reply-To` and `References` are what put the
 * answer inside the customer's existing conversation instead of starting a new
 * one, and carrying the full References chain is also what lets us recognise
 * their next reply as belonging to this thread — see `matchThread`.
 */

/** Vercel refuses a request body over about 4.5 MB before any of our code runs,
 *  so the honest limit is below that rather than Resend's 40 MB. */
export const REPLY_ATTACHMENT_LIMIT = 4_000_000;

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  /** Base64. Resend takes bytes or a URL; we have bytes in hand. */
  content: string;
  size: number;
}

export type ReplyResult = { ok: true; threadId?: string } | { ok: false; error: string };

/** "поръчка" → "Re: поръчка", and "Re: поръчка" stays as it is. */
function replySubject(subject: string): string {
  return /^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

/**
 * The chain of ids to quote back.
 *
 * Newest last, deduplicated, capped: References grows by one id per exchange and
 * some clients choke on a header of unbounded length. The first entries matter
 * most for threading, so the cap drops from the middle by keeping the head and
 * the tail.
 */
function referenceChain(thread: MailThreadDetail): string[] {
  const ids = thread.messages
    .flatMap((m) => [...parseMessageIds(m.inReplyTo), ...(m.messageId ? [m.messageId] : [])])
    .filter((id, index, all) => all.indexOf(id) === index);

  return ids.length <= 20 ? ids : [...ids.slice(0, 10), ...ids.slice(-10)];
}

/**
 * The signature under every outgoing message.
 *
 * Facts a customer may need to act on: who wrote, what to call, when someone
 * answers. The phone number is first because this shop's whole ordering flow is
 * a phone call — the fastest reply to any of this mail is the customer ringing.
 *
 * The lone `--` is the standard signature delimiter, and the thread view relies
 * on it to hide this block when it lists what we sent — see `withoutSignature`
 * in the admin thread page. Changing it here means changing it there.
 */
const SIGNATURE = [
  "--",
  siteConfig.name,
  `${siteConfig.contact.phone} · ${MAIL_ADDRESS}`,
  siteConfig.contact.hours,
];

export async function sendReply(
  threadId: string,
  body: string,
  files: OutgoingAttachment[],
): Promise<ReplyResult> {
  const thread = await getThread(threadId);
  if (!thread) return { ok: false, error: "Разговорът не е намерен." };

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, error: "Липсва RESEND_API_KEY — отговорът не може да бъде изпратен." };
  }

  /* Answer the last thing they actually sent. Replying to the thread's first
     message would thread correctly but quote the wrong parent in clients that
     show one. */
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "in");
  const to = lastInbound ? lastInbound.fromAddress : thread.correspondent;

  const references = referenceChain(thread);
  const headers: Record<string, string> = {};
  if (lastInbound?.messageId) headers["In-Reply-To"] = lastInbound.messageId;
  if (references.length > 0) headers.References = references.join(" ");

  const subject = replySubject(thread.subject);
  const text = [body.trim(), "", ...SIGNATURE].join("\n");

  const { Resend } = await import("resend");
  const resend = new Resend(key);

  const sent = await resend.emails.send({
    from: MAIL_FROM,
    to,
    subject,
    html: asHtml(text),
    text,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(files.length > 0
      ? {
          attachments: files.map((f) => ({
            filename: f.filename,
            content: f.content,
            contentType: f.contentType,
          })),
        }
      : {}),
  });

  if (sent.error || !sent.data) {
    // Resend's own message is English and written for developers. It belongs in
    // the log, not under a Bulgarian form.
    console.error(
      JSON.stringify({
        level: "error",
        msg: "reply.failed",
        threadId,
        error: sent.error?.message ?? "(Resend не върна отговор)",
      }),
    );
    return { ok: false, error: "Отговорът не беше изпратен. Опитайте отново след минута." };
  }

  const attachments: MailAttachment[] = files.map((f) => ({
    filename: f.filename,
    size: f.size,
    contentType: f.contentType,
  }));

  /* Recorded after the send, not before: an unsent reply in the transcript is
     worse than a sent one missing from it, because the second is visible in the
     customer's next message and the first is invisible forever. */
  await addMessage({
    id: sent.data.id,
    threadId,
    createdAt: new Date().toISOString(),
    direction: "out",
    fromAddress: MAIL_FROM,
    toAddresses: to,
    subject,
    bodyText: text,
    bodyHtml: null,
    /* Resend mints the Message-ID and does not hand it back on send. Nothing
       depends on knowing it: a customer's reply carries their own earlier ids in
       References, and those we do have. */
    messageId: null,
    inReplyTo: lastInbound?.messageId ?? null,
    attachments: attachments.length > 0 ? attachments : null,
  });

  /* Answering reopens a thread that had been marked done, because the person it
     went to is now expected to write back. */
  if (thread.status === "done") await setThreadStatus(threadId, "open");

  return { ok: true };
}

/* -- answering a stored record --------------------------------------------- */

/**
 * A short reference the customer can quote and the shop can read out.
 *
 * The primary keys here are `uuid`, which is right for a key and useless in a
 * subject line — nobody reads thirty-six characters back over the phone. Eight
 * hex characters of the same id is unambiguous across any volume this shop will
 * ever see, and stays a pure function of the row, which is what the subject
 * matching below depends on.
 */
export const recordReference = (id: string): string => id.slice(0, 8).toUpperCase();

/**
 * The subject a record's conversation carries.
 *
 * Built from the reference rather than from the product or the customer, because
 * it is the ONE part of the thread that has to be reproducible: nothing links a
 * record to a thread — no column, no join — and the conversation is found again
 * by asking the mailbox for this correspondent and this normalised subject. A
 * subject derived from anything editable would hand the customer a second thread
 * on their second reply.
 */
export const orderThreadSubject = (id: string): string => `Вашата заявка ${recordReference(id)}`;
export const contactThreadSubject = (id: string): string =>
  `Вашето съобщение ${recordReference(id)}`;

/**
 * Answer a stored order enquiry or contact message, as the shop, in a real
 * conversation.
 *
 * WHY THIS EXISTS AT ALL. Until now the shop could read nothing it collected:
 * `submitOrderInquiry` and `submitContactMessage` wrote a row and called
 * `notify()`, which logged a redacted line to the server console and stopped
 * there. There was no screen, no reply path, and no notification anybody would
 * see. This is the other end of that.
 *
 * IT DELEGATES RATHER THAN SENDING. Everything below the thread is `sendReply`'s
 * job already — the DKIM-signed sender, the plain-text twin and its signature,
 * recording the message only after Resend accepts it. A second sending path
 * would be a second place for those to drift, and the one that drifted would be
 * this one, because it runs on the screen nobody opens twice.
 *
 * The thread it opens is an ordinary mailbox thread, so the answer to "where did
 * this conversation go" is the same as for every other: Поща. When the customer
 * replies, the inbound webhook matches it by References and it lands there
 * beside the rest.
 */
export async function sendRecordReply(
  record: { id: string; name: string | null; email: string; kind: "order" | "contact" },
  body: string,
  files: OutgoingAttachment[],
): Promise<ReplyResult> {
  const subject =
    record.kind === "order" ? orderThreadSubject(record.id) : contactThreadSubject(record.id);
  const correspondent = record.email.trim().toLowerCase();

  let threadId = await findThreadByCorrespondent(correspondent, normalizeSubject(subject));

  if (!threadId) {
    threadId = randomUUID().slice(0, 8).toUpperCase();
    await createThread({
      id: threadId,
      createdAt: new Date().toISOString(),
      subject,
      correspondent,
      /* The name they typed into the form. The mailbox otherwise learns a name
         only from a From header, and a form submission has none to read. */
      correspondentName: record.name?.trim() || null,
    });
  }

  const result = await sendReply(threadId, body, files);
  return result.ok ? { ok: true, threadId } : result;
}

/** Exported for the thread view, which shows the subject a reply would carry. */
export { replySubject, normalizeSubject };
