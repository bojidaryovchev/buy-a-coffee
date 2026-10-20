import { mailUrl } from "@/emails/theme";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { href, routes } from "@/lib/routes";

/**
 * The two ways out of the newsletter that a message carries, and the headers
 * that announce one of them.
 *
 * Kept free of `server-only` and of the database: the sender, the contact
 * sync, the mail templates' preview and the tests all build these, and they
 * must build them the same way. Both point at the deployment that sends the
 * message (`mailUrl`): a token is only known to that deployment's database.
 *
 *   - `unsubscribeUrl` is the PAGE (/bg/byuletin/otpisvane?token=…). It asks
 *     before it does anything, because mail scanners open every link in a
 *     message and one of them must not unsubscribe the reader. It is the link
 *     in the footer, and the `bac_unsubscribe_url` property in Resend.
 *   - `oneClickUnsubscribeUrl` is the ENDPOINT (/api/newsletter/unsubscribe).
 *     A mail client's own "Unsubscribe" button POSTs to it with the body
 *     `List-Unsubscribe=One-Click` (RFC 8058), and that POST unsubscribes —
 *     a scanner follows links with GET, which only redirects to the page.
 *     Gmail and Yahoo require this of bulk senders.
 */

export function unsubscribeUrl(token: string): string {
  const url = new URL(mailUrl(href(DEFAULT_LOCALE, routes.unsubscribe)));
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * The promotions page, as a letter links to it in its text: absolute, on the
 * sending deployment, with the newsletter's `utm_*` — the same three the
 * product cards carry (`emails/product-cards.tsx`), so the visits a letter
 * brings are counted as its, wherever in it they were clicked.
 */
export function promotionsPageUrl(campaign: string): string {
  const url = new URL(mailUrl(href(DEFAULT_LOCALE, routes.promotions)));
  url.searchParams.set("utm_source", "newsletter");
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

export function oneClickUnsubscribeUrl(token: string): string {
  const url = new URL(mailUrl("/api/newsletter/unsubscribe"));
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * `List-Unsubscribe` with the one-click endpoint, and the
 * `List-Unsubscribe-Post` that says a POST to it needs nothing else (RFC 8058,
 * section 3.1). Only the https form: a `mailto:` alternative would arrive in
 * our own inbox as a message somebody has to act on by hand.
 */
export function listUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickUnsubscribeUrl(token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
