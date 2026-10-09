import type { LocaleSlugs } from "./types";

/**
 * Every Bulgarian slug the shop publishes. Changing one is a one-line edit
 * here, and nothing else: `href()` emits the new spelling everywhere, the proxy
 * serves it from the same folder, and the old spelling answers 308.
 *
 * Latin transliteration, never Cyrillic: a percent-encoded Cyrillic URL is
 * unreadable the moment anyone pastes it into a message. The legal slugs match
 * the sister site buy-a-vend.
 *
 * The spellings follow the Bulgarian market study of October 2026, which
 * revised the first measurement in three ways worth knowing before editing:
 *
 *   - **The system or brand comes first.** Bulgarians type „неспресо капсули“
 *     (1,900/mo) over „капсули неспресо“ (1,300), „nespresso капсули“ (1,600)
 *     over „капсули nespresso“ (260), „dolce gusto капсули“ (1,900) over
 *     „капсули dolce gusto“ (320) — so every system's landing slug is
 *     `<system>-kapsuli`.
 *   - **`blog`, not `dnevnik`.** „дневник“ is a 110,000/mo term for school
 *     e-registers and a newspaper; the journal would rank against neither.
 *   - **`kafe-za-vending-mashini`** („кафе за вендинг машини“ 90/mo) over
 *     `kafe-za-vending` (50/mo).
 *
 * And the two pages the first measurement left open:
 *
 *   - `izbor-na-kafe` — the recommendation wizard: "choosing a coffee", which
 *     is what the page helps with, in the words a visitor would say it.
 *   - `za-kafemashina` — the machine finder, `za-kafemashina/<brand>`: coffee
 *     "for the coffee machine". „кафемашина“ (6,600/mo) is what owners call the
 *     machine on their counter, and the `za-` says the page is about what goes
 *     in it, not a shop that sells the machine.
 */
export const bg: LocaleSlugs = {
  segments: {
    kategorii: "kategorii",
    marki: "marki",
    tarsene: "tarsene",
    promotsii: "promotsii",
    "kafe-za-vending-mashini": "kafe-za-vending-mashini",
    konsumativi: "konsumativi",
    "lavazza-kapsuli": "lavazza-kapsuli",
    "kafe-na-zarna-lavazza": "kafe-na-zarna-lavazza",
    "bezkofeinovo-kafe": "bezkofeinovo-kafe",
    "nay-evtino-na-chasha": "nay-evtino-na-chasha",
    "dostavka-i-plashtane": "dostavka-i-plashtane",
    kontakti: "kontakti",
    poveritelnost: "poveritelnost",
    "obshti-usloviya": "obshti-usloviya",
    biskvitki: "biskvitki",
    blog: "blog",
    "izbor-na-kafe": "izbor-na-kafe",
    "izbor-na-kafe/rezultat": "rezultat",
    "za-kafemashina": "za-kafemashina",
    byuletin: "byuletin",
    "byuletin/otpisvane": "otpisvane",
  },
  categories: {
    "kafe-kapsuli": "kafe-kapsuli",
    nespresso: "nespresso-kapsuli",
    "dolce-gusto": "dolce-gusto-kapsuli",
    "lavazza-blue": "lavazza-blue-kapsuli",
    "a-modo-mio": "lavazza-a-modo-mio-kapsuli",
    caffitaly: "caffitaly-kapsuli",
    "kafe-na-zyrna": "kafe-na-zarna",
    "kafe-dozi": "kafe-dozi",
  },
  /*
   * A brand's name is not translated, so these are the same in every locale.
   * Only the two whose stored slug differs from the brand's own spelling
   * (`content/brand-names.ts`): the other eighteen are already right.
   */
  brands: {
    lollocafe: "lollo-caffe",
    "3-bourbons": "3-bourbons",
  },
};
