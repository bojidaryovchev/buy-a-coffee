/**
 * The keyword map: which page owns which search term.
 *
 * Copied row by row from `docs/seo.md` §1, which is binding: "One page owns
 * each cluster. A page outside the 'owns' column may mention the term but must
 * not carry it in its title or H1." `keyword-map.test.ts` holds every title
 * and heading the storefront builds against this table.
 *
 * `head` is the "Owns" column. `twins` are the same words in the other order:
 * Google buckets close variants („капсули долче густо“ and „долче густо
 * капсули“ are one 3,600), so a title carrying the twin carries the term.
 * `also` is the "Also targets" column, kept for the record; only head terms
 * are exclusive.
 *
 * A page that does not exist yet is in the table all the same. Its term is
 * already somebody's, and the pages that do exist must stay off it.
 */
export interface KeywordOwner {
  /** The page, as §1 names it (a path under `/bg`). */
  readonly page: string;
  readonly head: readonly string[];
  readonly twins?: readonly string[];
  readonly also?: readonly string[];
}

export const KEYWORD_MAP: readonly KeywordOwner[] = [
  {
    page: "home",
    head: ["магазин за кафе", "онлайн магазин за кафе"],
    also: ["кафе", "kafe"],
  },
  {
    page: "kafe-kapsuli",
    head: ["кафе капсули"],
    also: ["капсули за кафе", "кафе на капсули", "капсули кафе", "капсули за кафемашина"],
  },
  {
    page: "dolce-gusto-kapsuli",
    head: ["капсули долче густо"],
    twins: ["долче густо капсули"],
    also: [
      "dolce gusto капсули",
      "кафе капсули долче густо",
      "съвместими капсули за долче густо",
      "капсули за кафемашина долче густо",
    ],
  },
  {
    page: "nespresso-kapsuli",
    head: ["неспресо капсули"],
    twins: ["капсули неспресо"],
    also: ["nespresso капсули", "капсули за неспресо машина"],
  },
  {
    page: "lavazza-blue-kapsuli",
    head: ["lavazza blue капсули"],
    twins: ["капсули lavazza blue"],
    also: ["лаваца блу капсули", "lavazza blue", "капсули лаваца блу"],
  },
  {
    page: "lavazza-a-modo-mio-kapsuli",
    head: ["lavazza a modo mio"],
    also: ["lavazza a modo mio капсули", "a modo mio капсули", "капсули лаваца а модо мио"],
  },
  {
    page: "caffitaly-kapsuli",
    head: ["caffitaly капсули"],
    twins: ["капсули caffitaly"],
    also: ["caffitaly", "кафитали", "кафитали капсули", "съвместими капсули за caffitaly"],
  },
  {
    page: "lavazza-kapsuli",
    head: ["лаваца капсули"],
    twins: ["капсули лаваца"],
    also: ["lavazza капсули", "кафе капсули лаваца"],
  },
  {
    page: "kafe-na-zarna",
    head: ["кафе на зърна"],
    also: [
      "кафе на зърна промоция",
      "италианско кафе на зърна",
      "кафе на зърна цена",
      "кафе на зърна 100 арабика",
    ],
  },
  {
    page: "kafe-na-zarna-lavazza",
    head: ["кафе лаваца на зърна"],
    twins: ["лаваца на зърна", "кафе на зърна лаваца"],
    also: ["кафе лаваца на зърна 1 кг цена"],
  },
  {
    page: "kafe-dozi",
    head: ["кафе дози"],
    also: ["ese капсули", "кафе на дози", "хартиени дози кафе", "кафе дозети", "ese дози"],
  },
  {
    page: "bezkofeinovo-kafe",
    head: ["безкофеиново кафе"],
    // §1 names the collision in these words: no „без кофеин“ in a system's title.
    twins: ["кафе без кофеин", "без кофеин"],
    also: ["безкофеиново кафе на зърна", "безкофеинови капсули долче густо"],
  },
  {
    page: "nay-evtino-na-chasha",
    head: ["евтино кафе на зърна"],
    also: ["евтини капсули за кафе", "евтини капсули неспресо", "евтини капсули долче густо"],
  },
  {
    page: "promotsii",
    // „кафе на зърна промоция“ is shared with the beans page; the modifier is
    // what is this page's own.
    head: ["промоция"],
    also: ["кафе на зърна промоция", "долче густо капсули промоция", "кафе капсули промоция"],
  },
  {
    page: "marki",
    head: ["марки кафе"],
    twins: ["кафе марки"],
    also: ["италиански марки кафе"],
  },
  {
    page: "za-kafemashina/tchibo",
    head: ["tchibo cafissimo"],
    also: ["tchibo капсули", "капсули чибо", "кафе капсули чибо", "cafissimo капсули"],
  },
  {
    page: "kafe-za-vending-mashini",
    head: ["кафе за вендинг машини"],
    also: ["кафе за вендинг", "кафе за вендинг автомати", "вендинг кафе"],
  },
  {
    page: "blog/vidove-kapsuli-za-kafe",
    head: ["видове капсули за кафе"],
    also: ["видове капсули за кафе долче густо", "видове капсули долче густо"],
  },
];

/* --- Matching ------------------------------------------------------------ */

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * A title in the phrases a reader sees: cut at every mark that separates two
 * thoughts — a colon, a comma, a dash, a bracket, the bar before the shop's
 * name.
 */
export const phrases = (text: string): string[][] =>
  text
    .toLowerCase()
    .split(/[:,;—–|()·„“"]+/u)
    .map(words)
    .filter((phrase) => phrase.length > 0);

const containsRun = (haystack: readonly string[], needle: readonly string[]): boolean =>
  haystack.some((_, start) => needle.every((word, offset) => haystack[start + offset] === word));

/**
 * Whether `text` carries `term`: the term's words, in order, inside one
 * phrase. „Кафе: капсули“ does not carry „кафе капсули“; „Кафе капсули за
 * Nespresso“ does.
 */
export function carries(text: string, term: string): boolean {
  const needle = words(term);
  return phrases(text).some((phrase) => containsRun(phrase, needle));
}

/** The same, reading straight through the punctuation, as a stricter check. */
export function carriesIgnoringPunctuation(text: string, term: string): boolean {
  return containsRun(words(text), words(term));
}

/** Whether every word of `term` stands somewhere in `text`, in any order. */
export function hasEveryWord(text: string, term: string): boolean {
  const present = new Set(words(text));
  return words(term).every((word) => present.has(word));
}
