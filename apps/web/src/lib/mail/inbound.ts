import "server-only";
import { randomUUID } from "node:crypto";
import { siteConfig } from "@/config/site";
import { MAIL_ADDRESS, MAIL_DOMAIN, NOTIFY_TO } from "./identity";
import {
  addMessage,
  createThread,
  headerValue,
  matchThread,
  parseAddress,
  parseMessageIds,
  type MailAttachment,
} from "./store";

/**
 * Inbound mail: the shop's `info@` address → the database, then a person's
 * inbox.
 *
 * Two things happen to every incoming message, in that order and for different
 * reasons. It is **recorded**, so the conversation can be answered from the
 * admin panel and go out as the shop's own address — which a forward can never
 * do, because a reply from Gmail leaves as the Gmail address. And it is
 * **forwarded**, because a panel nobody has open notifies nobody, and the shop
 * already watches its Gmail.
 *
 * Recording first is deliberate. A forward that fails costs a notification; a
 * record that never happens costs the conversation.
 *
 * WHY NOT `resend.emails.receiving.forward()`. The SDK ships one, and it does
 * almost this. It does not set `Reply-To` (see `forwardPassthrough` in
 * `resend/dist/index.mjs`), so the copy arrives from our own domain and pressing
 * Reply writes back to us instead of to the customer. On a shop whose entire
 * ordering flow is "leave a number and we call you back", answering the
 * customer is the only thing this feature is for.
 *
 * The one thing forwarding cannot do is make the reply leave **as** the shop
 * address — it goes out as the Gmail address. Only a real mailbox (Workspace,
 * Zoho) fixes that, and it costs a monthly fee for one seat.
 *
 * Webhooks carry metadata only: no body, no attachments. Both need a second
 * call to the Received Emails API.
 *
 * ⚠ Idle until the shop's real address exists and its domain has an MX record.
 * `siteConfig.contact.email` is still `hello@example.com` — see the TODO in
 * `config/site.ts`. Without MX, Resend is never handed the mail and never posts
 * an event, so this route is correct and never called.
 */

/**
 * How much attachment we are willing to re-upload, before base64 inflates it by
 * a third. Resend refuses a message over 40 MB, and a refusal loses the whole
 * forward rather than one PDF, so anything above this is left in the Resend
 * dashboard and named in the body.
 */
const ATTACHMENT_BUDGET = 15_000_000;

export type InboundResult =
  | { status: "forwarded"; id: string }
  /** Stored, but not forwarded, because forwarding is not configured. The
   *  message is safe in the panel, which is the half that matters. */
  | { status: "recorded"; reason: string }
  /** Understood and deliberately not forwarded. Still a 200: a retry would do
   *  the same thing again. */
  | { status: "ignored"; reason: string }
  | { status: "unauthorized" }
  /** Something broke on our side or Resend's. Answered with a 500 so Resend
   *  retries rather than dropping a customer's email on the floor. */
  | { status: "failed"; error: string };

/** A display name that cannot break the From header. Quotes, angle brackets,
 *  commas and newlines are all header syntax, and this string comes from a
 *  stranger. */
