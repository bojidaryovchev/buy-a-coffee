"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { contactMessages, newsletterSubscribers, orderInquiries } from "@catalog/db/schema";
import { db } from "@/lib/db";
import {
  createSession,
  destroySession,
  isAdminConfigured,
  isSignedIn,
  passwordMatches,
} from "@/lib/auth";
import { networkFingerprint, sharedStore } from "@/lib/rate-limit";
import { attemptSignIn, createSignInGuard } from "@/lib/sign-in-guard";
import { MAIL_THREAD_STATUSES, setThreadStatus, type MailThreadStatus } from "@/lib/mail/store";
import { INQUIRY_STATUSES, type InquiryStatus } from "@/lib/inquiry-status";
import { isOperatorConsentBasis } from "@/lib/forms/consent";
import { operatorSubscribe } from "@/lib/forms/subscribe";
import { CONVERSATION_CLOSED } from "@/lib/retention";
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

/*
 * Two messages, and neither says anything about the password that was typed.
 * "Too many attempts" is returned before the password is compared, so it is
 * the same for a right guess and a wrong one. It carries no countdown: how
 * long is left is in the server log, for the operator, not on a public form.
 */
const WRONG_PASSWORD = "Грешна парола.";
const TOO_MANY_ATTEMPTS = "Твърде много опити. Изчакайте и опитайте отново.";

/** Shares the rate limiters' store, so the counts hold across instances. */
const signInGuard = createSignInGuard({ store: sharedStore });

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  /* The pages hide the form when the panel is disabled, but this action is
     reachable without them. Answer as for any wrong password, and before
     spending a database round trip on a form that cannot succeed. */
  if (!isAdminConfigured()) return { error: WRONG_PASSWORD };

  const password = String(formData.get("password") ?? "");

  const outcome = await attemptSignIn({
    guard: signInGuard,
    client: networkFingerprint(await headers()),
    matches: () => passwordMatches(password),
    log: (entry) => console.warn(JSON.stringify(entry)),
  });

  if (!outcome.ok) {
    if (outcome.reason !== "bad_password") return { error: TOO_MANY_ATTEMPTS };
    /* No longer what bounds guessing — the guard does that, and on serverless
       a sleep per instance bounds nothing. Kept because it still costs a
       single patient client something and costs the operator one typo. */
    await new Promise((r) => setTimeout(r, 600));
    return { error: WRONG_PASSWORD };
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

  /* `closed_at` is what retention counts its 12 months from. Set the first
     time the message reaches a closed status (moving from one closed status to
     another keeps the earlier time: the conversation closed then), cleared
     when it is reopened. */
  const closing = CONVERSATION_CLOSED.includes(status as InquiryStatus);
  await db
    .update(contactMessages)
    .set({
      status: status as InquiryStatus,
      closedAt: closing ? sql`coalesce(${contactMessages.closedAt}, now())` : null,
    })
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

export type NewsletterMarkState = {
  error?: string;
  /** What was recorded, for the confirmation line. */
  done?: "subscribed" | "already_subscribed";
};

/**
 * Put the sender of an enquiry or a message on the newsletter list.
 *
 * An enquiry is not consent to marketing: somebody asking about a coffee has
 * not agreed to be mailed about others. So this does not exist as a plain
 * button. The operator has to say HOW the person agreed (one of a fixed few),
 * that answer is stored as the consent source with the time, and a missing or
 * unknown answer is refused — there is no path through here that subscribes
 * anyone without a recorded basis.
 *
 * The address is read off the stored row, not off the form, for the same reason
 * `replyToRecord` does it: nothing typed on this screen decides whose address
 * is signed up. An address that has unsubscribed is not put back: that is their
 * decision, and only they can reverse it, through the form.
 */
export async function addToNewsletter(
  _prev: NewsletterMarkState,
  formData: FormData,
): Promise<NewsletterMarkState> {
  if (!(await requireAdmin())) {
    return { error: "Сесията е изтекла. Влезте отново и опитайте пак." };
  }

  const id = String(formData.get("recordId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const basis = formData.get("basis");

  if (kind !== "order" && kind !== "contact") return { error: "Непознат вид запис." };
  if (!id) return { error: "Липсва запис." };
  if (!isOperatorConsentBasis(basis)) {
    return { error: "Изберете как е дадено съгласието. Без това не записваме абонамент." };
  }

  const [record] =
    kind === "order"
      ? await db
          .select({ email: orderInquiries.email })
          .from(orderInquiries)
          .where(eq(orderInquiries.id, id))
          .limit(1)
      : await db
          .select({ email: contactMessages.email })
          .from(contactMessages)
          .where(eq(contactMessages.id, id))
          .limit(1);

  if (!record) return { error: "Записът не е намерен." };
  const email = record.email?.trim().toLowerCase();
  if (!email) return { error: "Този запис няма имейл адрес." };

  const outcome = await operatorSubscribe({
    email,
    basis,
    // Which record the operator was looking at, so "how" can be traced back.
    metadata: {
      via: "admin",
      recordKind: kind,
      recordId: id,
      recordedAt: new Date().toISOString(),
    },
  });

  if (outcome === "was_unsubscribed") {
    return {
      error:
        "Този адрес се е отписал от бюлетина. Не го връщаме от панела — човекът може да се запише отново сам, от формата на сайта.",
    };
  }

  revalidatePath("/admin/byuletin");
  revalidatePath(kind === "order" ? `/admin/zayavki/${id}` : `/admin/sabshteniya/${id}`);
  return { done: outcome };
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
