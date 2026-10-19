/**
 * How "our own words" is measured.
 *
 * The storefront and the source sell the same catalogue, so any product text we
 * publish is compared - by search engines, and by us - with the paragraph the
 * source published for the same coffee. These are the measures, as pure
 * functions, shared by the two places that judge copy:
 *
 *  - the web app's `check:originality` (CI), which audits the hand-written copy
 *    file against the reference snapshot, and
 *  - the catalog copywriter (`@catalog/scraper-core/catalog/copywriter`), which
 *    audits machine-written copy before it may reach the database.
 *
 * One definition, so the two can never disagree about what "too close" means.
 */

/**
 * How much verbatim phrasing a rewrite may share with the source it replaces.
 *
 * Measured as the share of the source's five-word sequences that also appear
 * in ours. Some overlap is unavoidable and correct: "бленд от около 70 %
 * арабика и 30 % робуста" is a fact about the coffee, and there is no honest
 * way to state it that avoids the words. Sustained overlap is not - it means
 * sentences were re-ordered rather than rewritten.
 *
 * 35 % sits above the highest legitimate value in the hand-written catalogue
 * (27 %, a product whose description is almost entirely a blend spec) and well
 * below what a light paraphrase scores.
 */
export const MAX_SOURCE_OVERLAP = 0.35;

/** Five-word window. Long enough that shared phrasing is deliberate. */
export const SHINGLE_SIZE = 5;

/**
 * The longest run of consecutive words new writing may share with a source
 * text before it counts as copied. Eight words is a clause; facts ("100 %
 * арабика, средно изпечена") are shorter than that.
 */
export const MAX_SOURCE_RUN_WORDS = 8;

/** The same, between two pieces of our own writing. */
export const MAX_INTERNAL_RUN_WORDS = 15;

/** Fold to comparable words: case, punctuation and spacing carry no meaning here. */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function shingles(text: string, size: number = SHINGLE_SIZE): Set<string> {
  const words = normalizeForComparison(text).split(" ").filter(Boolean);
  const result = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) {
    result.add(words.slice(i, i + size).join(" "));
  }
  return result;
}

/** Share of `source`'s phrasing that reappears in `ours`. */
export function overlapRatio(source: string, ours: string): number {
  const from = shingles(source);
  if (from.size === 0) return 0;
  const to = shingles(ours);
  let shared = 0;
  for (const shingle of from) if (to.has(shingle)) shared += 1;
  return shared / from.size;
}

/** The longest run of consecutive words two texts share. */
export function longestSharedRun(a: string, b: string): number {
  const wordsA = normalizeForComparison(a).split(" ").filter(Boolean);
  const wordsB = normalizeForComparison(b).split(" ").filter(Boolean);
  let best = 0;
  let previous = new Array<number>(wordsB.length + 1).fill(0);
  for (let i = 1; i <= wordsA.length; i += 1) {
    const current = new Array<number>(wordsB.length + 1).fill(0);
    for (let j = 1; j <= wordsB.length; j += 1) {
      if (wordsA[i - 1] === wordsB[j - 1]) {
        current[j] = (previous[j - 1] ?? 0) + 1;
        if ((current[j] as number) > best) best = current[j] as number;
      }
    }
    previous = current;
  }
  return best;
}

/** Share of the smaller text's five-word phrases that the other also contains. */
export function sharedShare(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  const smaller = sa.size <= sb.size ? sa : sb;
  const larger = smaller === sa ? sb : sa;
  if (smaller.size === 0) return 0;
  let shared = 0;
  for (const shingle of smaller) if (larger.has(shingle)) shared += 1;
  return shared / smaller.size;
}
