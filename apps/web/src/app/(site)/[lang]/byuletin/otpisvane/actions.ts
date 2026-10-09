"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientFingerprint, createRateLimiter, sharedStore } from "@/lib/rate-limit";
import { unsubscribeByToken } from "@/lib/forms/unsubscribe";
import { isPlausibleToken } from "@/lib/forms/unsubscribe-token";
import { DEFAULT_LOCALE, isLocale, isShipping, type Locale } from "@/i18n/config";
import { href, routes } from "@/lib/routes";

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
 *
 * The page posts its own locale in a hidden field, because a server action is
 * told neither its route's params nor its root params; the answer comes back
 * in the language the question was asked in. Anything but a shipping locale
 * falls back to the default.
 */
const unsubscribeLimiter = createRateLimiter({
  name: "unsubscribe",
  limit: 10,
  windowMs: 10 * 60_000,
  onStoreError: "allow",
  store: sharedStore,
});

function pageFor(formData: FormData): string {
  const value = formData.get("locale");
  const locale: Locale =
    typeof value === "string" && isLocale(value) && isShipping(value) ? value : DEFAULT_LOCALE;
  return href(locale, routes.unsubscribe);
}

export async function unsubscribe(formData: FormData): Promise<void> {
  const PAGE = pageFor(formData);
  const limit = await unsubscribeLimiter.check(clientFingerprint(await headers()));
  if (!limit.allowed) redirect(`${PAGE}?status=busy`);

  const token = formData.get("token");
  if (!isPlausibleToken(token)) redirect(`${PAGE}?status=invalid`);

  const outcome = await unsubscribeByToken(token);
  // An address that is already off the list is as good as one just taken off.
  redirect(outcome === "invalid" ? `${PAGE}?status=invalid` : `${PAGE}?status=done`);
}
