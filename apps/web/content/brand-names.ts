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
 * The rules this list is written under:
 *
 *  - A brand is spelled the way it spells itself where that has been checked
 *    against its own website and packs, accents included: illy in lower case,
 *    Biancaffè, Lollo Caffè, 3 Bourbons. The evidence for each is the
 *    provenance record that came with the logos (`brand-logo-provenance.ts`).
 *  - Rema Caffè is the one compromise: the brand's site and pods set it as
 *    one word with an acute accent, "remacaffé", and some of its own pages
 *    write "Rema Caffè". Two words with the grave is how our product copy
 *    already writes it and how Italian writes "caffè".
 *  - A descriptor the brand sets beside its name is not part of the name:
 *    "Kaffee" under Amann, "Coffee" under Bianchi, "Caffè" in front of
 *    Borbone and Vergnano, "Caffè" under Vandino. Our product names and the
 *    URLs use the short name, and so does the page.
 *  - A wordmark's styling is not a spelling: molini's packs set the name in
 *    lower case, but nothing the brand writes in running text does, so it
 *    stays title-cased.
 *  - Everything else is a clean title-case of what the catalogue gives, split
 *    into words where the source key splits it. No guessed accents and no
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
  biancaffe: "Biancaffè",
  bianchi: "Bianchi",
  // Caffè Moreno; "Caffè" is a descriptor here, as for Borbone and Vergnano.
  "cafe-moreno": "Moreno",
  borbone: "Borbone",
  caffitaly: "Caffitaly",
  elia: "Elia",
  este: "Este",
  eurocaf: "Eurocaf",
  // Caffè Excelsior, Busca; the name is the brand, "Caffè" the descriptor.
  excelsior: "Excelsior",
  foodness: "Foodness",
  illy: "illy",
  "julius-meinl": "Julius Meinl",
  kimbo: "Kimbo",
  lavazza: "Lavazza",
  lollocafe: "Lollo Caffè",
  molini: "Molini",
  "rema-caffe": "Rema Caffè",
  // The wordmark is lower-case; a wordmark's styling is not a spelling.
  ristora: "Ristora",
  tezzoro: "Tezzoro",
  vandino: "Vandino",
  vergnano: "Vergnano",
};

/**
 * Stored slugs that are not a spelling of the brand's source key, mapped to
 * that key. Pages look a brand's logo and facts up by the stored slug, and
 * folding case and separators cannot turn `moreno` into `cafe-moreno`, the key
 * the supplier gives Caffè Moreno. The slug is the catalog's own
 * (`brands.slug`), not chosen here; if a sync ever changes it, the entry has
 * to follow.
 */
export const brandKeyBySlug: Readonly<Record<string, string>> = { moreno: "cafe-moreno" };
