import { DEFAULT_LOCALE } from "@/i18n/config";
import { unsubscribeByToken } from "@/lib/forms/unsubscribe";
import { isPlausibleToken } from "@/lib/forms/unsubscribe-token";
import { href, routes } from "@/lib/routes";

/**
 * One-click unsubscribe (RFC 8058), the address in every newsletter's
 * `List-Unsubscribe` header.
 *
 * POST unsubscribes. That is what a mail client's own "Unsubscribe" button
 * sends — `List-Unsubscribe=One-Click` in a form body, the token in the URL —
 * and the client shows the reader no page, so this answers with a status and
 * nothing to read. The row is stamped exactly as by the unsubscribe page
 * (`unsubscribeByToken`), which also opts the address out of this site's
 * Resend topic after the response.
 *
 * GET never unsubscribes. Link scanners and previewers open every URL they
 * find with GET, and one of them must not take a reader off the list; a
 * person who opens this address in a browser is sent to the page, which asks
 * first. The page and this endpoint read the same token.
 *
 * The body is not required to say `List-Unsubscribe=One-Click`. The token is
 * the authority — 64 random hex characters only the subscriber was sent — and
 * a client that posts an empty body still meant to unsubscribe.
 */

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!isPlausibleToken(token)) return new Response("Invalid token", { status: 400 });

  const outcome = await unsubscribeByToken(token);
  if (outcome === "invalid") return new Response("Unknown token", { status: 404 });
  /* 200 with a body, not 204: RFC 8058 asks for a 2xx, and some mail
     providers' one-click handlers treat anything but a plain 200 as a failure
     and fall back to opening the link. */
  return new Response("Unsubscribed", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** To the page on the host that was asked, with the token if it looks like one. */
export async function GET(request: Request) {
  const asked = new URL(request.url);
  const token = asked.searchParams.get("token");
  const page = new URL(href(DEFAULT_LOCALE, routes.unsubscribe), asked.origin);
  if (isPlausibleToken(token)) page.searchParams.set("token", token);
  return Response.redirect(page.toString(), 303);
}
