import { NO_COFFEE } from "../../../content/no-coffee";

/**
 * Whether a product holds no coffee: for the flavoured listing, which is
 * headed „Ароматизирано кафе“ and lists what the record flags as flavoured.
 *
 * Decided without touching a flag (the owner's call, 20 October 2026; the
 * reasons are in `content/no-coffee.ts`), in two ways:
 *
 *  - **the audited list**, `NO_COFFEE`, matched on the product's slug or any
 *    slug it had before, so `catalog:reslug` cannot drop an entry;
 *  - **a guard** for what the list has not met yet: a product whose stored
 *    description — the supplier's, or ours in the override columns — says in
 *    so many words that it holds no coffee.
 *
 * Never from a name. Pure, and small enough for every bundle that reads the
 * landings (the proxy included): the list is a few slugs and their evidence.
 */

const AUDITED: ReadonlySet<string> = new Set(NO_COFFEE.map((entry) => entry.slug));

/*
 * „без кафе“, „вместо кафе“, „не съдържа кафе“, „не включва кафе“, each as
 * whole words: „кафемашина“ and „кафеена“ are not „кафе“, and „без кофеин“ —
 * decaf, which is coffee — is a different word altogether. Bulgarian only, as
 * the descriptions are; an English „no coffee“ is as likely to go on „machine“.
 */
const NOT_A_LETTER_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_A_LETTER_AFTER = "(?![\\p{L}\\p{N}])";
const NO_COFFEE_WORDS: readonly RegExp[] = [
  "(?:без|вместо)\\s+кафе",
  "не\\s+(?:съдържа|включва)\\s+кафе",
].map((words) => new RegExp(`${NOT_A_LETTER_BEFORE}${words}${NOT_A_LETTER_AFTER}`, "iu"));

/** Whether a text says in so many words that what it describes holds no coffee. */
export function saysNoCoffee(text: string): boolean {
  const plain = text.replace(/<[^>]*>/g, " ");
  return NO_COFFEE_WORDS.some((words) => words.test(plain));
}

export function isNoCoffee(product: {
  /** The current slug and every slug the product had before. */
  readonly slugs: readonly string[];
  /** The stored descriptions, the supplier's and ours, as text or HTML. */
  readonly descriptions: readonly string[];
}): boolean {
  return (
    product.slugs.some((slug) => AUDITED.has(slug)) ||
    product.descriptions.some((text) => saysNoCoffee(text))
  );
}
