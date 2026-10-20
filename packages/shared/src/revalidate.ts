/**
 * Telling the storefront that the catalog changed, so the pages and the
 * sitemap that show it are drawn afresh now rather than when their timers run
 * out (`POST /api/revalidate`, `apps/web/src/app/api/revalidate/route.ts`).
 *
 * In this package so that every writer outside the app uses the one client:
 * the catalog sync and the copywriter (`apps/scraper`), and `copy:apply`
 * (`apps/web/scripts`). No dependencies and no I/O but the one `fetch`, which
 * a caller (and every test) may replace.
 *
 * **Optional, and never fatal.** Without a site URL or `CRON_SECRET` nothing is
 * sent and the result says which is missing; a refusal, a timeout or a
 * network error comes back as `ok: false` with the reason, never as a throw.
 * The change is already in the database: the pages pick it up within their
 * five minutes, and the sitemap within the CDN's hour, whatever happens here.
 *
 * The secret is sent as `Authorization: Bearer`, the way Vercel calls the cron
 * routes, and only to an `https:` site (or to this machine), never after a
 * redirect. Nothing here prints or returns it.
 */

export const REVALIDATE_ROUTE = "/api/revalidate";

/** Everything a sync can change, or these pages only. */
export type RevalidateBody =
  | { readonly scope: "catalog" }
  | { readonly paths?: readonly string[]; readonly slugs?: readonly string[] };

export interface StorefrontRevalidation {
  /** The storefront's origin, e.g. `https://buy-a-coffee.com`. */
  readonly siteUrl: string | null | undefined;
  /** `CRON_SECRET`, the storefront's own. */
  readonly secret: string | null | undefined;
  readonly body: RevalidateBody;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface StorefrontRevalidationResult {
  /** Why nothing was sent, when nothing was. */
  readonly skipped: "no-site-url" | "bad-site-url" | "insecure-site-url" | "no-secret" | null;
  /** True when the storefront answered 2xx. */
  readonly ok: boolean;
  /** The storefront's HTTP status, when it answered. */
  readonly status: number | null;
  /** Route patterns and single pages it reports refreshed. */
  readonly routes: number;
  readonly paths: number;
  /** What went wrong, without the secret: an error code from the answer, or the network's. */
  readonly error: string | null;
}

/** `SITE_URL`, else `NEXT_PUBLIC_SITE_URL`: the variables the scripts already read. */
export function revalidationSiteUrl(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return env.SITE_URL?.trim() || env.NEXT_PUBLIC_SITE_URL?.trim() || undefined;
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

const result = (
  fields: Partial<StorefrontRevalidationResult> & Pick<StorefrontRevalidationResult, "ok">,
): StorefrontRevalidationResult => ({
  skipped: null,
  status: null,
  routes: 0,
  paths: 0,
  error: null,
  ...fields,
});

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);

export async function requestRevalidation(
  request: StorefrontRevalidation,
): Promise<StorefrontRevalidationResult> {
  const siteUrl = request.siteUrl?.trim();
  if (!siteUrl) return result({ ok: false, skipped: "no-site-url" });
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return result({ ok: false, skipped: "bad-site-url" });
  }
  const local = LOCAL_HOST.test(site.hostname);
  if (site.protocol !== "https:" && !(site.protocol === "http:" && local)) {
    return result({ ok: false, skipped: "insecure-site-url" });
  }
  const secret = request.secret?.trim();
  if (!secret) return result({ ok: false, skipped: "no-secret" });

  const send = request.fetch ?? fetch;
  try {
    const response = await send(new URL(REVALIDATE_ROUTE, site.origin), {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request.body),
      // A redirect would carry the bearer token somewhere this did not choose.
      redirect: "manual",
      signal: AbortSignal.timeout(request.timeoutMs ?? 15_000),
    });
    const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const code = typeof answer?.error === "string" ? answer.error : `http_${response.status}`;
      return result({ ok: false, status: response.status, error: code });
    }
    return result({
      ok: true,
      status: response.status,
      routes: count(answer?.routes),
      paths: count(answer?.paths),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return result({
      ok: false,
      error:
        name === "TimeoutError" ? "timeout" : error instanceof Error ? error.message : "failed",
    });
  }
}
