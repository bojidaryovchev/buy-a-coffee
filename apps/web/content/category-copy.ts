import type { BeansSectionId } from "@/lib/catalog/beans-sections";
import { routes, type RouteTarget } from "@/lib/routes";
import { CHOOSE_BEANS_SLUG } from "./journal/articles/slugs";
import { WHICH_CAPSULE_SLUG } from "./journal/articles/which-capsule";

/**
 * Category copy: what a listing is called, and its introduction.
 *
 * **The names.** A category's stored name is whatever the catalog calls it
 * („Dolce Gusto“). What the page is titled, headed and linked as is decided
 * here, from the market study (`docs/seo.md` §1 and §12): the title leads with
 * the words people type, in both alphabets where both are typed, and the
 * heading says „за“ or „съвместими с“ a system, because a third-party capsule
 * is never presented as the system owner's own (`PRODUCT.md`).
 *
 * **One page owns each search term.** No title or heading here may carry the
 * head term of another page: „без кофеин“ belongs to the decaf page, „лаваца
 * капсули“ to the Lavazza capsules page, „Tchibo Cafissimo“ to that machine's
 * page. `test/keyword-map.test.ts` holds the whole table.
 *
 * **The introduction.** A short text shown under the product listing: who the
 * format is for, how to tell it is the right one, and where to go when unsure.
 * It sits below the products on purpose — someone who already knows what they
 * want should not scroll past an essay to reach it.
 *
 * **The lead.** Two or three sentences above the products, on the first page
 * only, in the words the page's searches use — the Cyrillic spelling where
 * that is what most people type, and „съвместими“. Short on purpose, for the
 * same reason. Released in stages so each stage can be judged on its own
 * (research `09`, Milestone 1): Dolce Gusto, Nespresso, beans and ESE pods
 * first; Lavazza Blue, A Modo Mio, Caffitaly and the capsule hub follow in a
 * later release and until then keep their heading and the generic sentence.
 *
 * **The sections.** The beans listing also answers two narrower searches under
 * headings of their own, below the products: Italian beans, and beans for an
 * automatic machine (research `09`, T2.2). A few sentences each, the first
 * over one pack per Italian brand; see `ListingSectionCopy`.
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
 *    Those are on the page already, computed from the catalog. A title that
 *    names a pack size or the systems on sale takes them as `{pack}` and
 *    `{systems}`, filled from the catalog when the page is rendered.
 *  - The voice the wizard uses: plain, direct, addressed to „вие".
 *
 * Keyed by `categories.sourceKey` — the sync's stable identity for a category.
 * The storefront slug is derived from the Bulgarian name and would change with
 * an upstream rename; the key would not. A category with no entry keeps its
 * stored name and has no introduction: this file never blocks a new category.
 *
 * Each paragraph is plain text. A paragraph that mentions another listing
 * links to it: `links` names the phrase and where it goes, and the page wraps
 * that phrase. The link to the wizard is rendered by the page itself, and so
 * is the one link to the machine list that a system's listing carries.
 */

/** A phrase inside a paragraph, and the page that owns what it names. */
export interface CopyLink {
  /** Exactly as it stands in one of the paragraphs, once. */
  readonly phrase: string;
  readonly to: RouteTarget;
}

/**
 * A short section under the listing, with a heading of its own.
 *
 * The beans listing has two (research `09`, T2.2): searches for Italian beans
 * and for beans for an automatic machine are answered on the beans page under
 * headings of their own, before any of them is given an address. What each
 * shows is `lib/catalog/beans-sections.ts`, from data: one pack per Italian
 * brand under the first, no products under the second. The words here say
 * what is shown and by which rule, and never name a product, a brand, a count
 * or a price, so nothing in them goes stale when the catalog moves. The page
 * shows the sections only on the first page of the unfiltered listing.
 */
