/**
 * Products in a newsletter: the line in the body that asks for them.
 *
 * Three kinds, each written as a line of its own, the only thing on it:
 *
 *   [[продукти: адрес-1, адрес-2]]   these products, in this order (up to six).
 *                                    An address is the product's slug, or its
 *                                    whole URL pasted from the site.
 *   [[нови-продукти]]                the newest products, first seen in the
 *   [[нови-продукти: 3]]             last 30 days; four unless a number says
 *                                    otherwise, six at most.
 *   [[промоции]]                     products with a real reduction, the
 *   [[промоции: 6]]                  biggest first; four, six at most.
 *   [[промоции: адрес-1, адрес-2]]   these products, in this order, each of
 *                                    which must still be reduced when the
 *                                    letter goes: the monthly letter's
 *                                    reductions, chosen when it was prepared.
 *                                    A lone number is a count, anything else
 *                                    a list (no product's address is a bare
 *                                    number).
 *
 * What a line asks for is all this file decides. Which products that is, at
 * what price, is `product-blocks.ts`, from the catalog, at the moment the
 * letter is drawn — never here and never typed by hand, so a letter cannot
 * show a name or a price the product page does not.
 *
 * A line that LOOKS like a block (`[[…]]` and nothing else) but cannot be read
 * — a typo in the name, no addresses, a count of zero — is still a block: it
 * draws nothing, and the composer names the problem. Printing "[[промоций]]"
 * to every subscriber would be the worse failure of the two.
 *
 * Pure and dependency-free: the body parser (`emails/markdown.ts`), the
 * composer in the browser and the tests all read the same grammar.
 */

/** No block shows more than this: six cards is already a long letter on a phone. */
export const MAX_BLOCK_PRODUCTS = 6;

/** What `[[нови-продукти]]` and `[[промоции]]` show without a number. */
export const DEFAULT_BLOCK_PRODUCTS = 4;

/** How far back `[[нови-продукти]]` looks, in days. */
export const NEW_PRODUCTS_DAYS = 30;

/**
 * No letter shows more than this many product cards, whatever its blocks ask
 * for. A card is about 3 KB of mail HTML; Gmail cuts a message off at 102 KB
 * and hides the rest — the unsubscribe footer with it. Twelve cards and a
 * long text still fit; a block that would go past them is not drawn, and the
 * composer says so (`product-blocks.ts`, `planBlocks`).
 */
export const MAX_LETTER_PRODUCTS = 12;

export type ProductBlockKind = "picked" | "new" | "sale" | "reduced";

export type ProductBlockSpec =
  | { readonly kind: "picked"; readonly slugs: readonly string[] }
  | { readonly kind: "new"; readonly limit: number }
  | { readonly kind: "sale"; readonly limit: number }
  /** Chosen products under a claim of reduction: each must still be reduced at the send. */
  | { readonly kind: "reduced"; readonly slugs: readonly string[] };

/** The kinds that name their products, as opposed to asking the catalog for some. */
export const isListKind = (kind: ProductBlockKind): kind is "picked" | "reduced" =>
  kind === "picked" || kind === "reduced";

export interface ProductToken {
  /** The line as typed, trimmed: how the composer names it in a warning. */
  readonly source: string;
  /** What it asks for, or null when it cannot be read (`problem` says why). */
  readonly spec: ProductBlockSpec | null;
  readonly problem: string | null;
  /** What was adjusted to make it readable, e.g. a count above six. */
  readonly notes: readonly string[];
  /**
   * Addresses in a hand-picked line that are no product's address, as typed.
   * Left out of the block; a send does not start while there are any.
   */
  readonly invalid: readonly string[];
}

/**
 * How many products the cards it asks for come to: the addresses of a
 * hand-picked line, the count of an automatic one. What the cap on a whole
 * letter (`MAX_LETTER_PRODUCTS`) is counted in, so it can be decided from the
 * text alone, before the catalog is asked anything.
 */
export function requestedProducts(spec: ProductBlockSpec): number {
  return spec.kind === "picked" || spec.kind === "reduced" ? spec.slugs.length : spec.limit;
}

/** The words each kind answers to, after `normaliseName`. A list of reductions is "промоции" with addresses. */
const KINDS: Readonly<Record<string, "picked" | "new" | "sale">> = {
  продукти: "picked",
  продукт: "picked",
  "нови-продукти": "new",
  "новите-продукти": "new",
  нови: "new",
  промоции: "sale",
  промоция: "sale",
};

/** How each kind is written when the composer inserts it. */
export const TOKEN_NAMES: Readonly<Record<ProductBlockKind, string>> = {
  picked: "продукти",
  new: "нови-продукти",
  sale: "промоции",
  reduced: "промоции",
};

const TOKEN_LINE = /^\[\[([^\n]*)\]\]$/;
const PRODUCT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const UNKNOWN = `Непознат блок. Може да бъде [[${TOKEN_NAMES.picked}: адрес-1, адрес-2]], [[${TOKEN_NAMES.new}]] или [[${TOKEN_NAMES.sale}]].`;
const NO_PRODUCTS = `Посочете продуктите: [[${TOKEN_NAMES.picked}: адрес-1, адрес-2]].`;
const BAD_COUNT = `Броят трябва да е число от 1 до ${MAX_BLOCK_PRODUCTS}.`;
const NO_REDUCED = `Посочете брой от 1 до ${MAX_BLOCK_PRODUCTS} — [[${TOKEN_NAMES.sale}: 4]] — или намалените продукти: [[${TOKEN_NAMES.sale}: адрес-1, адрес-2]].`;