function displayName(from: string): string {
  const withoutAddress = from.replace(/<[^>]*>/, "").trim();
  const name = withoutAddress.replace(/^"|"$/g, "").trim() || from;
  return name
    .replace(/[<>"\\,;:\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** The envelope, restated at the top of the forwarded copy. Without it the
 *  original sender and recipient are lost: the copy is from us, to the Gmail. */
function envelopeLines(email: {
  from: string;
  received_for: string[];
  created_at: string;
}): string[] {
  return [
    `От: ${email.from}`,
    `До: ${email.received_for.join(", ")}`,
    `Получено: ${new Date(email.created_at).toLocaleString("bg-BG")}`,
  ];
}

export async function handleInboundEmail(
  /** The raw request body, byte for byte. Verification is over the exact bytes,
   *  so it must not have been through JSON.parse and back. */
  payload: string,
  headers: { id: string; timestamp: string; signature: string },
): Promise<InboundResult> {
  const key = process.env.RESEND_API_KEY;
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  if (!key || !secret) {
    return { status: "failed", error: "липсва RESEND_API_KEY или RESEND_WEBHOOK_SECRET" };
  }

  /* MAIL_TO is deliberately NOT checked here. It configures the forward, and the
     forward is the lesser half: a misconfigured notification must not stop the
     message being recorded. Checked further down, once the row is safe. */

  const { Resend } = await import("resend");
  const resend = new Resend(key);

  let event;
  try {
    event = resend.webhooks.verify({ payload, headers, webhookSecret: secret });
  } catch {
    return { status: "unauthorized" };
  }

  if (event.type !== "email.received") {
    return { status: "ignored", reason: event.type };
  }

  const emailId = event.data.email_id;

  /* The sender is on our own domain: our own acknowledgement bouncing, or a
     copy of something we sent. Forwarding it starts a ping-pong. */
  if (event.data.from.toLowerCase().includes(`@${MAIL_DOMAIN}`)) {
    return { status: "ignored", reason: `подател от @${MAIL_DOMAIN}` };
  }

  const { data: email, error } = await resend.emails.receiving.get(emailId);
  if (error || !email) {
    return { status: "failed", error: error?.message ?? "празен отговор" };
  }

  const { data: list } = await resend.emails.receiving.attachments.list({ emailId });
  const held = list?.data ?? [];

  /* Recorded before anything is forwarded. If this throws we answer 500 and
     Resend retries the whole webhook; the insert conflicts on Resend's own id
     the second time round, so a retry costs a duplicate Gmail copy at worst and
     never a duplicate conversation. */
  try {
    await record(email, emailId, held);
  } catch (err) {
    return {
      status: "failed",
      error: `записът в пощенската кутия се провали: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  /* From here on it is only the notification. The message is already in the
     panel and answerable, so a forward that cannot be configured is reported
     and shrugged off rather than turned into a 500 and an endless retry. */
  if (!NOTIFY_TO) {
    return { status: "recorded", reason: "липсва MAIL_TO - копие не беше изпратено" };
  }
  if (NOTIFY_TO.endsWith(`@${MAIL_DOMAIN}`)) {
    // Forwarding our own domain to itself is an infinite loop with a rate limit
    // at the end of it.
    return { status: "recorded", reason: `MAIL_TO сочи към @${MAIL_DOMAIN}` };
  }

  /* Attachments come back as signed download URLs, not bytes. Fetch each and
     re-encode, stopping at the budget rather than failing the whole message. */
  const attachments: { filename: string; content: string; contentType: string }[] = [];
  const skipped: string[] = [];
  let spent = 0;

  for (const item of held) {
    const name = item.filename ?? "прикачен файл";
    if (spent + item.size > ATTACHMENT_BUDGET) {
      skipped.push(name);
      continue;
    }
    try {
      const response = await fetch(item.download_url);
      if (!response.ok) {
        skipped.push(name);
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      attachments.push({
        filename: name,
        content: bytes.toString("base64"),
        contentType: item.content_type,
      });
      spent += bytes.byteLength;
    } catch {
      // One unreachable attachment must not cost the message it came with.
      skipped.push(name);
    }
  }

  const envelope = envelopeLines(email);
  if (skipped.length > 0) {
    envelope.push(`Непрепратени файлове (твърде големи, останали в Resend): ${skipped.join(", ")}`);
  }

  const text = [...envelope, "", "---", "", email.text ?? "(празно съобщение)"].join("\n");

  /* Built as a string and not as JSX, because the body it wraps is the sender's
     own markup and React would escape it. The greys are the ink tokens'
     approximate values written literally: mail clients do not resolve CSS
     custom properties, so `var(--color-ink-500)` would render as nothing. */
  const html = email.html
    ? `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b7671">${envelope
        .map((line) => `${escapeHtml(line)}<br>`)
        .join(
          "",
        )}</div><hr style="border:0;border-top:1px solid #dbe0dd;margin:16px 0">${email.html}`
    : undefined;

  /* Reply-To points at the customer so that pressing Reply answers them and not
     us. Note it is the SECOND-best way to answer now — a reply sent from the
     admin panel leaves as the shop's own address, which this one cannot. */
  const replyTo = email.reply_to?.length ? email.reply_to : [email.from];

  const sent = await resend.emails.send({
    from: `"${displayName(email.from)} чрез ${siteConfig.name}" <${MAIL_ADDRESS}>`,
    to: NOTIFY_TO,
    subject: email.subject || "(без тема)",
    text,
    ...(html ? { html } : {}),
    replyTo,
    ...(attachments.length > 0 ? { attachments } : {}),
  });

  if (sent.error || !sent.data) {
    return { status: "failed", error: sent.error?.message ?? "празен отговор" };
  }

  return { status: "forwarded", id: sent.data.id };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * File the message in the mailbox.
 *
 * Where it goes is `matchThread`'s decision; this only mints a thread when there
 * is nothing to attach it to. The id is short and uppercase because it ends up
 * in a URL the shop owner may read out.
 */
async function record(
  email: {
    from: string;
    to: string[];
    subject: string;
    text: string | null;
    html: string | null;
    created_at: string;
    message_id: string;
    headers: Record<string, string> | null;
  },
  emailId: string,
  held: { id: string; filename?: string; size: number; content_type: string }[],
): Promise<void> {
  const sender = parseAddress(email.from);
  const subject = email.subject || "(без тема)";

  /* In-Reply-To names the parent, References names every ancestor. Both are
     offered to the matcher: a client that sends only one of them is common. */
  const references = [
    ...parseMessageIds(headerValue(email.headers, "in-reply-to")),
    ...parseMessageIds(headerValue(email.headers, "references")),
  ];

  let threadId = await matchThread(references, sender.address, subject);

  if (!threadId) {
    threadId = randomUUID().slice(0, 8).toUpperCase();
    await createThread({
      id: threadId,
      createdAt: email.created_at,
      subject,
      correspondent: sender.address,
      correspondentName: sender.name,
    });
  }

  const attachments: MailAttachment[] = held.map((item) => ({
    filename: item.filename ?? "прикачен файл",
    size: item.size,
    contentType: item.content_type,
  }));

  await addMessage({
    id: emailId,
    threadId,
    createdAt: email.created_at,
    direction: "in",
    fromAddress: email.from,
    toAddresses: email.to.join(", "),
    subject,
    bodyText: email.text,
    bodyHtml: email.html,
    messageId: email.message_id,
    inReplyTo: headerValue(email.headers, "in-reply-to") ?? null,
    attachments: attachments.length > 0 ? attachments : null,
  });
}