export interface ListingSectionCopy {
  /**
   * The section's `h2`, in the words the search uses. Never another page's
   * head term (`test/keyword-map.ts`); the beans page owns „кафе на зърна“.
   */
  readonly heading: string;
  /** One to three sentences, plain text, in reading order; see `sectionText`. */
  readonly sentences: readonly SectionSentence[];
  /** Each phrase stands in a sentence that is always said. */
  readonly links?: readonly CopyLink[];
}

/**
 * A sentence, or one said only while the catalog bears it out.
 *
 * `unlessFlavoured`: only while no flavoured coffee (`aromas: yes`) is among
 * the beans on sale. „Every bean here suits an automatic machine“ is true of
 * the beans the shop sells today; of a flavoured one it is not something the
 * shop knows, so on the day the sync brings one the sentence is not said, and
 * the sentences around it still read as a whole.
 */
export type SectionSentence = string | { readonly text: string; readonly unlessFlavoured: true };

/** The sentences a section says, as one paragraph, given what the catalog holds. */
export function sectionText(
  copy: ListingSectionCopy,
  catalog: { readonly flavoured: boolean },
): string {
  return copy.sentences
    .flatMap((sentence) =>
      typeof sentence === "string"
        ? [sentence]
        : sentence.unlessFlavoured && catalog.flavoured
          ? []
          : [sentence.text],
    )
    .join(" ");
}

export interface CategoryCopy {
  /**
   * What other pages call this one: the breadcrumb, a chip, a link. The head
   * term the page owns, or a natural variant of it.
   */
  readonly name: string;
  /** The page's `h1`. */
  readonly h1: string;
  /**
   * Above the products on the first page, 40–60 words: the page's head phrase,
   * what the format fits, and what it does not. In place of the system's
   * generic „Става за …“ sentence. See „The lead“ above.
   */
  readonly lead?: string;
  /**
   * `<title>`, before the shop's name. `{systems}` is the capsule families on
   * sale under a parent listing.
   */
  readonly title: string;
  /** The title to use instead when every pack on the page is `{pack}`. */
  readonly titleWithPack?: string;
  /**
   * The capsule family this listing belongs to, as the parent's title lists
   * it. Two listings may share one: both Lavazza systems are „Lavazza“ there.
   */
  readonly family?: string;
  /**
   * How the meta description starts. The page adds the price per cup range
   * and how ordering works, both from data.
   */
  readonly description: string;
  /** The introduction's own heading, rendered as an `h2` under the listing. */
  readonly heading: string;
  /** Two or three short paragraphs, plain text. */
  readonly paragraphs: readonly string[];
  readonly links?: readonly CopyLink[];
  /**
   * The one journal article that answers this listing's question, by slug. A
   * listing links to at most one (`docs/seo.md` §13.4).
   */
  readonly article?: string;
  /**
   * Sections by use, between the products and the introduction. Beans only:
   * the rules that fill them are written for coffee beans.
   */
  readonly sections?: Readonly<Record<BeansSectionId, ListingSectionCopy>>;
}

/** A listing by its keys; `categoryHref` picks the landing slug at render time. */
const listing = (sourceKey: string, slug: string = sourceKey): RouteTarget => ({
  category: { slug, sourceKey },
});

