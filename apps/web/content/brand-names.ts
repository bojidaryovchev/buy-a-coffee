/**
 * Brand display names.
 *
 * The sync stores a brand's name exactly as the supplier's catalogue types it,
 * and that typing is inconsistent: shouting capitals, a trailing space, two
 * words run together. The stored name stays untouched — it is what the sync
 * compares on its next run, and what the listings sort by — and this map says
 * how the brand is written on the page instead.
 *
 * Keyed by the brand's source key in lower-case kebab form. Lookup is
 * forgiving about separators and case (see `brand-display.ts`), so `3-bourbons`
 * here still matches a brand that arrives as "3bourbons".
 *
 * The rules this list was written under:
 *
 *  - A brand is spelled the way it spells itself only where that is common
 *    public knowledge. That is one entry today: illy writes its name in lower
 *    case.
 *  - Everything else is a clean title-case of what the catalogue gives, split
 *    into words where the source key splits it. No accents, no "Caffè", no
 *    legal suffixes: a guessed diacritic on somebody else's trademark is worse
 *    than a plain spelling.
 *
 * This file is never required. A brand with no entry is trimmed and cased by
 * the fallback in `brand-display.ts`, so a brand that first appears in
 * tomorrow's sync shows up correctly today.
 */
export const brandDisplayNames: Readonly<Record<string, string>> = {
  "3-bourbons": "3 Bourbons",
  amann: "Amann",
  biancaffe: "Biancaffe",
  bianchi: "Bianchi",
  borbone: "Borbone",
  caffitaly: "Caffitaly",
  elia: "Elia",
  este: "Este",
  eurocaf: "Eurocaf",
  foodness: "Foodness",
  illy: "illy",
  "julius-meinl": "Julius Meinl",
  kimbo: "Kimbo",
  lavazza: "Lavazza",
  lollocafe: "Lollocafe",
  molini: "Molini",
  "rema-caffe": "Rema Caffe",
  tezzoro: "Tezzoro",
  vandino: "Vandino",
  vergnano: "Vergnano",
};
