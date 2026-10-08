/**
 * Category introductions.
 *
 * A short text shown under the product listing on a category page: who the
 * format is for, how to tell it is the right one, and where to go when unsure.
 * It sits below the products on purpose — someone who already knows what they
 * want should not scroll past an essay to reach it.
 *
 * The rules this copy was written under:
 *
 *  - Written from scratch, by us. Nothing here is adapted from anybody else's
 *    category text.
 *  - Every fact comes from this repository: the system descriptions in
 *    `src/lib/recommend/systems.ts` (what a capsule looks like, which machines
 *    take it, what we do not stock) and what the wizard does. Nothing about a
 *    system is invented.
 *  - Nothing that goes stale: no product counts, no prices, no brand lists.
 *    Those are on the page already, computed from the catalog.
 *  - The voice the wizard uses: plain, direct, addressed to „вие".
 *
 * Keyed by `categories.sourceKey` — the sync's stable identity for a category.
 * The storefront slug is derived from the Bulgarian name and would change with
 * an upstream rename; the key would not. A category with no entry simply has no
 * introduction: this file never blocks a new category.
 *
 * Each paragraph is plain text. The page renders the links to the wizard and
 * to the machine list itself, so the last paragraph can refer to both by name.
 */

export interface CategoryCopy {
  /** The section's own heading, rendered as an `h2` under the listing. */
  readonly heading: string;
  /** Two or three short paragraphs, plain text. */
  readonly paragraphs: readonly string[];
}

