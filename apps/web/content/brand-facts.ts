import type { BrewMethod } from "@/lib/recommend/systems";

/**
 * Two facts about a brand that the catalog does not hold: how Bulgarians spell
 * its name, and whether it is Italian.
 *
 * Keyed by the brand's source key in lower-case kebab form, like
 * `brand-names.ts`, and looked up as forgivingly (`brandFactsFor`). **Never
 * required**: a brand with no entry gets a title in one alphabet and is left
 * out of the sentence about Italian brands, which is worded so that leaving a
 * brand out is never a false statement.
 *
 * The rules this list is written under:
 *
 *  - `cyrillic` is set only where the market study measured the Cyrillic
 *    spelling as something people type (`docs/seo.md` §2.2 and §2.5):
 *    „лаваца“, „бианчи“, „кимбо“, „борбоне“, „рема кафе“, „лоло кафе“,
 *    „кафитали“, „или кафе“. A transliteration nobody was measured typing is
 *    a guess, and a guessed spelling of somebody's trademark in a page title
 *    is worse than none.
 *  - `italian` is set only with the evidence written beside it: what the
 *    brand's own site or its pack says. A brand that merely sounds Italian is
 *    not listed — Rema Caffè's own site says its coffee is made in Plovdiv.
 *    Checked on 9 October 2026 against the sites the logo provenance record
 *    names (`brand-logo-provenance.ts`).
 */

export interface BrandFacts {
  /** The measured Cyrillic spelling, as it goes in a title: „Лаваца“. */
  readonly cyrillic?: string;
  /** Why we say the brand is Italian. Absent: we do not say it. */
  readonly italian?: string;
  /**
   * Formats this brand has a page of its own for (`docs/seo.md` §8). Those
   * pages own „<brand> капсули“ and „<brand> на зърна“, so the brand page's
   * title keeps the format word away from the name.
   */
  readonly formatPages?: readonly BrewMethod[];
}

export const brandFacts: Readonly<Record<string, BrandFacts>> = {
  biancaffe: {
    italian:
      "biancaffe.com: an Italian-language site; the footer reads 'P.IVA 00401330659. Torrefattori dal 1932'.",
  },
  bianchi: { cyrillic: "Бианчи" },
  borbone: {
    cyrillic: "Борбоне",
    italian: "caffeborbone.com/it-it, the brand's own Italian site.",
  },
  caffitaly: {
    cyrillic: "Кафитали",
    italian: "caffitaly.com: Caffitaly System, an Italian company.",
  },
  foodness: { italian: "foodness.it, the brand's own Italian site." },
  illy: { cyrillic: "Или", italian: "illy.com: illycaffè, Trieste." },
  kimbo: {
    cyrillic: "Кимбо",
    italian: "kimbo.it; the pack prints 'il Caffè di Napoli' under the wordmark.",
  },
  lavazza: {
    cyrillic: "Лаваца",
    italian: "The pack prints 'TORINO, ITALIA, 1895' under the wordmark.",
    formatPages: ["capsule", "beans"],
  },
  lollocafe: { cyrillic: "Лоло", italian: "lollocaffe.it, the brand's own Italian site." },
  "rema-caffe": { cyrillic: "Рема" },
  vandino: {
    italian: "vandinocaffe.com calls it an Italian coffee brand, produced and packed in Italy.",
  },
  vergnano: { italian: "caffevergnano.com: Caffè Vergnano, an Italian roaster since 1882." },
};

/** Letters and digits only, as `brandLookupKey` in `lib/catalog/brand-display.ts`. */
const lookupKey = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const FACTS = new Map(Object.entries(brandFacts).map(([key, facts]) => [lookupKey(key), facts]));

const NO_FACTS: BrandFacts = {};

/** The facts for a brand, by its slug or source key. Empty for an unknown brand. */
export function brandFactsFor(brand: { readonly slug: string }): BrandFacts {
  return FACTS.get(lookupKey(brand.slug)) ?? NO_FACTS;
}
