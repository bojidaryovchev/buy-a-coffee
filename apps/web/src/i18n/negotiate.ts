import { DEFAULT_LOCALE, SHIPPING_LOCALES, isLocale, type Locale } from "@/i18n/config";

/**
 * Which language a visitor who has not named one gets: the bare `/` and
 * nothing else.
 *
 * **`Accept-Language` only.** It is a list the visitor configured in their own
 * browser — the closest thing to being asked that exists before a page has
 * rendered. Never the IP address or anything else geographic, for two reasons
 * that agree with each other (buy-a-vend's `proxy.ts` sets them out at length):
 *
 *   1. Regulation (EU) 2018/302 on geo-blocking forbids routing a visitor by
 *      nationality or place of residence without their consent, and requires
 *      the version they asked for to stay reachable.
 *   2. Googlebot crawls mostly from US addresses. Routing by geography would
 *      bounce it off the Bulgarian pages, which are the whole shop.
 *
 * **No cookie, unlike buy-a-vend.** Its switcher remembers a choice in a
 * preference cookie. This site's Cookies page promises a visitor that the shop
 * sets none, and that promise is worth more than remembering a language for a
 * second visit — the switcher is one click away, and every page carries its
 * locale in its URL anyway.
 *
 * With English switched off, every answer is Bulgarian.
 */
export function preferredLocale(
  acceptLanguage: string | null | undefined,
  shipping: readonly Locale[] = SHIPPING_LOCALES,
): Locale {
  for (const tag of rankedTags(acceptLanguage)) {
    // `en-GB`, `en-US` and `en` all want the one English we publish.
    const primary = tag.split("-")[0];
    if (isLocale(primary) && shipping.includes(primary)) return primary;
  }
  return shipping.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : (shipping[0] ?? DEFAULT_LOCALE);
}

/**
 * What the response to `/` varies on, so a shared cache cannot hand one
 * visitor's negotiated redirect to the next. No `Cookie`: nothing reads one.
 */
export const LOCALE_VARY = "Accept-Language";

/**
 * `Accept-Language` in preference order, best first (RFC 9110 §12.5.4).
 *
 * Tags carry an optional `;q=` from 0 to 1, defaulting to 1; `q=0` means "not
 * this one". The sort is stable, so tags with the same weight keep the order
 * the browser wrote them in. `*` is dropped: "anything will do" is answered by
 * the default, not by whichever of our locales happens to come first. A
 * malformed weight counts for nothing rather than everything.
 */
function rankedTags(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((entry) => {
      const [tag = "", ...params] = entry.trim().split(";");
      const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
      const quality = q === undefined ? 1 : Number.parseFloat(q.slice(2));
      return {
        tag: tag.trim().toLowerCase(),
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((entry) => entry.tag !== "" && entry.tag !== "*" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality)
    .map((entry) => entry.tag);
}
