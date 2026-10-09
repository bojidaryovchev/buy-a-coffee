import type { Metadata } from "next";
import { absoluteUrl } from "@/config/site";
import { HTML_LANG, SHIPPING_LOCALES, xDefaultLocale, type Locale } from "@/i18n/config";
import { href } from "@/lib/routes";

/**
 * Canonical and `hreflang`, for every page.
 *
 * **Both in one object, always, and on the page.** Next shallow-merges
 * `alternates` exactly as it does `openGraph`: a layout declaring `languages`
 * and a page declaring `canonical` ends with the page's object replacing the
 * layout's and the `hreflang` set gone. buy-a-vend shipped that bug and caught
 * it live; here the two are only ever built together.
 *
 * **Only shipping locales.** An alternate that 404s is worse than none — a
 * crawler that follows it learns the site is broken rather than untranslated.
 * While Bulgarian alone ships this emits one self-referencing `bg` alternate
 * and `x-default`, which is not a no-op: it tells a crawler the set is
 * complete.
 *
 * **`x-default`** points at English once English ships, Bulgarian until then
 * (`xDefaultLocale`).
 */

/** A page's public path in each locale. Categories and products differ per locale. */
export type LocalePath = (locale: Locale) => string;

export function languageAlternates(
  path: LocalePath,
  shipping: readonly Locale[] = SHIPPING_LOCALES,
): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of shipping) languages[HTML_LANG[locale]] = absoluteUrl(path(locale));
  languages["x-default"] = absoluteUrl(path(xDefaultLocale(shipping)));
  return languages;
}

/** `alternates` for a page whose path depends on the locale. */
export function localeAlternates(
  locale: Locale,
  path: LocalePath,
): NonNullable<Metadata["alternates"]> {
  return { canonical: absoluteUrl(path(locale)), languages: languageAlternates(path) };
}

/** `alternates` for a page at a canonical route, e.g. `routes.brands`. */
export function pageAlternates(
  locale: Locale,
  canonicalPath: string,
): NonNullable<Metadata["alternates"]> {
  return localeAlternates(locale, (each) => href(each, canonicalPath));
}
