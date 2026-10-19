import "server-only";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { newsletterDeliveries, newsletterSubscribers } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { syncUnsubscribedLater } from "./sync";

/**
 * A newsletter copy that bounced for good, or that its reader reported as
 * spam — from Resend's `email.bounced` and `email.complained` webhooks.
 *
 * Both take the reader off the list. A permanent bounce means the address
 * cannot receive mail, and sending to it again only teaches the receiving
 * servers that this domain mails dead addresses; a complaint is the reader
 * saying no in the strongest way a mail client lets them. Resend suppresses
 * such an address on its own as well, so this is about our list telling the
 * truth: the panel shows them as left, and the next campaign does not count
 * them.
 *
 * MATCHED ON RESEND'S ID FOR THE COPY, NEVER ON THE ADDRESS. The account and
 * its webhooks serve four sites, so a bounce for an address that happens to
 * be on our list may be a bounce of another site's order mail — saying nothing
 * about our newsletter. Only an event naming a copy we sent (its
 * `resend_email_id`) is ours to act on; anything else is ignored.
 */

export type DeliveryProblem = "bounced" | "complained";

export type ProblemOutcome = "recorded" | "already_recorded" | "not_ours";

export async function recordDeliveryProblem(
  problem: DeliveryProblem,
  resendEmailId: string,
  detail: string,
  at: Date,
): Promise<ProblemOutcome> {
  if (!resendEmailId) return "not_ours";

  /* A complaint after a bounce, or the same event retried, changes nothing
     already said; a complaint does replace a plain bounce record, being the
     stronger statement. */
  const [delivery] = await db
    .update(newsletterDeliveries)
    .set({ status: problem, error: detail.slice(0, 500) })
    .where(
      and(
        eq(newsletterDeliveries.resendEmailId, resendEmailId),
        notInArray(
          newsletterDeliveries.status,
          problem === "complained" ? ["complained"] : ["bounced", "complained"],
        ),
      ),
    )
    .returning({ subscriberId: newsletterDeliveries.subscriberId });

  if (!delivery) {
    const [known] = await db
      .select({ id: newsletterDeliveries.id })
      .from(newsletterDeliveries)
      .where(eq(newsletterDeliveries.resendEmailId, resendEmailId))
      .limit(1);
    return known ? "already_recorded" : "not_ours";
  }

  if (delivery.subscriberId) {
    const [left] = await db
      .update(newsletterSubscribers)
      .set({ unsubscribedAt: at })
      .where(
        and(
          eq(newsletterSubscribers.id, delivery.subscriberId),
          isNull(newsletterSubscribers.unsubscribedAt),
        ),
      )
      .returning({ id: newsletterSubscribers.id, email: newsletterSubscribers.email });
    // Resend's copy of the list, opted out of this site's topic only.
    if (left) syncUnsubscribedLater(left);
  }
  return "recorded";
}
