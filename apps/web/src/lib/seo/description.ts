/**
 * How long a meta description may run, and what gives way when it would run
 * longer.
 *
 * Google cuts a snippet at about 920 px — roughly 155 to 160 characters —
 * and cuts mid-sentence. A listing's description is built from parts in order
 * of worth: what the page lists, what a cup of it costs, how ordering works
 * (`docs/seo.md` §12). When the three do not fit, the last one is left out
 * whole rather than left to be cut off half-said; the callback sentence is the
 * same on every page and costs the least to lose. `test/metadata-quality.test.ts`
 * walks every kind of page against the limit.
 */
export const DESCRIPTION_LIMIT = 160;

const length = (text: string): number => [...text].length;

/**
 * Sentences in order of worth, joined with spaces: the first always, each one
 * after it only while the whole stays within `DESCRIPTION_LIMIT`. Empty parts
 * are skipped. A later, shorter part is still added when an earlier one did
 * not fit.
 */
export function fitDescription(...parts: ReadonlyArray<string | null | undefined | false>): string {
  const present = parts.filter((part): part is string => typeof part === "string" && part !== "");
  const [first, ...rest] = present;
  if (first === undefined) return "";
  let text = first;
  for (const part of rest) {
    const candidate = `${text} ${part}`;
    if (length(candidate) <= DESCRIPTION_LIMIT) text = candidate;
  }
  return text;
}