export const categoryCopy: Readonly<Record<string, CategoryCopy>> = {
  "kafe-na-zyrna": {
    name: "Кафе на зърна",
    h1: "Кафе на зърна",
    lead: "Кафе на зърна за автоматични кафемашини с вградена мелачка и за собствена мелачка у дома. Под всяка опаковка е цената на чаша, а на страницата на продукта и цената за 1 кг, така че сравнявате пакети с различен размер по едно и също мерило. Зърната се мелят точно преди кафето, затова тук избирате само вкус и опаковка.",
    title: "Кафе на зърна — цена за кг и на чаша",
    description: "Кафе на зърна с цена за килограм до всяка опаковка",
    article: CHOOSE_BEANS_SLUG,
    heading: "За кого е кафето на зърна",
    paragraphs: [
      "Кафето на зърна е за хората, чиято машина мели сама, и за всеки, който има мелачка у дома. Зърната се смилат непосредствено преди приготвянето, затова тук не избирате система, а само вкус и размер на опаковката.",
      "Как да познаете, че това е вашият формат: отгоре на машината има контейнер, в който сипвате зърна, вместо да поставяте капсула или доза. Ако машината ви няма мелачка, ще ви трябва отделна — предварително мляно кафе в пакет не предлагаме.",
      "Колебаете се между няколко пакета? Помощникът за избор пита за вкуса ви и за това колко кафе се изпива, и подрежда подходящите зърна по цена на чаша, а не на опаковка.",
    ],
    sections: {
      /* Italian is what `content/brand-facts.ts` records, by the one standard
         written there: Rema Caffè and Molini are not, and where a coffee is
         roasted does not make its brand Italian. One pack per brand, the
         brands by name (`beans-sections.ts`). */
      italian: {
        heading: "Италианско кафе на зърна",
        sentences: [
          "Италианско тук е кафето на марките, за които сме проверили, че са италиански: по собствения им сайт или по опаковката.",
          "Име, което само звучи италианско, не стига, нито надпис, че кафето е изпечено в Италия.",
          "Марките са подредени по име, с по една опаковка от всяка — тази с най-ниската цена за килограм при нея, а всички са изредени и на страницата марки кафе.",
        ],
        links: [{ phrase: "марки кафе", to: routes.brands }],
      },
      /* No products: every automatic model in `src/content/machines.ts` takes
         beans, of any brand, and the choose-beans article says the machine's
         brand does not matter. Vending is the vending page's question. */
      automatic: {
        heading: "Кафе на зърна за автоматична кафемашина",
        sentences: [
          "Автоматичната кафемашина (кафеавтомат) мели зърната сама, а при зърната няма система, на която кафето да трябва да пасва, както при капсулите.",
          {
            text: "Затова всяко кафе на зърна от тази страница става за нея, каквато и да е марката ѝ.",
            unlessFlavoured: true,
          },
          "За вендинг автоматите на зърна вижте кафе за вендинг машини.",
        ],
        links: [{ phrase: "кафе за вендинг машини", to: routes.vending }],
      },
    },
  },
  "kafe-kapsuli": {
    name: "Кафе капсули",
    h1: "Кафе капсули",
    title: "Кафе капсули за {systems}",
    description: "Кафе капсули за {systems}",
    links: [{ phrase: "списъка с машини", to: routes.machines }],
    article: WHICH_CAPSULE_SLUG,
    heading: "Как да изберете капсули",
    paragraphs: [
      "Капсулите са за машини, в които слагате капсула и машината прави останалото — без мелене и без дозиране.",
      "Важното тук е едно: капсулите от различните системи не са взаимозаменяеми. Капсула за Dolce Gusto не влиза в машина Nespresso, и обратното. Затова кафето в тази категория е разделено по системи — първо намерете своята, после избирайте по вкус.",
      "Ако не знаете коя система използва машината ви, потърсете я по марка и модел в списъка с машини. Помощникът за избор също започва оттам: първо машината, после вкусът.",
    ],
  },
  nespresso: {
    name: "Капсули за Nespresso",
    h1: "Капсули, съвместими с Nespresso (Неспресо)",
    lead: "Капсулите Неспресо тук са съвместими с класическите машини Nespresso (Original): Essenza, Inissia, Pixie, CitiZ и останалите модели от тази система. Под всяка кутия е цената на чаша, така че сравнявате кафетата по това, което плащате за едно кафе. Машините Vertuo приемат само собствените си капсули и тези не пасват в тях.",
    title: "Капсули за Nespresso (Неспресо) — цена на чаша",
    family: "Nespresso",
    description: "Капсули, съвместими с класическите машини Nespresso",
    heading: "За кои машини са тези капсули",
    paragraphs: [
      "Тук са капсулите за класическите домашни машини Nespresso — системата, която се нарича Nespresso Original.",
      "Познават се по размера и формата: малка капсула като пресечен конус, широка около 37 мм и най-често алуминиева. Ако машината ви е Nespresso Vertuo, тези капсули няма да паснат — Vertuo приема само собствените си капсули с баркод по ръба, а такива не предлагаме. Същото се отнася за професионалните машини Nespresso, които работят с по-голяма капсула.",
      "Не сте сигурни коя Nespresso имате? Намерете модела в списъка с машини и ще видите какво приема, или оставете помощника за избор да ви преведе през въпросите.",
    ],
  },
  "dolce-gusto": {
    name: "Капсули за Dolce Gusto",
    h1: "Капсули за Dolce Gusto (Долче Густо)",
    lead: "Капсулите Долче Густо тук са съвместими с класическите машини Dolce Gusto на Krups и De'Longhi: Piccolo, Genio, Mini Me, Infinissima и останалите. Цената на чаша стои под всяка кутия, за да сравните кафетата по реалната цена на едно кафе, а не на опаковка. Машините Dolce Gusto NEO работят с хартиени дози и тези капсули не пасват в тях.",
    title: "Капсули за Dolce Gusto (Долче Густо) — цена на чаша",
    family: "Dolce Gusto",
    description: "Капсули за машини Dolce Gusto",
    heading: "За кои машини са тези капсули",
    paragraphs: [
      "Тези капсули са за класическите машини Dolce Gusto и не пасват на никоя друга система. По-новите машини Dolce Gusto NEO работят с хартиени дози и също не ги приемат.",
      "Капсулата за Dolce Gusto е лесна за разпознаване: широка и ниска, от пластмаса, затворена отгоре със сребристо фолио.",
      "Ако капсулите, които използвате досега, изглеждат другояче, най-вероятно машината ви е от друга система. Проверете модела в списъка с машини или минете през помощника за избор, преди да поръчате.",
    ],
  },
  "lavazza-blue": {
    name: "Капсули за Lavazza Blue",
    h1: "Капсули за Lavazza Blue",
    title: "Капсули Lavazza Blue (Лаваца Блу) — цена на чаша",
    titleWithPack: "Капсули Lavazza Blue (Лаваца Блу) — {pack}, цена на чаша",
    family: "Lavazza",
    description: "Капсули за машини Lavazza Blue",
    links: [{ phrase: "капсули A Modo Mio", to: listing("a-modo-mio") }],
    heading: "За кои машини са тези капсули",
    paragraphs: [
      "Lavazza Blue е системата на професионалните машини на Lavazza и най-често се среща в офиси.",
      "Капсулата е по-голяма и по-твърда от тази за A Modo Mio, а самата машина обикновено носи означение LB. Системите на Lavazza не са взаимозаменяеми: за домашна машина на Lavazza търсете капсули A Modo Mio, а не тези. Офисните машини Espresso Point и Firma също са отделни системи и не приемат капсули Blue.",
      "Ако не можете да прецените коя е вашата, потърсете модела в списъка с машини или отговорете на въпросите в помощника за избор.",
    ],
  },
  caffitaly: {
    name: "Капсули Caffitaly",
    h1: "Капсули Caffitaly",
    /* Not „стават и за Tchibo Cafissimo“, which the study's own title row
       has: that term belongs to the Tchibo machine page, and two titles
       carrying it would compete. The description and the introduction say
       it, and the introduction links there. */
    title: "Капсули Caffitaly (Кафитали) — цена на чаша",
    family: "Caffitaly",
    description: "Капсули Caffitaly, които стават и за машини Tchibo Cafissimo",
    links: [{ phrase: "машините Tchibo Cafissimo", to: routes.machineBrand("tchibo") }],
    heading: "За кои машини са тези капсули",
    paragraphs: [
      "Капсулите Caffitaly са за машините със знака Caffitaly System. Същия формат приемат и машините Tchibo Cafissimo, макар Tchibo да посочва, че в тях трябва да се използват само нейните капсули. Машините K-fee, професионалните машини Caffitaly и Coffee For You са други системи.",
      "Капсулата е пластмасова, с прозрачна или бяла основа. Формата ѝ напомня малка чашка с пръстен в горната част.",
      "Ако машината ви е от друга марка и не сте сигурни дали приема този формат, вижте я в списъка с машини или минете през помощника за избор.",
    ],
  },
  "a-modo-mio": {
    name: "Капсули за Lavazza A Modo Mio",
    h1: "Капсули за Lavazza A Modo Mio",
    title: "Капсули Lavazza A Modo Mio (Лаваца А Модо Мио)",
    family: "Lavazza",
    description: "Капсули за домашните машини Lavazza A Modo Mio",
    links: [{ phrase: "капсулите за Lavazza Blue", to: listing("lavazza-blue") }],
    heading: "За кои машини са тези капсули",
    paragraphs: [
      "A Modo Mio е системата за домашните машини на Lavazza.",
      "Капсулата е малка и пластмасова, обикновено черна, с широк ръб отгоре. Не я бъркайте с капсулите за Lavazza Blue: те са по-големи и по-твърди, предназначени са за професионалните машини с означение LB и не влизат в домашните.",
      "Ако се колебаете коя система на Lavazza имате, намерете модела в списъка с машини или оставете помощника за избор да ви насочи.",
    ],
  },
  "kafe-dozi": {
    name: "Кафе дози ESE",
    h1: "Кафе дози ESE",
    lead: "Кафе дози ESE: хартиените дози, които мнозина търсят и като ESE капсули или дозети. Всяка доза е 44 мм и пасва на еспресо машина с цедка за дози ESE, без мелене и без пресоване на кафето. При всяка опаковка пише колко струва една чаша, така че дозите се сравняват помежду си лесно.",
    title: "Кафе дози ESE (хартиени дози 44 мм)",
    description: "Хартиени кафе дози ESE, 44 мм, за еспресо машини с цедка за дози",
    links: [
      { phrase: "кафе капсулите", to: listing("kafe-kapsuli", "kapsuli") },
      { phrase: "кафето на зърна", to: listing("kafe-na-zyrna", "kafe-na-zarna") },
    ],
    heading: "За кого са хартиените дози",
    paragraphs: [
      "Хартиените дози ESE са за еспресо машини с цедка за дози.",
      "Дозата е плоска хартиена възглавничка с диаметър 44 мм. Ако вашата машина работи с капсули или сама мели зърна, дозите не са за нея — разгледайте кафе капсулите или кафето на зърна.",
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
 * The copy for a category, or null when none has been written.
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

/**
 * What other pages call a category: its written name, or the stored one for a
 * category nobody has written about yet.
 */
export function categoryNameFor(category: {
  readonly slug: string;
  readonly sourceKey?: string | null;
  readonly name: string;
}): string {
  return categoryCopyFor(category)?.name ?? category.name;
}

/** A run of plain text, or a linked phrase. */
export type CopySegment = string | CopyLink;

/**
 * A paragraph cut at its linked phrases, in reading order.
 *
 * Each phrase is linked where it first stands and nowhere else: one mention,
 * one link. A phrase the paragraph does not contain is ignored here; that it
 * stands in exactly one paragraph is checked by `test/taxonomy.test.ts`, where
 * a slip is a failed test and not a missing link.
 */
export function segmentParagraph(
  paragraph: string,
  links: readonly CopyLink[] = [],
): readonly CopySegment[] {
  const found = links
    .map((link) => ({ link, at: paragraph.indexOf(link.phrase) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at);

  const segments: CopySegment[] = [];
  let cursor = 0;
  for (const { link, at } of found) {
    // Two phrases that overlap cannot both be links; the first one wins.
    if (at < cursor) continue;
    if (at > cursor) segments.push(paragraph.slice(cursor, at));
    segments.push(link);
    cursor = at + link.phrase.length;
  }
  if (cursor < paragraph.length) segments.push(paragraph.slice(cursor));
  return segments;
}
