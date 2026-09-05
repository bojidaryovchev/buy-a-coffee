"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { contactMessages, newsletterSubscribers, orderInquiries } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { createSession, destroySession, isSignedIn, passwordMatches } from "@/lib/auth";
import { MAIL_THREAD_STATUSES, setThreadStatus, type MailThreadStatus } from "@/lib/mail/store";
import { INQUIRY_STATUSES, type InquiryStatus } from "@/lib/inquiry-status";
import {
  REPLY_ATTACHMENT_LIMIT,
  sendRecordReply,
  sendReply,
  type OutgoingAttachment,
} from "@/lib/mail/reply";

/**
 * Every action below re-checks the session.
 *
 * The admin layout redirects a signed-out visitor, but that is a rendering
 * decision and a server action is a public endpoint: the id is in the client
 * bundle and can be POSTed to without ever loading the page that draws the
 * button. It matters most for the two that send mail — an unguarded one is an
 * open relay wearing the shop's DKIM signature.
 */
async function requireAdmin(): Promise<boolean> {
  return isSignedIn();
}

/* -- session --------------------------------------------------------------- */

export type LoginState = { error?: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");

  if (!passwordMatches(password)) {
    // Deliberately vague, and deliberately slow enough to discourage guessing.
    await new Promise((r) => setTimeout(r, 600));
    return { error: "Грешна парола." };
  }

  await createSession();
  redirect("/admin");
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/admin/vhod");
}

/* -- records --------------------------------------------------------------- */

export async function updateOrderStatus(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !INQUIRY_STATUSES.includes(status as InquiryStatus)) return;

  await db
    .update(orderInquiries)
    .set({ status: status as InquiryStatus, updatedAt: new Date() })
    .where(eq(orderInquiries.id, id));

  revalidatePath("/admin/zayavki");
  revalidatePath(`/admin/zayavki/${id}`);
}

export async function updateContactStatus(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !INQUIRY_STATUSES.includes(status as InquiryStatus)) return;

  await db
    .update(contactMessages)
    .set({ status: status as InquiryStatus })
    .where(eq(contactMessages.id, id));

  revalidatePath("/admin/sabshteniya");
  revalidatePath(`/admin/sabshteniya/${id}`);
}

/**
 * Unsubscribe somebody by hand.
 *
 * Stamps `unsubscribedAt` rather than deleting the row, which is the same thing
 * `subscribeToNewsletter` expects to find: re-subscribing clears the stamp
 * instead of erroring. Deleting would also destroy the consent record, and the
 * consent record is the thing that makes the earlier mail lawful — worth
 * keeping precisely because the subscription ended.
 */
export async function unsubscribeSubscriber(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await db
    .update(newsletterSubscribers)
    .set({ unsubscribedAt: new Date() })
    .where(eq(newsletterSubscribers.id, id));

  revalidatePath("/admin/byuletin");
}

/* -- mail ------------------------------------------------------------------ */

export async function updateThreadStatus(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!MAIL_THREAD_STATUSES.includes(status as MailThreadStatus)) return;

  await setThreadStatus(id, status as MailThreadStatus);
  revalidatePath("/admin/poshta");
  revalidatePath(`/admin/poshta/${id}`);
}

/**
 * Files off a form, checked against the limit and base64'd for Resend.
 *
 * Shared by both reply actions rather than written twice: the limit is the one
 * number in here that is a platform fact rather than a preference, and two
 * copies of it is one copy that gets raised and forgotten.
 */
async function collectFiles(
  formData: FormData,
): Promise<{ files: OutgoingAttachment[] } | { error: string }> {
  const files: OutgoingAttachment[] = [];
  let total = 0;

  for (const entry of formData.getAll("files")) {
    /* An empty file input still submits a zero-byte File, so the size check is
       what tells "no attachment" from "an attachment". */
    if (!(entry instanceof File) || entry.size === 0) continue;

    total += entry.size;
    if (total > REPLY_ATTACHMENT_LIMIT) {
      return {
        error: `Файловете са общо над ${Math.round(REPLY_ATTACHMENT_LIMIT / 1_000_000)} MB. Изпратете ги с връзка за изтегляне.`,
      };
    }

    files.push({
      filename: entry.name,
      contentType: entry.type || "application/octet-stream",
      content: Buffer.from(await entry.arrayBuffer()).toString("base64"),
      size: entry.size,
    });
  }

  return { files };
}

export type ReplyState = { error?: string; sent?: boolean };

/**
 * Send a reply, as the shop, in the customer's existing thread.
 *
 * Returns state rather than redirecting: a failed send has to put the typed text
 * back in front of the person who typed it. Losing a written reply to a
 * transient Resend error would be the most annoying possible failure here.
 */
export async function replyToThread(_prev: ReplyState, formData: FormData): Promise<ReplyState> {
  if (!(await requireAdmin())) {
    return { error: "Сесията е изтекла. Влезте отново и опитайте пак." };
  }

  const threadId = String(formData.get("threadId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!threadId) return { error: "Липсва разговор." };
  if (!body) return { error: "Отговорът е празен." };

  const collected = await collectFiles(formData);
  if ("error" in collected) return { error: collected.error };

  const result = await sendReply(threadId, body, collected.files);
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/poshta");
  revalidatePath(`/admin/poshta/${threadId}`);
  return { sent: true };
}

export type RecordReplyState = { error?: string; sent?: boolean; threadId?: string };

/**
 * Answer a stored order enquiry or contact message, as the shop.
 *
 * The customer's address comes off the row rather than out of the form, so
 * nothing typed on this screen decides who the mail goes to. That is worth the
 * extra query: the alternative is a hidden input holding an email address on a
 * page that can send mail as the shop.
 */
export async function replyToRecord(
  _prev: RecordReplyState,
  formData: FormData,
): Promise<RecordReplyState> {
  if (!(await requireAdmin())) {
    return { error: "Сесията е изтекла. Влезте отново и опитайте пак." };
  }

  const id = String(formData.get("recordId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (kind !== "order" && kind !== "contact") return { error: "Непознат вид запис." };
  if (!id) return { error: "Липсва запис." };
  if (!body) return { error: "Отговорът е празен." };

  const record =
    kind === "order"
      ? await db
          .select({
            id: orderInquiries.id,
            name: orderInquiries.customerName,
            email: orderInquiries.email,
          })
          .from(orderInquiries)
          .where(eq(orderInquiries.id, id))
          .limit(1)
          .then((r) => r[0])
      : await db
          .select({
            id: contactMessages.id,
            name: contactMessages.name,
            email: contactMessages.email,
          })
          .from(contactMessages)
          .where(eq(contactMessages.id, id))
          .limit(1)
          .then((r) => r[0]);

  if (!record) return { error: "Записът не е намерен." };

  /* The order form asks for a phone and treats the email as optional, so this
     is a real and common state rather than a defensive check. The screen hides
     the reply box when it happens; this is the guard for a POST that arrives
     anyway. */
  if (!record.email) {
    return { error: "Този запис няма имейл адрес. Свържете се по телефона." };
  }

  const collected = await collectFiles(formData);
  if ("error" in collected) return { error: collected.error };

  const result = await sendRecordReply(
    { id: record.id, name: record.name, email: record.email, kind },
    body,
    collected.files,
  );
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/poshta");
  revalidatePath(kind === "order" ? `/admin/zayavki/${id}` : `/admin/sabshteniya/${id}`);
  return { sent: true, threadId: result.threadId };
}
