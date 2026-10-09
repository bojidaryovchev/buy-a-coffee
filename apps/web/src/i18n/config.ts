/**
 * Locales.
 *
 * **Every locale is prefixed, Bulgarian included** — `/bg/kafe-kapsuli`,
 * `/en/coffee-capsules`. A bare default beside prefixed siblings makes a path
 * ambiguous: is `/kafe-kapsuli` the Bulgarian page or a redirect to one? Search
 * engines settle that ambiguity by guessing, and the page that loses the guess
 * is the home market's. The sister site buy-a-vend made the same call for the
 * same reason.
 *
 * **Language-only codes, no regions.** The shop ships within Bulgaria and
 * nowhere else, so `bg-BG` or `en-GB` in a URL would say something about a
 * market that the business does not have. A region is added the day there is a
 * second market for one language, not before.
 *
 * Adding a language is four things and nothing else: its dictionary
 * (`i18n/dictionaries/<locale>.ts`), its slugs (`i18n/slugs/<locale>.ts`), its
 * content, and its `LOCALE_READY` flag. Every map below is a
 * `Record<Locale, …>`, so declaring the locale here and forgetting one of them
 * is a type error.
 */

export const LOCALES = ["bg", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * What a bare `/` falls back to when the visitor's browser names no language we
 * ship, and the language of everything that has no locale of its own: the 404
 * for a URL that matched no route, the share card, `llms.txt`.
 *
 * Bulgarian: it is the only market, and the catalog is written in it.
 */
export const DEFAULT_LOCALE: Locale = "bg";

/**
 * The locale `hreflang="x-default"` prefers.
 *
 * `x-default` answers "which page for a reader none of our languages serves" —
 * a German or a Romanian visitor. English is the honest answer to that, and it
 * is a different question from what `/` resolves to, which is why the two are
 * separate constants. While English is switched off `xDefaultLocale()` falls
 * back to `DEFAULT_LOCALE`, so the tag never points at a 404.
 */
export const X_DEFAULT_PREFERENCE: Locale = "en";

export const isLocale = (value: string | null | undefined): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/**
 * Which locales have content, and therefore ship.
 *
 * The machinery for English is complete — routing, slugs, the frame's
 * dictionary, formatting — and the content is not: every product description,
 * category introduction, journal article and legal document is Bulgarian. A
 * locale switched on before its content exists publishes Bulgarian pages under
 * English URLs, which teaches search engines those URLs are duplicates and is
 * harder to recover from than shipping late.
 *
 * So the gate is data. A locale that is `false` serves nothing (its layout
 * 404s), appears in no `hreflang`, no sitemap and no language switcher, and is
 * never the answer to `Accept-Language`. Flip it when the content is written,
 * not when the dictionary is.
 */
export const LOCALE_READY: Readonly<Record<Locale, boolean>> = {
  bg: true,
  en: false,
};

/** The locales that render, are indexed and appear in the switcher, in `LOCALES` order. */
export const SHIPPING_LOCALES: readonly Locale[] = LOCALES.filter((locale) => LOCALE_READY[locale]);

/**
 * True for a locale that has content and should be reachable.
 *
 * Separate from `isLocale` on purpose: `en` is a real locale whose URLs are
 * already worked out, and until its content exists a request for `/en` must
 * 404 rather than serve Bulgarian under an English address.
 */
export const isShipping = (locale: Locale): boolean => LOCALE_READY[locale];

/** `x-default`'s target: English when it ships, Bulgarian otherwise. */
export function xDefaultLocale(shipping: readonly Locale[] = SHIPPING_LOCALES): Locale {
  return shipping.includes(X_DEFAULT_PREFERENCE) ? X_DEFAULT_PREFERENCE : DEFAULT_LOCALE;
}

/**
 * `<html lang>` and `hreflang`.
 *
 * Bare language subtags, matching the URLs. `bg` alone is enough for the
 * browser to pick Bulgarian Cyrillic letterforms; it is what this site has
 * always declared.
 */
export const HTML_LANG: Readonly<Record<Locale, string>> = {
  bg: "bg",
  en: "en",
};

/**
 * The tag `Intl` formats numbers and money with.
 *
 * A separate constant from `HTML_LANG` because the two answer different
 * questions: `<html lang>` names a language, while a number format needs a
 * convention. `9,50 €` is Bulgarian; an English reader in Bulgaria still reads
 * `€9.50` most easily, and British English is the convention closest to how the
 * shop's English-speaking customers write a price.
 */
export const NUMBER_LOCALE: Readonly<Record<Locale, string>> = {
  bg: "bg-BG",
  en: "en-GB",
};

/** Open Graph's `og:locale`, which wants the underscore form with a region. */
export const OG_LOCALE: Readonly<Record<Locale, string>> = {
  bg: "bg_BG",
  en: "en_GB",
};

/** Endonyms: a language switcher is written in the language you switch to. */
export const LOCALE_LABEL: Readonly<Record<Locale, string>> = {
  bg: "Български",
  en: "English",
};
