import { FLAVOURED_COFFEE, NO_COFFEE } from "../../../content/no-coffee";

/**
 * Whether a flavoured product may stand on the page headed „Ароматизирано
 * кафе“: only once a person has read what it is and filed it as coffee.
 *
 * The owner's bar (20 October 2026): a drink without coffee must not be on
 * that page, and missing a coffee costs less than listing one. So the page
 * lists **only audited coffees** (`FLAVOURED_COFFEE` in `content/no-coffee.ts`),
 * and every flagged product in neither list is held back and raised for review
 * by the sync-health check (`flavoured_unaudited`). No flag is changed, and no
 * name or description decides anything: a description can be read wrongly
 * both ways („Не можете без кафе сутрин?“ is coffee; „Напитка от зелен чай
 * мача“ never says the word), so the words it holds are only a hint in the
 * alert (`noCoffeeHint`).
 *
 * Matched on the product's slug or any slug it had before, so `catalog:reslug`
 * cannot drop an entry. An entry in both lists counts as no coffee: the
 * cautious reading wins. Pure, and small enough for every bundle that reads
 * the landings, the proxy included.
 */

export type CoffeeVerdict = "coffee" | "no-coffee" | "unaudited";

const COFFEE: ReadonlySet<string> = new Set(FLAVOURED_COFFEE.map((entry) => entry.slug));
const NOT_COFFEE: ReadonlySet<string> = new Set(NO_COFFEE.map((entry) => entry.slug));

/** What the audit says of a product, by its current and previous slugs. */
export function coffeeVerdict(slugs: readonly string[]): CoffeeVerdict {
  if (slugs.some((slug) => NOT_COFFEE.has(slug))) return "no-coffee";
  if (slugs.some((slug) => COFFEE.has(slug))) return "coffee";
  return "unaudited";
}

/** On the flavoured page only when a person has found it to be coffee. */
export const isAuditedCoffee = (slugs: readonly string[]): boolean =>
  coffeeVerdict(slugs) === "coffee";

/*
 * Words that suggest a description is of something without coffee. A hint for
 * the person classifying a product, never a decision: it misses a matcha whose
 * description never says „кафе“, and it fires on a coffee that asks whether
 * you can do „без кафе“ in the morning.
 */
const NOT_A_LETTER_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_A_LETTER_AFTER = "(?![\\p{L}\\p{N}])";
const HINTS: readonly RegExp[] = [
  "(?:без|вместо)\\s+кафе",
  "без\\s+съдържание\\s+на\\s+кафе",
  "заместител\\s+на\\s+кафе",
  "не\\s+(?:съдържа|включва)(?:\\s+\\p{L}+\\s+и)?\\s+кафе",
  "(?:зелен|черен|билков)\\s+чай",
  "мача|матча|matcha",
  "горещ\\s+шоколад",
].map((words) => new RegExp(`${NOT_A_LETTER_BEFORE}(?:${words})${NOT_A_LETTER_AFTER}`, "iu"));

/** Text as a reader sees it: tags dropped, the common entities spelled out. */
function plain(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/&amp;/gi, "&");
}

/**
 * The first words in a description that suggest it has no coffee, as written,
 * or null. For the alert only („описанието казва …“).
 */
export function noCoffeeHint(text: string): string | null {
  const readable = plain(text);
  for (const hint of HINTS) {
    const found = hint.exec(readable);
    if (found) return found[0].replace(/\s+/g, " ");
  }
  return null;
}
