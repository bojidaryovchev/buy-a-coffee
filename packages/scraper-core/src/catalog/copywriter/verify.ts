import type { SourceCheck } from "./apply.ts";
import { MIN_INDEPENDENT_SOURCES, independentHosts, roundedPack, siteOf } from "./apply.ts";

/**
 * Before a pack size is changed without a person, open the pages the model
 * cited and see that they say so.
 *
 * The model reports its sources; nothing makes them true. A hallucinated or
 * injected "high confidence, two shops" is caught here: at least two
 * independent sites must answer and print the figure. A page that cannot be
 * read (a bot wall, a script-only shop) does not count, which only ever holds
 * a correction back for the owner - the safe direction.
 *
 * The check is deliberately modest: the number must appear as a number on the
 * page. It does not prove the page means the pack size, but it rules out the
 * cases that matter - invented pages, dead links, pages about something else.
 */

const PAGE_TIMEOUT_MS = 12_000;
const MAX_PAGE_BYTES = 2_000_000;
const MAX_PAGES = 6;

export interface PageFetcher {
  (url: string, init: { signal: AbortSignal; headers: Record<string, string> }): Promise<Response>;
}

/** The page's visible text, roughly: tags, scripts and styles removed. */
export function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ");
}

/** Whether `text` prints `value` as a whole number ("16", "16x", "x16" - not "160" or "1.16"). */
export function printsNumber(text: string, value: number): boolean {
  return new RegExp(`(?<![\\d.,])${value}(?![\\d]|[.,]\\d)`).test(text);
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_PAGE_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export function createSourceCheck(
  fetchPage: PageFetcher = fetch,
  userAgent = "Mozilla/5.0 (compatible; buy-a-coffee catalog check; +https://buy-a-coffee.com)",
): SourceCheck {
  return async (pack) => {
    const value = roundedPack(pack.value);
    const allowed = new Set(independentHosts(pack.sources));
    const confirmed = new Set<string>();
    let tried = 0;
    for (const url of pack.sources) {
      if (confirmed.size >= MIN_INDEPENDENT_SOURCES || tried >= MAX_PAGES) break;
      let site: string;
      try {
        site = siteOf(new URL(url).hostname);
      } catch {
        continue;
      }
      if (!allowed.has(site) || confirmed.has(site)) continue;
      tried += 1;
      try {
        const response = await fetchPage(url, {
          signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
          headers: { "user-agent": userAgent, accept: "text/html,*/*;q=0.5" },
        });
        if (!response.ok) continue;
        if (printsNumber(pageText(await readCapped(response)), value)) confirmed.add(site);
      } catch {
        // Unreadable is unconfirmed; the correction waits for the owner.
      }
    }
    return confirmed.size >= MIN_INDEPENDENT_SOURCES
      ? null
      : `${confirmed.size} от цитираните сайтове се отвориха и посочват ${value} (нужни са ${MIN_INDEPENDENT_SOURCES})`;
  };
}
