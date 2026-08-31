import type { NextRequest } from "next/server";
import { MAX_QUERY_LENGTH } from "@/lib/catalog/filters";
import { MIN_SUGGESTION_TERM_LENGTH, suggestCatalog } from "@/lib/catalog/queries";
import { clientFingerprint, suggestLimiter } from "@/lib/rate-limit";

/**
 * Typeahead endpoint.
 *
 * The one place the storefront serves catalog JSON. It exists because the
 * dropdown needs product images and prices while the visitor is still typing,
 * and a server action cannot be called from a debounced keystroke handler
 * without queueing behind the router.
 *
 * It reads only what is already public on the results page, so the exposure is
 * nil. What it does need is a ceiling: one request per keystroke is a cheap
 * way to make a database work hard, hence the rate limit and the bounded term.
 */

export async function GET(request: NextRequest): Promise<Response> {
  const term = (request.nextUrl.searchParams.get("q") ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_QUERY_LENGTH);

  // Answered without touching the database, and so without spending a token.
  if (term.length < MIN_SUGGESTION_TERM_LENGTH) {
    return json({ term, products: [], brands: [], categories: [], total: 0 });
  }

  const { allowed, resetAt } = suggestLimiter.check(clientFingerprint(request.headers));
  if (!allowed) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))),
      },
    });
  }

  try {
    return json(await suggestCatalog(term));
  } catch (error) {
    /*
     * A failed suggestion is not a failed search: the form still submits and
     * the results page still works. Degrade to "no suggestions" rather than
     * putting an error in front of someone who is mid-word — but log it, or a
     * broken typeahead looks exactly like a catalog with nothing in it.
     */
    console.error(JSON.stringify({ level: "error", msg: "suggest.failed", error: String(error) }));
    return json({ term, products: [], brands: [], categories: [], total: 0 });
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      /*
       * Short shared caching, because a handful of prefixes account for most
       * of the typing on a catalog this size, and the results only move when
       * the nightly sync does.
       */
      "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      "x-robots-tag": "noindex",
    },
  });
}
