import { transliterate } from "@catalog/shared";
import { getMachineBrand } from "@/content/machines";

/**
 * Search synonyms: how Bulgarians spell brand and system names.
 *
 * Folding (`catalog_translit`) handles transliteration, not phonetics. A
 * visitor who types „Лаваца" gets `lavatsa`, which is not `lavazza`, because
 * Bulgarian writes the Italian "zz" as „ц" and no transliterator can know
 * that. The gap is closed here, by hand: a short list of the spellings people
 * really type, each mapped to the form the name takes in the catalog.
 *
 * Hand-maintained on purpose. Every entry is something a person types or would
 * type; nothing is generated. Do not add permutations, and do not add a
 * spelling that is also an everyday Bulgarian word — an entry fires on every
 * query containing it. („или" is how machines.ts spells Illy, but it is also
 * "or", so it is deliberately absent: it would turn "кафе или чай" into an
 * Illy search.)
 *
 * Spellings are compared after folding, so they match whichever script the
 * visitor used. A spelling that folds to the same text as its target is already
 * found by folding alone; those are listed anyway, because this table is the
 * one place that says every brand and system has been considered, and the
 * expansion drops them at no cost.
 */

export interface SynonymGroup {
  /** The catalog's own form: what appears in product names. Lower case. */
  readonly canonical: string;
  /** Ways it is typed. May be several words. */
  readonly spellings: readonly string[];
}

/** Cyrillic aliases `machines.ts` already carries for a machine brand. */
function machineAliases(slug: string): readonly string[] {
  return getMachineBrand(slug)?.aliases ?? [];
}

export const BRAND_SYNONYMS: readonly SynonymGroup[] = [
  { canonical: "lollo", spellings: ["лоло", "лоло кафе", "лолло", "лолло кафе"] },
  { canonical: "eurocaf", spellings: ["еврокаф", "еврокафе", "юрокаф"] },
  { canonical: "biancaffe", spellings: ["бианкафе", "бианка кафе"] },
  { canonical: "molini", spellings: ["молини"] },
  { canonical: "rema", spellings: ["рема кафе", "рема каффе"] },
  { canonical: "amann", spellings: ["аман", "аманн"] },
  { canonical: "tezzoro", spellings: ["тезоро", "тецоро"] },
  { canonical: "este", spellings: ["есте"] },
  { canonical: "elia", spellings: ["елия", "елиа"] },
  { canonical: "borbone", spellings: ["борбоне", "бурбоне"] },
  { canonical: "bianchi", spellings: ["бианки", "бианчи"] },
  { canonical: "kimbo", spellings: ["кимбо"] },
  { canonical: "lavazza", spellings: [...machineAliases("lavazza"), "лавацца"] },
  { canonical: "vergnano", spellings: ["вергнано", "верняно", "верниано"] },
  {
    canonical: "julius meinl",
    spellings: ["юлиус майнл", "юлиус мейнл", "джулиус майнл", "джулиус мейнл"],
  },
  { canonical: "meinl", spellings: ["майнл", "мейнл"] },
  { canonical: "foodness", spellings: ["фуднес", "фуднис"] },
  { canonical: "illy", spellings: ["илли"] },
  { canonical: "caffitaly", spellings: [...machineAliases("caffitaly"), "кафи тали"] },
  { canonical: "vandino", spellings: ["вандино"] },
  { canonical: "3 bourbons", spellings: ["3 бурбонс", "3 бурбон", "три бурбонс", "три бурбона"] },
];

export const SYSTEM_SYNONYMS: readonly SynonymGroup[] = [
  { canonical: "nespresso", spellings: [...machineAliases("nespresso"), "неспрессо"] },
  /*
   * Dolce Gusto capsules are named "DG" in the catalog ("Капсули DG Bianchi
   * Gusto Forte") and never spelled out, so the abbreviation is the target.
   * The Latin spelling is listed because on its own it finds nothing.
   */
  {
    canonical: "dg",
    spellings: ["долче густо", "дулче густо", "дольче густо", "dolce gusto", "dolcegusto"],
  },
  { canonical: "a modo mio", spellings: ["а модо мио", "амодомио", "а мода мио"] },
  { canonical: "lavazza blue", spellings: ["лаваца блу", "лавацца блу", "лавазза блу"] },
  /*
   * ESE pods are „дози" in the shop's own category name. „доза" is the
   * singular, which substring matching cannot reach from „дози".
   */
  { canonical: "дози", spellings: ["ese", "доза", "кафе доза"] },
];

