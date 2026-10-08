import type { JournalFigures } from "@/lib/catalog/journal-figures";

/**
 * The journal's block format.
 *
 * Articles are TypeScript files, not Markdown or MDX, and that is a decision
 * rather than a shortcut:
 *
 *  - An MDX toolchain is three or four dependencies and a compiler step for
 *    what is, today, four articles. This file is the whole format.
 *  - The articles quote figures — price per cup, the intensity scales in use —
 *    that move with every catalog sync. A body that is a function of those
 *    figures can state them, and can be forced by the type system to say
 *    something sensible when a figure is missing. Prose in a `.md` file would
 *    have to have the numbers typed into it, which is the one thing this
 *    journal must never do.
 *  - Links are data, so a test can resolve every one of them against the real
 *    routes. A dead link in Markdown is found by a customer.
 *
 * The vocabulary is deliberately small. A block the renderer does not know is a
 * compile error, not a silently dropped paragraph.
 */

/* --- Inline content ------------------------------------------------------ */

/** A link to a route on this site. External links are not part of the format. */
export interface InlineLink {
  readonly type: "link";
  readonly href: `/${string}`;
  readonly text: string;
}

export interface InlineStrong {
  readonly type: "strong";
  readonly text: string;
}

/**
 * The shop's phone number, as a `tel:` link.
 *
 * A node rather than a string so that no article ever has the number typed
 * into it: it is rendered from `siteConfig`, the same as everywhere else.
 */
export interface InlinePhone {
  readonly type: "phone";
}

export type Inline = string | InlineLink | InlineStrong | InlinePhone;

/** A run of inline content: one sentence or several, with links between. */
export type InlineContent = readonly Inline[];

/* --- Blocks -------------------------------------------------------------- */

export interface ParagraphBlock {
  readonly type: "paragraph";
  readonly content: InlineContent;
}

/**
 * A heading inside the body. The article title is the page's only `h1`, so
 * body headings start at 2 and the type has no way to express a second `h1`.
 */
export interface HeadingBlock {
  readonly type: "heading";
  readonly level: 2 | 3;
  readonly text: string;
}

export interface ListBlock {
  readonly type: "list";
  readonly ordered: boolean;
  readonly items: readonly InlineContent[];
}

export interface CalloutBlock {
  readonly type: "callout";
  readonly tone: "note" | "caution";
  readonly title?: string;
  readonly content: InlineContent;
}

/**
 * A table of figures. `caption` is required: a table of numbers with no stated
 * subject is unreadable to a screen reader and not much better to anyone else.
 */
export interface TableBlock {
  readonly type: "table";
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<readonly InlineContent[]>;
  readonly note?: string;
}

/** A button-styled link out of the article — into the wizard, mostly. */
export interface ActionBlock {
  readonly type: "action";
  readonly links: ReadonlyArray<{ readonly href: `/${string}`; readonly label: string }>;
}

export type Block =
  ParagraphBlock | HeadingBlock | ListBlock | CalloutBlock | TableBlock | ActionBlock;

/* --- Article ------------------------------------------------------------- */

export interface Article {
  /** URL segment under `/journal/`. Latin, lower case, hyphenated. */
  readonly slug: string;
  /** The page's single `h1`, and the `headline` of its structured data. */
  readonly title: string;
  /** One or two sentences: meta description, share text, and the index teaser. */
  readonly description: string;
  /** Calendar date of first publication, `YYYY-MM-DD`. Never a guess. */
  readonly publishedAt: string;
  /** Calendar date of the last substantive edit, when there has been one. */
  readonly updatedAt?: string;
  /**
   * Whether the body reads catalog figures.
   *
   * An article that does not is rendered without touching the database at all;
   * one that does is re-rendered as the catalog moves.
   */
  readonly usesCatalog: boolean;
  /**
   * The body, as a function of the catalog figures.
   *
   * Every figure is nullable and the body must read correctly with all of them
   * null — `EMPTY_JOURNAL_FIGURES` is what an unreachable or empty catalog
   * produces, and the content test renders every article against it.
   */
  readonly body: (figures: JournalFigures) => readonly Block[];
}

/* --- Builders ------------------------------------------------------------ *
 *
 * Small constructors so an article reads top to bottom like the text it is,
 * rather than like a tree of object literals.
 */

export const link = (href: `/${string}`, text: string): InlineLink => ({
  type: "link",
  href,
  text,
});

export const strong = (text: string): InlineStrong => ({ type: "strong", text });

export const phone: InlinePhone = { type: "phone" };

export const p = (...content: Inline[]): ParagraphBlock => ({ type: "paragraph", content });

export const h2 = (text: string): HeadingBlock => ({ type: "heading", level: 2, text });

export const h3 = (text: string): HeadingBlock => ({ type: "heading", level: 3, text });

/** A list item is one inline or a run of them. */
type ListItem = Inline | InlineContent;

const toContent = (item: ListItem): InlineContent =>
  Array.isArray(item) ? (item as InlineContent) : [item as Inline];

export const ul = (...items: ListItem[]): ListBlock => ({
  type: "list",
  ordered: false,
  items: items.map(toContent),
});

export const ol = (...items: ListItem[]): ListBlock => ({
  type: "list",
  ordered: true,
  items: items.map(toContent),
});

export const callout = (
  options: { readonly tone?: "note" | "caution"; readonly title?: string },
  ...content: Inline[]
): CalloutBlock => ({
  type: "callout",
  tone: options.tone ?? "note",
  ...(options.title ? { title: options.title } : {}),
  content,
});

export const table = (options: {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<ReadonlyArray<ListItem>>;
  readonly note?: string;
}): TableBlock => ({
  type: "table",
  caption: options.caption,
  columns: options.columns,
  rows: options.rows.map((row) => row.map(toContent)),
  ...(options.note ? { note: options.note } : {}),
});

export const action = (
  ...links: Array<{ readonly href: `/${string}`; readonly label: string }>
): ActionBlock => ({ type: "action", links });

/**
 * Join inline runs with a separator and a final conjunction: "a, b и c".
 *
 * Exists because several articles list things that come from data — brands,
 * scales, machines — and a list built with `join(", ")` reads as generated.
 */
export function sentenceList(items: readonly ListItem[], conjunction = "и"): Inline[] {
  const out: Inline[] = [];
  items.forEach((item, index) => {
    if (index > 0) out.push(index === items.length - 1 ? ` ${conjunction} ` : ", ");
    out.push(...toContent(item));
  });
  return out;
}
