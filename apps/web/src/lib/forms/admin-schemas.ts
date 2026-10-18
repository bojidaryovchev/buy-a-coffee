import { z } from "zod";
import { INQUIRY_STATUSES } from "@/lib/inquiry-status";
import { OPERATOR_CONSENT_BASIS_CODES, type OperatorConsentBasis } from "./consent";

/**
 * Validation schemas for the admin panel's forms, shared by the form in the
 * browser and the server action, as the storefront's are (`schemas.ts`).
 *
 * Not in `admin-actions.ts`: that file is `"use server"` and may export async
 * functions only (see `lib/inquiry-status.ts`).
 *
 * The panel's own messages are kept where they were, except the ones that did
 * not say what to do. The session check, the record lookup and the attachment
 * limit stay in the actions: they need the server, and no schema can answer
 * them.
 */

export const LOGIN_MESSAGES = {
  missing: "Въведете паролата.",
} as const;

export const loginSchema = z.object({
  password: z.string().min(1, LOGIN_MESSAGES.missing),
});

export const REPLY_MESSAGES = {
  empty: "Напишете отговора, преди да го изпратите.",
  noThread: "Липсва разговор.",
  noRecord: "Липсва запис.",
  unknownKind: "Непознат вид запис.",
} as const;

/** Whitespace is not a reply. */
const replyBody = z.string().trim().min(1, REPLY_MESSAGES.empty);

const recordKind = z.enum(["order", "contact"], {
  errorMap: () => ({ message: REPLY_MESSAGES.unknownKind }),
});

/**
 * Hidden fields first: when the page itself is broken (a record id missing)
 * that is what the operator is told, not that the box is empty.
 */
export const threadReplySchema = z.object({
  threadId: z.string().min(1, REPLY_MESSAGES.noThread),
  body: replyBody,
});

export const recordReplySchema = z.object({
  kind: recordKind,
  recordId: z.string().min(1, REPLY_MESSAGES.noRecord),
  body: replyBody,
});

export const NEWSLETTER_MARK_MESSAGES = {
  basis: "Изберете как е дадено съгласието. Без това не записваме абонамент.",
} as const;

export const newsletterMarkSchema = z.object({
  kind: recordKind,
  recordId: z.string().min(1, REPLY_MESSAGES.noRecord),
  /** No default, and nothing but a listed code: see `lib/forms/consent.ts`. */
  basis: z.enum(OPERATOR_CONSENT_BASIS_CODES as [OperatorConsentBasis, ...OperatorConsentBasis[]], {
    errorMap: () => ({ message: NEWSLETTER_MARK_MESSAGES.basis }),
  }),
});

/** A status button. Nothing on it is typed, so a failure is a hand-made post. */
export const statusChangeSchema = z.object({
  id: z.string().min(1),
  status: z.enum(INQUIRY_STATUSES),
});

/**
 * Split a refusal into what goes under a field and what goes in the form's own
 * line: an error on a hidden field has no field to stand under.
 */
export function splitErrors(
  error: z.ZodError,
  visible: readonly string[],
): { fieldErrors?: Record<string, string>; error?: string } {
  let formError: string | undefined;
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (visible.includes(key)) fieldErrors[key] ??= issue.message;
    else formError ??= issue.message;
  }
  // A broken page is the first thing to say; with it, the fields are moot.
  if (formError) return { error: formError };
  return { fieldErrors };
}
