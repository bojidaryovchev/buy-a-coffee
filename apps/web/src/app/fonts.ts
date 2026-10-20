import localFont from "next/font/local";

/**
 * The two faces, defined once for the three documents that draw a page: the
 * shop's root layout (`(site)/[lang]/layout.tsx`), the panel's
 * (`(admin)/layout.tsx`) and the 404 for a URL that matched no route
 * (`global-not-found.tsx`).
 *
 * There is no `app/layout.tsx` any more. `<html lang>` has to follow the
 * locale, a root layout cannot read a dynamic segment below itself, so the
 * shop's root moved under `[lang]` — and with it every document became its own
 * root. `next/font` must be called at module scope, which is why the faces live
 * in this module rather than in any one of them.
 *
 * Both faces carry the Cyrillic subset. That is not optional: the catalog is
 * Bulgarian, and a Latin-only face would draw every product name in a fallback.
 * `test/fonts.test.ts` holds the subsets and what is preloaded.
 */
/**
 * Inter, self-hosted like Literata below, one face per subset, at the weights
 * the shop sets it in: 400 to 700 (normal, medium, semibold, and bold for
 * `<strong>`). Google serves the whole 100–900 axis, and the axis's far ends
 * are most of a variable font's bytes.
 *
 * The files are Google Fonts' own Inter 4.001 subset files — the ones
 * `next/font/google` served until 20 October 2026 — with the weight axis
 * limited to 400–700 by fontTools' instancer (`varLib.instancer wght=400:700`,
 * then re-saved as WOFF2 keeping every glyph, feature and name). Every
 * character draws the same at every weight in that range, to within one unit
 * of 2048, and the OpenType features are unchanged. Latin went from 48 to
 * 34 KB and Cyrillic from 19 to 13 KB: 20 KB less preloaded on every page.
 * Licence: `fonts/OFL-Inter.txt`.
 *
 * Latin Extended is not preloaded. It is 56 KB (85 KB at the full axis), and
 * no character in its range appears in the catalog, the dictionaries or the
 * copy (scanned on 20 October 2026; `test/fonts.test.ts` keeps scanning). On
 * 19 October, dropping its preload measured about 100 ms *later* on a real
 * Fast 4G link (`IMPLEMENTATION_PLAN.md`, K2); on 20 October, under PageSpeed
 * Insights' simulated slow 4G — which charges every byte requested before the
 * first paint — the 85 KB were half a second of mobile LCP (4.9 s with, 4.4 s
 * without, on the live home page). The score search engines read is the
 * second one. The face is still declared, so a page that does draw one of its
 * characters fetches it.
 *
 * The faces Google also served for Greek, Vietnamese and the rarer Cyrillic
 * letters are not carried: nothing here is written in them, and such a
 * character falls to the size-adjusted Arial below, as it would have while
 * its face loaded. As with Literata, the stack lists Cyrillic, Latin Extended,
 * Latin, and only the last carries the fallback.
 */
const interCyrillic = localFont({
  src: "./fonts/inter-wght-400-700-cyrillic.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-inter-cyrillic",
  adjustFontFallback: false,
  declarations: [
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

const interLatinExt = localFont({
  src: "./fonts/inter-wght-400-700-latin-ext.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-inter-latin-ext",
  adjustFontFallback: false,
  preload: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

const interLatin = localFont({
  src: "./fonts/inter-wght-400-700-latin.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-inter-latin",
  adjustFontFallback: "Arial",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

/**
 * Literata, at the one weight the shop sets it in (600), with its optical-size
 * axis — DESIGN.md, "Typography". The axis is what draws a 52 px heading with
 * the display design instead of the 14 pt text design stretched to size.
 *
 * Self-hosted because `next/font/google` loads an extra axis only together
 * with the whole weight range: 167 KB of Cyrillic and Latin, against 75 KB for
 * these files and 58 KB for the three fixed weights they replace (19 October
 * 2026). They are Google Fonts' own subset files for `opsz 7..72, wght 600`,
 * under the SIL Open Font License (`fonts/OFL-Literata.txt`).
 *
 * One face per subset, each with its own `unicode-range`, as Google serves
 * them, so a page downloads only the subsets its text uses. `--font-display`
 * lists them Cyrillic, Latin Extended, Latin: the first two match only their
 * own ranges, and only the last carries the size-adjusted fallback, so a
 * fallback never stands in for a subset that is merely still loading.
 * `next/font` takes only literal arguments, hence the ranges written out.
 */
const literataCyrillic = localFont({
  src: "./fonts/literata-opsz-600-cyrillic.woff2",
  weight: "600",
  style: "normal",
  display: "swap",
  variable: "--font-literata-cyrillic",
  adjustFontFallback: false,
  declarations: [
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

const literataLatinExt = localFont({
  src: "./fonts/literata-opsz-600-latin-ext.woff2",
  weight: "600",
  style: "normal",
  display: "swap",
  variable: "--font-literata-latin-ext",
  adjustFontFallback: false,
  // Brand names live in Latin-1 („Caffè“); this subset is rarely drawn.
  preload: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});

const literataLatin = localFont({
  src: "./fonts/literata-opsz-600-latin.woff2",
  weight: "600",
  style: "normal",
  display: "swap",
  variable: "--font-literata-latin",
  adjustFontFallback: "Times New Roman",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

/**
 * The accent: Literata italic 500 with its optical-size axis, for one phrase
 * on a page — the hero title's last words (DESIGN.md, "Typography"). Cyrillic
 * only, because the phrase is („с грижа“). Never preloaded, and
 * `font-display: optional`: a visit that does not have it within a moment
 * draws the upright face slanted instead and never swaps, so the accent can
 * neither delay nor shift anything; every visit after has it from cache.
 */
const literataItalic = localFont({
  src: "./fonts/literata-italic-opsz-500-cyrillic.woff2",
  weight: "500",
  style: "italic",
  display: "optional",
  variable: "--font-literata-italic",
  adjustFontFallback: false,
  preload: false,
  declarations: [
    { prop: "unicode-range", value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116" },
  ],
});

export const fontVariables = [
  interCyrillic.variable,
  interLatinExt.variable,
  interLatin.variable,
  literataCyrillic.variable,
  literataLatinExt.variable,
  literataLatin.variable,
  literataItalic.variable,
].join(" ");

/** The `<body>` every document shares. */
export const BODY_CLASS = "flex min-h-dvh flex-col bg-paper text-ink-900 antialiased";
