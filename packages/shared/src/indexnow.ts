/**
 * IndexNow: telling search engines which URLs changed, instead of waiting for
 * them to recrawl.
 *
 * One POST to `api.indexnow.org` reaches every engine in the protocol (Bing,
 * Yandex, Seznam, Naver and others; Google does not take part). The request
 * names the site's host and a key; the engine fetches `https://<host>/<key>.txt`
 * and accepts the URLs only when that file holds the same key. The storefront
 * serves the file from `INDEXNOW_KEY` (`apps/web/src/app/indexnow/[key]`).
 *
 * In this package so that both sides can use it: the catalog sync, which knows
 * which product pages changed, and the storefront's command-line script, which
 * submits the whole sitemap once. No dependencies and no I/O but the one
 * `fetch`, which a caller (and every test) may replace.
 *
 * **A no-op without a key.** No key, or one the protocol would refuse, and
 * nothing is sent; the result says why. A preview or a laptop with no key
 * therefore never pings a search engine about URLs that are not the site's.
 */

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** The protocol's own limit on URLs per request. */
export const INDEXNOW_BATCH = 10_000;

/** 8 to 128 characters of letters, digits and dashes, as the protocol defines a key. */
export function isIndexNowKey(key: string | null | undefined): key is string {
  return typeof key === "string" && /^[a-zA-Z0-9-]{8,128}$/.test(key);
}

/** Where the engines look for the key: the site's root, `<key>.txt`. */
export function indexNowKeyLocation(siteUrl: string, key: string): string {
  return `${new URL(siteUrl).origin}/${key}.txt`;
}

export interface IndexNowSubmission {
  /** The site the URLs belong to, e.g. `https://buy-a-coffee.com`. */
  readonly siteUrl: string;
  /** `INDEXNOW_KEY`. Absent or malformed, nothing is sent. */
  readonly key: string | null | undefined;
  /** Absolute URLs that changed. Any not on the site's host is dropped. */
  readonly urls: Iterable<string>;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
}

export interface IndexNowResult {
  /** Why nothing was sent, when nothing was. */
  readonly skipped: "no-key" | "invalid-key" | "no-urls" | null;
  /** URLs sent, after dropping duplicates and other hosts. */
  readonly submitted: number;
  /** URLs dropped because they are not on the site's host. */
  readonly foreign: number;
  /** One HTTP status per request. 200 and 202 are success. */
  readonly statuses: readonly number[];
  /** True when every request was accepted. */
  readonly ok: boolean;
}

/**
 * Submit changed URLs. Never throws for a refusal: a 4xx or 5xx comes back in
 * `statuses` with `ok: false`, because a sync that changed a hundred prices
 * must not fail over a search engine's answer. A network error does throw.
 */
export async function submitIndexNow(submission: IndexNowSubmission): Promise<IndexNowResult> {
  const { siteUrl, key } = submission;
  const nothing = (skipped: IndexNowResult["skipped"], foreign = 0): IndexNowResult => ({
    skipped,
    submitted: 0,
    foreign,
    statuses: [],
    ok: skipped === "no-urls",
  });
  if (!key) return nothing("no-key");
  if (!isIndexNowKey(key)) return nothing("invalid-key");

  const site = new URL(siteUrl);
  const unique = new Set<string>();
  let foreign = 0;
  for (const raw of submission.urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      foreign += 1;
      continue;
    }
    if (url.host !== site.host || url.protocol !== site.protocol) foreign += 1;
    else unique.add(url.href);
  }
  if (unique.size === 0) return nothing("no-urls", foreign);

  const send = submission.fetch ?? fetch;
  const urls = [...unique];
  const statuses: number[] = [];
  for (let start = 0; start < urls.length; start += INDEXNOW_BATCH) {
    const response = await send(submission.endpoint ?? INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: site.host,
        key,
        keyLocation: indexNowKeyLocation(siteUrl, key),
        urlList: urls.slice(start, start + INDEXNOW_BATCH),
      }),
    });
    statuses.push(response.status);
  }

  return {
    skipped: null,
    submitted: urls.length,
    foreign,
    statuses,
    ok: statuses.every((status) => status === 200 || status === 202),
  };
}
