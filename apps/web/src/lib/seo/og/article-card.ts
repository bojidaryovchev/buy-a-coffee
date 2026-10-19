import { fillMetadataSegment } from "next/dist/lib/metadata/get-metadata-route";
import { absoluteUrl, siteConfig } from "@/config/site";
import type { Locale } from "@/i18n/config";
import { JOURNAL_NAME, formatArticleDate, type ArticleSummary } from "@/lib/journal";
import { CARD_SIZE, CARD_TYPE } from "./card";
import { cardId, type ArticleCardFacts } from "./data";

/**
 * An article's share card, named in full: its facts, its id and its address.
 *
 * An article names its card itself rather than letting Next attach it,
 * because the same address goes into its `Article` structured data as the
 * `image`, and a search engine should see one picture under one URL in both.
 * Next's own attachment appends a cache-busting query known only at build.
 *
 * The address is the one Next gives the `opengraph-image.tsx` beside the
 * article — `/bg/blog/<slug>/opengraph-image-<hash>/<id>` — computed with the
 * function Next's own generated code uses for it (`fillMetadataSegment`), so
 * the two cannot disagree; `test/share-cards.test.ts` and the browser suite
 * hold it to a URL that answers.
 */

/** The route the card lives at, as the app directory names it. */
const ARTICLE_CARD_SEGMENT = "/(site)/[lang]/blog/[slug]";

export function articleCardFacts(
  summary: Pick<ArticleSummary, "title" | "metaDescription" | "modifiedAt">,
  locale: Locale,
): ArticleCardFacts {
  return {
    section: JOURNAL_NAME,
    title: summary.title,
    description: summary.metaDescription,
    date: formatArticleDate(summary.modifiedAt, locale),
  };
}

export const articleCardAlt = (summary: Pick<ArticleSummary, "title">) =>
  `${summary.title} — статия в блога на ${siteConfig.name}`;

/** The card as an `og:image`: absolute address, size, type and `alt`. */
export function articleCard(
  summary: Pick<ArticleSummary, "slug" | "title" | "metaDescription" | "modifiedAt">,
  locale: Locale,
) {
  const route = fillMetadataSegment(
    ARTICLE_CARD_SEGMENT,
    { lang: locale, slug: summary.slug },
    "opengraph-image",
    false,
  );
  return {
    url: absoluteUrl(`${route}/${cardId(articleCardFacts(summary, locale))}`),
    ...CARD_SIZE,
    type: CARD_TYPE,
    alt: articleCardAlt(summary),
  };
}
