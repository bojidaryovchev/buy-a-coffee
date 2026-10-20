import type { BrewMethod } from "@/lib/recommend/systems";
import { brandKeyBySlug } from "./brand-names";

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
 *  - `italian` is set by one standard, the same for every brand, and only
 *    with the evidence for it written beside the entry. **The brand's own
 *    site or its own pack places the brand in Italy, and nothing we found ties
 *    the label to a company elsewhere.** It places it there in one of four
 *    ways, and each entry's evidence opens with which:
 *     - `Company:` it names the Italian company that makes it, or that
 *       company's Italian registration;
 *     - `Town:` it prints the Italian town the house belongs to;
 *     - `Own words:` it calls the brand Italian in so many words, and the
 *       site shows no sign of a label run from elsewhere;
 *     - `Own site:` the brand's own site is an Italian site, on an Italian
 *       domain — the weakest of the four, and the only evidence recorded for
 *       Lollo Caffè and Foodness.
 *    Two things do not count on their own: a name that sounds Italian (Rema
 *    Caffè's own site says its coffee is made in Plovdiv), and where the
 *    coffee was roasted or packed, which a label owned anywhere can print.
 *  - `italianUnconfirmed` holds a brand that calls itself Italian but does
 *    not meet the standard yet — no company recorded, and signs of a label
 *    run from elsewhere — with what was found and where. Such a brand is
 *    called Italian nowhere (`isItalianBrand`), and an entry never has both.
 *    The evidence was checked on 9 and 16 October 2026 against the sites the
 *    logo provenance record names (`brand-logo-provenance.ts`), whose
 *    packaging checks are also where the packs' wording is recorded. It was
 *    sorted under this standard on 20 October 2026 from what was already
 *    recorded; nothing was looked up again.
 *
 * Searched and left out on 9 October 2026, so the next person need not repeat
 * it. **Este**, **Tezzoro** and **Elia** are Bulgarian: Este is the house
 * vending brand of Европейски Кафе Експерти ООД (formerly Enco Vending, Sofia),
 * and Elia and Tezzoro are made at its EV Coffee Factory
 * (enco-vending.com, "About" and "History"). **3 Bourbons** is a Bulgarian label
 * produced by ФОНТЕ ФРЕСКО ЕООД, Sofia. **Molini**: its packs say "Tostato in
 * Italia", which is where it was roasted and does not count on its own; its
 * own store, molini.coffee, is in Bulgarian; and the label appears to be a line
 * of РЕМА КАФЕ ЕООД, Plovdiv (remacaffe.com sells it under the vendor MOLINI),
 * which ties it to a company elsewhere. So by the standard above it is not
 * called Italian. **Eurocaf**: an Italian roaster of that name exists (EUROCAF
 * SRL, Druento, Turin, eurocafcaffe.it), but its site lists none of the four
 * coffees we sell and shows a different mark from the one on our packs, so it
 * is not established that it makes them. **Amann** and **Julius Meinl** have
 * not been checked and have no entry, so neither is called Italian.
 *
 * **Vandino** is held as unconfirmed: its own site calls it Italian but names
 * no company, and the review of 20 October 2026 found the pattern Molini shows
 * (its entry has the findings). It is not called Italian anywhere, the brand
 * index included, until its company is confirmed; then it becomes a
 * `Company:` entry, or stays out.
 *
 * Checked on 16 October 2026 for the three brands the sync added that day, and
 * entered below: **Moreno** (`cafe-moreno`, reached from its stored slug
 * `moreno` through `brandKeyBySlug` in `brand-names.ts`), **Excelsior** and
 * **Ristora**. The evidence for each is in its entry.
 */

export interface BrandFacts {
  /** The measured Cyrillic spelling, as it goes in a title: „Лаваца“. */
  readonly cyrillic?: string;
  /** Why we say the brand is Italian. Absent: we do not say it. */
  readonly italian?: string;
  /**
   * Why a brand that calls itself Italian is not called Italian yet: what was
   * found, and where. Never set beside `italian`.
   */
  readonly italianUnconfirmed?: string;
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
      "Company: biancaffe.com, an Italian-language site, whose footer reads 'P.IVA 00401330659. Torrefattori dal 1932' - an Italian VAT registration.",
  },
  bianchi: { cyrillic: "Бианчи" },
  "cafe-moreno": {
    italian:
      "Company: caffemoreno.it: Caffè Moreno SRL, Casoria (Naples), a family business founded in Naples in the 1960s; the bean bags print 'made in Italy'.",
  },
  borbone: {
    cyrillic: "Борбоне",
    italian:
      "Town: its pack prints NAPOLI under the BORBONE wordmark (the packaging check in brand-logo-provenance.ts); its own site is caffeborbone.com/it-it.",
  },
  caffitaly: {
    cyrillic: "Кафитали",
    italian: "Company: caffitaly.com: Caffitaly System, an Italian company.",
  },
  excelsior: {
    italian:
      "Company: torrefazionexcelsior.it: Caffè Excelsior srl, Busca (Cuneo); its 2026 export catalogue lists the six coffees we sell.",
  },
  foodness: { italian: "Own site: foodness.it, the brand's own Italian site." },
  illy: { cyrillic: "Или", italian: "Company: illy.com: illycaffè, Trieste." },
  kimbo: {
    cyrillic: "Кимбо",
    italian:
      "Town: the pack prints 'il Caffè di Napoli' under the wordmark; its own site is kimbo.it.",
  },
  lavazza: {
    cyrillic: "Лаваца",
    italian: "Town: the pack prints 'TORINO, ITALIA, 1895' under the wordmark.",
    formatPages: ["capsule", "beans"],
  },
  lollocafe: {
    cyrillic: "Лоло",
    italian: "Own site: lollocaffe.it, the brand's own Italian site.",
  },
  "rema-caffe": { cyrillic: "Рема" },
  ristora: {
    italian:
      "Company: ristora.it: a brand of Prontofoods S.p.A., Montichiari (Brescia); the Bulgarian label names it as the maker, in Italy.",
  },
  vandino: {
    italianUnconfirmed:
      "Its own site, vandinocaffe.com (the home page and the Espresso Bar page), calls it „италианска марка кафе“, but names no company (no imprint), has no Italian-language version (Bulgarian, English, Greek, Russian and Serbian only) and was made by a Bulgarian web studio; a Bulgarian distributor sells it (a zagatto.com listing). That is the Molini pattern. Found by the integrated review of 20 October 2026 and not re-checked here; Italian once its company is confirmed.",
  },
  vergnano: {
    italian: "Company: caffevergnano.com: Caffè Vergnano, an Italian roaster since 1882.",
  },
};

/** Letters and digits only, as `brandLookupKey` in `lib/catalog/brand-display.ts`. */
const lookupKey = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const FACTS = new Map(Object.entries(brandFacts).map(([key, facts]) => [lookupKey(key), facts]));

const NO_FACTS: BrandFacts = {};

/** The facts for a brand, by its slug or source key. Empty for an unknown brand. */
export function brandFactsFor(brand: { readonly slug: string }): BrandFacts {
  const key = brandKeyBySlug[brand.slug] ?? brand.slug;
  return FACTS.get(lookupKey(key)) ?? NO_FACTS;
}

/**
 * Whether the shop calls a brand Italian: recorded as Italian with its
 * evidence, and not held as unconfirmed. The one question the brand index's
 * sentence and the beans listing's Italian section both ask.
 */
export function isItalianBrand(brand: { readonly slug: string }): boolean {
  const facts = brandFactsFor(brand);
  return facts.italian !== undefined && facts.italianUnconfirmed === undefined;
}