export const SEARCH_SYNONYMS: readonly SynonymGroup[] = [...BRAND_SYNONYMS, ...SYSTEM_SYNONYMS];

/* ------------------------------------------------------------------------ */

/**
 * Terms longer than this are not expanded. Callers bound the query anyway;
 * this keeps the work here proportional even if one forgets to.
 */
const MAX_EXPANDED_LENGTH = 200;

/**
 * A typeahead is asked about half-typed words. A final word this long may be
 * the start of a spelling ("лавац" → „лаваца"); anything shorter would turn two
 * keystrokes into a brand. Multi-word spellings accept less because the words
 * before the last one already pin the brand down.
 */
const MIN_PARTIAL_LENGTH = 4;
const MIN_PARTIAL_LENGTH_SINGLE_WORD = 5;

interface Entry {
  readonly words: readonly string[];
  readonly canonical: string;
}

const WORD = /[\p{L}\p{N}]+/gu;

function foldedWords(text: string): string[] {
  return (text.match(WORD) ?? []).map(transliterate);
}

/** Entries by the folded first word of their spelling. */
const INDEX: ReadonlyMap<string, readonly Entry[]> = (() => {
  const index = new Map<string, Entry[]>();
  for (const group of SEARCH_SYNONYMS) {
    const target = foldedWords(group.canonical).join(" ");
    for (const spelling of group.spellings) {
      const words = foldedWords(spelling);
      // Already found by folding alone: expanding it would add nothing.
      if (words.length === 0 || words.join(" ") === target) continue;
      const bucket = index.get(words[0]!) ?? [];
      bucket.push({ words, canonical: group.canonical });
      index.set(words[0]!, bucket);
    }
  }
  return index;
})();

/** Single-word spellings that a half-typed final word could be the start of. */
const PARTIAL_CANDIDATES: readonly Entry[] = [...INDEX.values()]
  .flat()
  .filter((entry) => entry.words.length === 1);

function matchesAt(entry: Entry, words: readonly string[], at: number): boolean {
  if (at + entry.words.length > words.length) return false;
  const finalQueryWord = words.length - 1;
  return entry.words.every((expected, offset) => {
    const actual = words[at + offset]!;
    if (actual === expected) return true;
    // Only the very last word of the query can still be being typed.
    if (at + offset !== finalQueryWord) return false;
    const minimum = entry.words.length === 1 ? MIN_PARTIAL_LENGTH_SINGLE_WORD : MIN_PARTIAL_LENGTH;
    return actual.length >= minimum && expected.startsWith(actual);
  });
}

/**
 * The search terms to try for what a visitor typed.
 *
 * The first element is always the term exactly as given, so a query that
 * matched before still matches: expansion adds an alternative and never
 * replaces. When the query contains a known spelling — anywhere in it, so
 * „капсули лаваца" works — a second element carries the same query with every
 * known spelling swapped for the catalog's form. The caller ORs them.
 */
export function expandSearchTerm(term: string): string[] {
  if (term.length > MAX_EXPANDED_LENGTH) return [term];

  const spans = [...term.matchAll(WORD)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    folded: transliterate(match[0]),
  }));
  const words = spans.map((span) => span.folded);

  let out = "";
  let cursor = 0;
  for (let i = 0; i < words.length;) {
    const pool = [...(INDEX.get(words[i]!) ?? [])];
    // A half-typed single word never equals a key, so it is not in the bucket.
    if (i === words.length - 1 && words[i]!.length >= MIN_PARTIAL_LENGTH_SINGLE_WORD) {
      pool.push(...PARTIAL_CANDIDATES.filter((entry) => entry.words[0]!.startsWith(words[i]!)));
    }
    // Longest spelling wins: „лаваца блу" is the Blue system, not Lavazza + „блу".
    pool.sort((a, b) => b.words.length - a.words.length);

    const hit = pool.find((entry) => matchesAt(entry, words, i));
    if (!hit) {
      i += 1;
      continue;
    }
    out += term.slice(cursor, spans[i]!.start) + hit.canonical;
    cursor = spans[i + hit.words.length - 1]!.end;
    i += hit.words.length;
  }

  if (cursor === 0) return [term];
  out += term.slice(cursor);
  return [term, out];
}
