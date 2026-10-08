import { ARTICLES } from "../../content/journal";
import type { Article, Block, Inline, InlineContent } from "../../content/journal/blocks";
import { siteConfig } from "@/config/site";

/**
 * The journal's registry and its small amount of logic.
 *
 * The articles themselves live in `apps/web/content/journal/`, beside the
 * product copy, because they are content rather than code. This module is the
 * only thing the rest of the application imports: it orders them, looks one up,
 * and knows how to walk a body — which is what the content test, the renderer
 * and anything that wants a word count all need.
 *
 * Nothing here touches the database. Listing the journal for a sitemap or a
 * home-page teaser is free.
 */

export type { Article, Block, Inline, InlineContent };

/** What a listing needs: everything about an article except its body. */
export interface ArticleSummary {
  readonly slug: string;
  /** Site-relative path, e.g. `/journal/some-slug`. */
  readonly href: `/${string}`;
  readonly title: string;
  readonly description: string;
  /** `YYYY-MM-DD`. */
  readonly publishedAt: string;
  /** `YYYY-MM-DD`; equals `publishedAt` until the article is revised. */
  readonly modifiedAt: string;
  /** `modifiedAt` as a `Date`, for a sitemap's `lastModified`. */
  readonly lastModified: Date;
}

export const JOURNAL_PATH = "/journal" as const;

export const articlePath = (slug: string): `/${string}` => `${JOURNAL_PATH}/${slug}`;

/**
 * A calendar date as a `Date`, pinned to UTC midnight.
 *
 * Articles carry dates, not instants. Parsing `2026-10-09` as local time would
 * make the published day depend on the server's time zone, and a build machine
 * west of Greenwich would print the day before.
 */
export function articleDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

const dateFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "9 октомври 2026 г." */
export function formatArticleDate(isoDate: string): string {
  return dateFormatter.format(articleDate(isoDate));
}

function summarise(article: Article): ArticleSummary {
  const modifiedAt = article.updatedAt ?? article.publishedAt;
  return {
    slug: article.slug,
    href: articlePath(article.slug),
    title: article.title,
    description: article.description,
    publishedAt: article.publishedAt,
    modifiedAt,
    lastModified: articleDate(modifiedAt),
  };
}

/** Newest first; articles from the same day keep the order they are listed in. */
function ordered(): readonly Article[] {
  return ARTICLES.map((article, index) => ({ article, index }))
    .sort((a, b) => b.article.publishedAt.localeCompare(a.article.publishedAt) || a.index - b.index)
    .map(({ article }) => article);
}

/**
 * Every published article, newest first, without bodies.
 *
 * The one call the sitemap, `llms.txt` and the home page need. `limit` is for
 * a teaser.
 */
export function listArticles(options: { readonly limit?: number } = {}): readonly ArticleSummary[] {
  const all = ordered().map(summarise);
  return options.limit === undefined ? all : all.slice(0, Math.max(0, options.limit));
}

export function getArticle(slug: string | null | undefined): Article | null {
  if (!slug) return null;
  return ARTICLES.find((article) => article.slug === slug) ?? null;
}

export function summariseArticle(article: Article): ArticleSummary {
  return summarise(article);
}

/* --- Walking a body ------------------------------------------------------ */

/** Every run of inline content in a body, wherever it sits. */
export function inlineRuns(blocks: readonly Block[]): readonly InlineContent[] {
  return blocks.flatMap((block): InlineContent[] => {
    switch (block.type) {
      case "paragraph":
      case "callout":
        return [block.content];
      case "list":
        return [...block.items];
      case "table":
        return block.rows.flat();
      case "heading":
      case "action":
        return [];
    }
  });
}

/** Every internal link target in a body: inline links and action buttons. */
export function collectLinks(blocks: readonly Block[]): readonly string[] {
  const inline = inlineRuns(blocks)
    .flat()
    .flatMap((node) => (typeof node !== "string" && node.type === "link" ? [node.href] : []));
  const actions = blocks.flatMap((block) =>
    block.type === "action" ? block.links.map((entry) => entry.href) : [],
  );
  return [...inline, ...actions];
}

/** Heading levels in document order, e.g. `[2, 3, 3, 2]`. */
export function headingLevels(blocks: readonly Block[]): readonly number[] {
  return blocks.flatMap((block) => (block.type === "heading" ? [block.level] : []));
}

/**
 * All the words a reader would see, as one string.
 *
 * Used by the content test to look for things that must never be said, and
 * available to anything that wants a reading length.
 */
export function plainText(blocks: readonly Block[]): string {
  const inline = (content: InlineContent): string =>
    content
      .map((node) =>
        typeof node === "string"
          ? node
          : node.type === "phone"
            ? siteConfig.contact.phone
            : node.text,
      )
      .join("");

  return blocks
    .map((block) => {
      switch (block.type) {
        case "paragraph":
          return inline(block.content);
        case "heading":
          return block.text;
        case "list":
          return block.items.map(inline).join("\n");
        case "callout":
          return [block.title ?? "", inline(block.content)].join("\n");
        case "table":
          return [
            block.caption,
            block.columns.join(" "),
            ...block.rows.map((row) => row.map(inline).join(" ")),
            block.note ?? "",
          ].join("\n");
        case "action":
          return block.links.map((entry) => entry.label).join(" ");
      }
    })
    .join("\n");
}
