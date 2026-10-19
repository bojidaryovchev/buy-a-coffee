import "server-only";
import { and, eq, isNull, lte } from "drizzle-orm";
import { newsletterSubscribers } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { syncUnsubscribedLater } from "@/lib/newsletter/sync";
import { isPlausibleToken } from "./unsubscribe-token";

/**
 * Unsubscribing by token, the database half.
 *
 * Looking a token up changes nothing and unsubscribing is a separate step: the
 * link is opened by people, but also by mail scanners and link previewers that
 * follow every URL in a message, and one of those must not be able to
 * unsubscribe the recipient. The page asks, a POST from the page answers.
 *
 * The row is stamped, not deleted. The consent record is what made the earlier
 * mail lawful, and it is worth keeping because the subscription ended.
 *
 * Once stamped, the address is opted out of this site's topic in Resend, after
 * the response (`lib/newsletter/sync.ts`) — of that topic only, never of the
 * whole account, which three other sites share.
 */

export type TokenLookup =
  | { state: "active"; email: string }
  /** Unknown, malformed or already used. Deliberately one answer: the page must
      not tell a stranger holding a guessed token which of those it was. */
  | { state: "unusable" };

export async function lookupToken(token: string | null | undefined): Promise<TokenLookup> {
  if (!isPlausibleToken(token)) return { state: "unusable" };
  const [row] = await db
    .select({
      email: newsletterSubscribers.email,
      unsubscribedAt: newsletterSubscribers.unsubscribedAt,
    })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.unsubscribeToken, token))
    .limit(1);
  return row && !row.unsubscribedAt ? { state: "active", email: row.email } : { state: "unusable" };
}

export type UnsubscribeOutcome = "unsubscribed" | "already_unsubscribed" | "invalid";

export async function unsubscribeByToken(
  token: string | null | undefined,
): Promise<UnsubscribeOutcome> {
  if (!isPlausibleToken(token)) return "invalid";

  const [changed] = await db
    .update(newsletterSubscribers)
    .set({ unsubscribedAt: new Date() })
    .where(
      and(
        eq(newsletterSubscribers.unsubscribeToken, token),
        isNull(newsletterSubscribers.unsubscribedAt),
      ),
    )
    .returning({ id: newsletterSubscribers.id, email: newsletterSubscribers.email });
  if (changed) {
    syncUnsubscribedLater(changed);
    return "unsubscribed";
  }

  // Nothing to change: either it is already done (a double click, a second
  // tab) or the token is not ours.
  const [existing] = await db
    .select({ id: newsletterSubscribers.id, email: newsletterSubscribers.email })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.unsubscribeToken, token))
    .limit(1);
  if (!existing) return "invalid";
  // Mirrored on a repeat too: if the first opt-out never reached Resend, the
  // second press is what fixes it, and an opt-out is safe to send twice.
  syncUnsubscribedLater(existing);
  return "already_unsubscribed";
}

/* -- Resend's side ---------------------------------------------------------- */

/**
 * Where an address stands on the list, for the contact webhook
 * (`lib/newsletter/webhook.ts`). It asks before it spends a Resend API call:
 * the account is shared by four sites, and most contact events are not ours.
 */
export async function findSubscriberByEmail(
  email: string,
): Promise<{ id: string; consentAt: Date; unsubscribedAt: Date | null } | null> {
  const [row] = await db
    .select({
      id: newsletterSubscribers.id,
      consentAt: newsletterSubscribers.consentAt,
      unsubscribedAt: newsletterSubscribers.unsubscribedAt,
    })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email.trim().toLowerCase()))
    .limit(1);
  return row ?? null;
}

export type RemoteUnsubscribeOutcome =
  "unsubscribed" | "already_unsubscribed" | "not_found" | "stale";

/**
 * An unsubscribe made in Resend, stamped with when it happened there.
 *
 * `stale` when the row's consent is newer than the event: the person signed up
 * again after leaving, and that is their latest word. Resend retries a failed
 * delivery with the original payload, so an opt-out can arrive after the
 * signup that superseded it, and must lose to it. The condition is in the
 * update itself, so a signup landing between a read and a write cannot be
 * overwritten either.
 */
export async function unsubscribeByEmail(
  email: string,
  at: Date,
): Promise<RemoteUnsubscribeOutcome> {
  const address = email.trim().toLowerCase();
  const [changed] = await db
    .update(newsletterSubscribers)
    .set({ unsubscribedAt: at })
    .where(
      and(
        eq(newsletterSubscribers.email, address),
        isNull(newsletterSubscribers.unsubscribedAt),
        lte(newsletterSubscribers.consentAt, at),
      ),
    )
    .returning({ id: newsletterSubscribers.id });
  if (changed) return "unsubscribed";

  const existing = await findSubscriberByEmail(address);
  if (!existing) return "not_found";
  return existing.unsubscribedAt ? "already_unsubscribed" : "stale";
}
