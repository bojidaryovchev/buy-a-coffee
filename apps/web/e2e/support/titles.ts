/**
 * How a `<title>` ends, restated for the specs rather than imported from
 * `lib/seo/title.ts`, so a spec checks the rule and not the code under test:
 * the page's own words, then " | Buy a Coffee" while the whole stays within
 * sixty characters, the page's words alone when it would not.
 */
export const SHOP = "Buy a Coffee";
export const TITLE_LIMIT = 60;

export const characters = (text: string): number => [...text].length;

/** The `<title>` a page with these words of its own carries. */
export function shopTitle(words: string): string {
  const full = `${words} | ${SHOP}`;
  return characters(full) <= TITLE_LIMIT ? full : words;
}