/** "Нови  Продукти", "нови_продукти" and "нови-продукти" are one name. */
function normaliseName(raw: string): string {
  return raw
    .trim()
    .toLocaleLowerCase("bg")
    .replace(/[\s_–—-]+/g, "-");
}

/** Is this whole line a block, readable or not? */
export function isTokenLine(line: string): boolean {
  return TOKEN_LINE.test(line.trim());
}

/**
 * A product address, as the owner may have pasted it: the slug, or the
 * product page's URL, whose last segment is the slug. Null when it is
 * neither.
 */
export function slugFromAddress(raw: string): string | null {
  let candidate = raw.trim();
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const segments = new URL(candidate).pathname.split("/").filter(Boolean);
      candidate = decodeURIComponent(segments.at(-1) ?? "");
    } catch {
      return null;
    }
  }
  candidate = candidate.toLowerCase();
  return PRODUCT_SLUG.test(candidate) && candidate.length <= 200 ? candidate : null;
}

function count(raw: string, notes: string[]): number | null {
  const text = raw.trim();
  if (!text) return DEFAULT_BLOCK_PRODUCTS;
  if (!/^\d{1,3}$/.test(text)) return null;
  const value = Number(text);
  if (value < 1) return null;
  if (value > MAX_BLOCK_PRODUCTS) {
    notes.push(`Показват се най-много ${MAX_BLOCK_PRODUCTS}.`);
    return MAX_BLOCK_PRODUCTS;
  }
  return value;
}

/**
 * The block a line asks for; null when the line is not a block at all.
 *
 * Only a whole line counts: `[[промоции]]` inside a sentence is that
 * sentence's text.
 */
export function parseProductToken(line: string): ProductToken | null {
  const source = line.trim();
  const match = TOKEN_LINE.exec(source);
  if (!match) return null;

  const inner = match[1]!;
  const colon = inner.indexOf(":");
  const name = normaliseName(colon === -1 ? inner : inner.slice(0, colon));
  const args = colon === -1 ? "" : inner.slice(colon + 1);
  const kind = KINDS[name];
  const notes: string[] = [];
  const invalid: string[] = [];
  const refuse = (problem: string): ProductToken => ({
    source,
    spec: null,
    problem,
    notes,
    invalid,
  });

  if (!kind) return refuse(UNKNOWN);

  /* The reductions take a count or a list: a lone number (or nothing) is a
     count, as it always was; anything else names the products. */
  const listed = kind === "picked" || (kind === "sale" && !/^\s*\d*\s*$/.test(args));
  if (listed) {
    const slugs: string[] = [];
    for (const part of args.split(/[\s,;]+/).filter(Boolean)) {
      const slug = slugFromAddress(part);
      if (!slug) invalid.push(part);
      else if (!slugs.includes(slug)) slugs.push(slug);
    }
    if (slugs.length === 0) return refuse(kind === "picked" ? NO_PRODUCTS : NO_REDUCED);
    if (slugs.length > MAX_BLOCK_PRODUCTS) {
      notes.push(`Показват се първите ${MAX_BLOCK_PRODUCTS}.`);
      slugs.length = MAX_BLOCK_PRODUCTS;
    }
    const listKind = kind === "picked" ? "picked" : "reduced";
    return { source, spec: { kind: listKind, slugs }, problem: null, notes, invalid };
  }

  const limit = count(args, notes);
  if (limit === null) return refuse(BAD_COUNT);
  return { source, spec: { kind, limit }, problem: null, notes, invalid };
}

/**
 * What becomes of each block line of a letter, in order:
 *
 *   shown       drawn, from what it resolves to
 *   unreadable  not a block this grammar knows (`problem` says why)
 *   over-cap    readable, but the cards asked for up to and including it
 *               come to more than `MAX_LETTER_PRODUCTS`
 *
 * Decided from the text alone, so the composer, the resolver, the template
 * and the send all agree on it without asking the catalog. Once one line is
 * over the cap every later one is too: a letter that skipped a big block and
 * then drew a small one under it would be harder to read than to explain.
 */
export type BlockState = "shown" | "unreadable" | "over-cap";

export function planTokens(tokens: readonly ProductToken[]): BlockState[] {
  let used = 0;
  let full = false;
  return tokens.map((token) => {
    if (!token.spec) return "unreadable";
    const wanted = requestedProducts(token.spec);
    if (full || used + wanted > MAX_LETTER_PRODUCTS) {
      full = true;
      return "over-cap";
    }
    used += wanted;
    return "shown";
  });
}

/** The line the composer inserts for a block. */
export function productTokenLine(spec: ProductBlockSpec): string {
  if (spec.kind === "picked" || spec.kind === "reduced") {
    return `[[${TOKEN_NAMES[spec.kind]}: ${spec.slugs.join(", ")}]]`;
  }
  const name = TOKEN_NAMES[spec.kind];
  return spec.limit === DEFAULT_BLOCK_PRODUCTS ? `[[${name}]]` : `[[${name}: ${spec.limit}]]`;
}
