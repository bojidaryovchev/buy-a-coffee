import "server-only";
import { eq, sql } from "drizzle-orm";
import { newsletterSubscribers } from "@catalog/db/schema";
import { db } from "@/lib/db";

/**
 * The one place a subscription is written.
 *
 * Three callers record consent — the footer form, the two ticked checkboxes and
 * the operator's "add to newsletter" — and all of them go through here, so the
 * rules about an existing row are written once.
 *
 * What happens when the address is already on the list:
 *
 *  - subscribed: nothing changes. The first consent stays the record; a second
 *    tick elsewhere is not a better proof and overwriting would lose the
 *    earlier "how".
 *  - unsubscribed: the person is signing up again, themselves, so it is a fresh
 *    consent: new time, new source, and the unsubscribe stamp is cleared. The
 *    token stays, so a link in an old message still resolves to the same row.
 *
 * Someone who unsubscribed is never put back by anything but their own action.
 * `operatorSubscribe` therefore refuses an unsubscribed address instead of
 * overwriting what they asked for.
 */

export type SubscribeOutcome = "subscribed" | "already_subscribed" | "was_unsubscribed";

export async function recordConsent(input: {
  email: string;
  source: string;
  metadata: Record<string, unknown>;
}): Promise<{ id: string; created: boolean }> {
  const [row] = await db
    .insert(newsletterSubscribers)
    .values({
      email: input.email,
      consentSource: input.source,
      requestMetadata: input.metadata,
    })
    .onConflictDoUpdate({
      target: newsletterSubscribers.email,
      // Only a row that had unsubscribed is touched; for a live one the update
      // rewrites each column with its own value.
      set: {
        consentAt: sql`case when ${newsletterSubscribers.unsubscribedAt} is not null then now() else ${newsletterSubscribers.consentAt} end`,
        consentSource: sql`case when ${newsletterSubscribers.unsubscribedAt} is not null then excluded.consent_source else ${newsletterSubscribers.consentSource} end`,
        requestMetadata: sql`case when ${newsletterSubscribers.unsubscribedAt} is not null then excluded.request_metadata else ${newsletterSubscribers.requestMetadata} end`,
        unsubscribedAt: null,
      },
    })
    .returning({
      id: newsletterSubscribers.id,
      // `xmax = 0` is true only for a row this statement inserted.
      created: sql<boolean>`(xmax = 0)`,
    });
  if (!row) throw new Error("Subscription was not recorded");
  return { id: row.id, created: row.created };
}

/**
 * The operator records an agreement they were told about.
 *
 * Returns what happened rather than throwing for the two states a person should
 * hear about; the caller turns them into words.
 */
export async function operatorSubscribe(input: {
  email: string;
  basis: string;
  metadata: Record<string, unknown>;
}): Promise<SubscribeOutcome> {
  const [existing] = await db
    .select({ unsubscribedAt: newsletterSubscribers.unsubscribedAt })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, input.email))
    .limit(1);

  if (existing?.unsubscribedAt) return "was_unsubscribed";
  if (existing) return "already_subscribed";

  // `doNothing`, not `recordConsent`: if the person unsubscribed between the
  // read above and this insert, the operator must not be the one to undo that.
  const inserted = await db
    .insert(newsletterSubscribers)
    .values({
      email: input.email,
      consentSource: input.basis,
      requestMetadata: input.metadata,
    })
    .onConflictDoNothing({ target: newsletterSubscribers.email })
    .returning({ id: newsletterSubscribers.id });
  return inserted.length > 0 ? "subscribed" : "already_subscribed";
}