export const categoryCopy: Readonly<Record<string, CategoryCopy>> = {
  "kafe-na-zyrna": {
    heading: "За кого е кафето на зърна",
    paragraphs: [
      "Кафето на зърна е за хората, чиято машина мели сама, и за всеки, който има мелачка у дома. Зърната се смилат непосредствено преди приготвянето, затова тук не избирате система, а само вкус и размер на опаковката.",
      "Как да познаете, че това е вашият формат: отгоре на машината има контейнер, в който сипвате зърна, вместо да поставяте капсула или доза. Ако машината ви няма мелачка, ще ви трябва отделна — предварително мляно кафе в пакет не предлагаме.",
      "Колебаете се между няколко пакета? Помощникът за избор пита за вкуса ви и за това колко кафе се изпива, и подрежда подходящите зърна по цена на чаша, а не на опаковка.",
    ],
  },
  "kafe-kapsuli": {
    heading: "Как да изберете капсули",
    paragraphs: [
      "Капсулите са за машини, в които слагате капсула и машината прави останалото — без мелене и без дозиране.",
      "Важното тук е едно: капсулите от различните системи не са взаимозаменяеми. Капсула за Dolce Gusto не влиза в машина Nespresso, и обратното. Затова кафето в тази категория е разделено по системи — първо намерете своята, после избирайте по вкус.",
      "Ако не знаете коя система използва машината ви, потърсете я по марка и модел в списъка с машини. Помощникът за избор също започва оттам: първо машината, после вкусът.",
    ],
  },
  nespresso: {
    heading: "За кои машини са тези капсули",
    paragraphs: [
      "Тук са капсулите за класическите домашни машини Nespresso — системата, която се нарича Nespresso Original.",
      "Познават се по размера и формата: малка капсула като пресечен конус, широка около 37 мм и най-често алуминиева. Ако машината ви е Nespresso Vertuo, тези капсули няма да паснат — Vertuo приема само собствените си капсули с баркод по ръба, а такива не предлагаме. Същото се отнася за професионалните машини Nespresso, които работят с по-голяма капсула.",
      "Не сте сигурни коя Nespresso имате? Намерете модела в списъка с машини и ще видите какво приема, или оставете помощника за избор да ви преведе през въпросите.",
    ],
  },
  "dolce-gusto": {
    heading: "За кои машини са тези капсули",
    paragraphs: [
      "Тези капсули са за машините от системата Dolce Gusto и не пасват на никоя друга.",
      "Капсулата за Dolce Gusto е лесна за разпознаване: широка и ниска, от пластмаса, затворена отгоре със сребристо фолио. По ръба ѝ има баркод, който машината прочита сама.",
      "Ако капсулите, които използвате досега, изглеждат другояче, най-вероятно машината ви е от друга система. Проверете модела в списъка с машини или минете през помощника за избор, преди да поръчате.",
    ],
  },
  "lavazza-blue": {
    heading: "За кои машини са тези капсули",
    paragraphs: [
      "Lavazza Blue е системата на професионалните машини на Lavazza и най-често се среща в офиси.",
      "Капсулата е по-голяма и по-твърда от тази за A Modo Mio, а самата машина обикновено носи означение LB. Двете системи на Lavazza не са взаимозаменяеми: за домашна машина на Lavazza търсете капсули A Modo Mio, а не тези.",
      "Ако не можете да прецените коя от двете е вашата, потърсете модела в списъка с машини или отговорете на въпросите в помощника за избор.",
    ],
  },
  caffitaly: {
    heading: "За кои машини са тези капсули",
    paragraphs: [
      "Капсулите Caffitaly са за машините от едноименната система. Същият формат работи и в машините Tchibo Cafissimo и K-fee.",
      "Капсулата е пластмасова, с прозрачна или бяла основа. Формата ѝ напомня малка чашка с пръстен в горната част.",
      "Ако машината ви е от друга марка и не сте сигурни дали приема този формат, вижте я в списъка с машини или минете през помощника за избор.",
    ],
  },
  "a-modo-mio": {
    heading: "За кои машини са тези капсули",
    paragraphs: [
      "A Modo Mio е системата за домашните машини на Lavazza.",
      "Капсулата е малка и пластмасова, обикновено черна, с широк ръб отгоре. Не я бъркайте с Lavazza Blue: онази е по-голяма и по-твърда, предназначена е за професионалните машини с означение LB и не влиза в домашните.",
      "Ако се колебаете коя от двете системи на Lavazza имате, намерете модела в списъка с машини или оставете помощника за избор да ви насочи.",
    ],
  },
  "kafe-dozi": {
    heading: "За кого са хартиените дози",
    paragraphs: [
      "Хартиените дози ESE са за еспресо машини с цедка за дози.",
      "Дозата е плоска хартиена възглавничка с диаметър 44 мм. Ако вашата машина работи с капсули или сама мели зърна, дозите не са за нея — разгледайте съответната категория.",
      "Не сте сигурни дали машината ви приема дози? Потърсете я в списъка с машини или минете през помощника за избор — той започва с въпроса как правите кафето си.",
    ],
  },
};

/**
 * Keys a category is also known by.
 *
 * The same category can reach the page under more than one name: the catalog
 * snapshot in `reference/` keys the capsule parent as `kapsuli`, and our own
 * slug for beans is a different transliteration from its source key. Each
 * alias points at the entry above, so the copy has one home.
 */
const CATEGORY_KEY_ALIASES: Readonly<Record<string, string>> = {
  kapsuli: "kafe-kapsuli",
  "kafe-na-zarna": "kafe-na-zyrna",
};

/**
 * The introduction for a category, or null when none has been written.
 *
 * Tried by source key first and by slug second, each directly and then through
 * its alias. Null is a normal answer and renders nothing.
 */
export function categoryCopyFor(category: {
  readonly slug: string;
  readonly sourceKey?: string | null;
}): CategoryCopy | null {
  for (const key of [category.sourceKey, category.slug]) {
    if (!key) continue;
    // `Object.hasOwn`, so a category keyed "constructor" finds nothing.
    for (const candidate of [key, CATEGORY_KEY_ALIASES[key]]) {
      if (candidate && Object.hasOwn(categoryCopy, candidate)) {
        return categoryCopy[candidate] ?? null;
      }
    }
  }
  return null;
}
