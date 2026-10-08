import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { newsletterSubscribers } from "@catalog/db/schema";
import { db } from "@/lib/db";
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

  const changed = await db
    .update(newsletterSubscribers)
    .set({ unsubscribedAt: new Date() })
    .where(
      and(
        eq(newsletterSubscribers.unsubscribeToken, token),
        isNull(newsletterSubscribers.unsubscribedAt),
      ),
    )
    .returning({ id: newsletterSubscribers.id });
  if (changed.length > 0) return "unsubscribed";

  // Nothing to change: either it is already done (a double click, a second
  // tab) or the token is not ours.
  const [existing] = await db
    .select({ id: newsletterSubscribers.id })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.unsubscribeToken, token))
    .limit(1);
  return existing ? "already_unsubscribed" : "invalid";
}
