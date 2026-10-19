import { siteConfig } from "@/config/site";
import { getArticle, summariseArticle } from "@/lib/journal";
import { articleCardAlt, articleCardFacts } from "@/lib/seo/og/article-card";
import { cardImage, cardLocale, renderArticleCard } from "@/lib/seo/og/data";

/**
 * The share card of an article: its question, large, and the first lines of
 * the answer, beside the shop's mark on pine. The articles have no
 * photographs of their own, and a stock picture would be decoration posing as
 * content.
 *
 * The article names this card itself, as its `og:image` and as the `image` of
 * its structured data, at the address `articleCard` computes
 * (`lib/seo/og/article-card.ts`); the id is a hash of what the card shows, so
 * a retitled or revised article is a new address. See `lib/seo/og/`.
 */
export const revalidate = 0;

type Params = { lang: string; slug: string };

function subject({ lang, slug }: Params) {
  const locale = cardLocale(lang);
  if (!siteConfig.features.blog || !locale) return null;
  const article = getArticle(slug);
  return article ? { summary: summariseArticle(article), locale } : null;
}

export async function generateImageMetadata({ params }: { params: Promise<Params> | Params }) {
  const found = subject(await params);
  return found
    ? cardImage(articleCardAlt(found.summary), articleCardFacts(found.summary, found.locale))
    : [];
}

export default async function Image({ params }: { params: Promise<Params> }) {
  const found = subject(await params);
  if (!found) return new Response("Not found", { status: 404 });
  return renderArticleCard(articleCardFacts(found.summary, found.locale));
}
