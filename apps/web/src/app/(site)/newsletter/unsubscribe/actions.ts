"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientFingerprint, createRateLimiter, sharedStore } from "@/lib/rate-limit";
import { unsubscribeByToken } from "@/lib/forms/unsubscribe";
import { isPlausibleToken } from "@/lib/forms/unsubscribe-token";

/**
 * The POST behind the unsubscribe page's button.
 *
 * Same order as every public write: rate limit, validate, persist. It
 * redirects instead of returning state so the result is an ordinary page — the
 * button works with JavaScript off, and a reload does not re-submit.
 *
 * The limit is generous (a person clicks once) and fails open for the reason
 * the form limiters do: refusing a person who wants off the list because a
 * counter table is unreachable would be the worse failure.
 */
const unsubscribeLimiter = createRateLimiter({
  name: "unsubscribe",
  limit: 10,
  windowMs: 10 * 60_000,
  onStoreError: "allow",
  store: sharedStore,
});

const PAGE = "/newsletter/unsubscribe";

export async function unsubscribe(formData: FormData): Promise<void> {
  const limit = await unsubscribeLimiter.check(clientFingerprint(await headers()));
  if (!limit.allowed) redirect(`${PAGE}?status=busy`);

  const token = formData.get("token");
  if (!isPlausibleToken(token)) redirect(`${PAGE}?status=invalid`);

  const outcome = await unsubscribeByToken(token);
  // An address that is already off the list is as good as one just taken off.
  redirect(outcome === "invalid" ? `${PAGE}?status=invalid` : `${PAGE}?status=done`);
}
