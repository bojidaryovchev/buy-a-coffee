import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArticleBody } from "@/components/journal/article-body";
import { Breadcrumbs } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";
import { siteConfig } from "@/config/site";
import { EMPTY_JOURNAL_FIGURES } from "@/lib/catalog/journal-figures";
import { getJournalFigures } from "@/lib/catalog/journal-queries";
import {
  JOURNAL_NAME,
  JOURNAL_PATH,
  articleDate,
  formatArticleDate,
  getArticle,
  getMovedArticle,
  listArticles,
  listPreviousSlugs,
  summariseArticle,
} from "@/lib/journal";
import { articleJsonLd } from "@/lib/seo/article-json-ld";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { shippingLocale, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { href, routes } from "@/lib/routes";

/**
 * One journal article.
 *
 * Statically generated: the set of slugs is the list of files in the
 * repository, so every article is built ahead of time and an unknown slug is a
 * 404 without rendering anything (`dynamicParams = false`).
 *
 * **A slug an article used to have is part of that set.** An article lists its
 * `previousSlugs`; each is prebuilt here as a 308 to the article's current
 * address, so a retitled article keeps every link and ranking its old address
 * earned. The redirect is decided before anything is read or rendered, which is
 * what makes it a real status line rather than a client-side hop.
 *
 * The page is nonetheless revalidated, for one reason. Some articles quote
 * figures computed from the catalog — price per cup, the intensity scales in
 * use — and those have to follow the catalog rather than freeze at whatever it
 * said on the day of the last deploy. An hour matches the sitemap: these are
 * articles, not price tags, and the product pages remain the place where a
 * price is current to the minute. An article that reads no catalog figures
 * never touches the database here at all.
 */

export const revalidate = 3600;
export const dynamicParams = false;

interface PageProps {
  params: Promise<LangParams & { slug: string }>;
}

export function generateStaticParams() {
  return [
    ...listArticles().map((article) => ({ slug: article.slug })),
    ...listPreviousSlugs().map((slug) => ({ slug })),
  ];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  const locale = shippingLocale(lang);
  const article = getArticle(slug);
  // A moved article has no metadata of its own: the page answers 308 instead.
  if (!article && getMovedArticle(slug)) return {};
  if (!article) return { title: "Статията не е намерена", robots: { index: false, follow: true } };

  const summary = summariseArticle(article);

  return {
    title: summary.title,
    description: summary.description,
    alternates: pageAlternates(locale, summary.href),
    ...shareMetadata({
      locale,
      title: summary.title,
      description: summary.description,
      path: href(locale, summary.href),
      article: {
        publishedTime: articleDate(summary.publishedAt).toISOString(),
        modifiedTime: articleDate(summary.modifiedAt).toISOString(),
      },
    }),
  };
}

export default async function JournalArticlePage({ params }: PageProps) {
  if (!siteConfig.features.blog) notFound();

  const { lang, slug } = await params;
  const locale = shippingLocale(lang);
  const article = getArticle(slug);
  if (!article) {
    const moved = getMovedArticle(slug);
    if (moved) permanentRedirect(href(locale, summariseArticle(moved).href));
    notFound();
  }

  const summary = summariseArticle(article);
  const figures = article.usesCatalog ? await getJournalFigures() : EMPTY_JOURNAL_FIGURES;
  const blocks = article.body(figures);

  const others = listArticles().filter((entry) => entry.slug !== article.slug);
  const revised = summary.modifiedAt !== summary.publishedAt;

  const breadcrumbs = [
    { name: "Начало", href: href(locale, routes.home) },
    { name: JOURNAL_NAME, href: href(locale, JOURNAL_PATH) },
    { name: summary.title, href: href(locale, summary.href) },
  ];

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <JsonLd id="ld-article" data={articleJsonLd(summary, locale)} />
      <Breadcrumbs items={breadcrumbs} />

      <article>
        <header className="mb-8 max-w-prose">
          <p className="text-2xs tracking-wide text-ink-500 uppercase">
            <time dateTime={summary.publishedAt}>
              {formatArticleDate(summary.publishedAt, locale)}
            </time>
            {revised && (
              <>
                {" · обновено на "}
                <time dateTime={summary.modifiedAt}>
                  {formatArticleDate(summary.modifiedAt, locale)}
                </time>
              </>
            )}
            {" · "}
            {siteConfig.name}
          </p>
          <h1 className="mt-2 font-display text-3xl leading-tight font-semibold text-ink-900 md:text-4xl">
            {summary.title}
          </h1>
          <p className="mt-3 text-lg text-ink-500">{summary.description}</p>
        </header>

        <ArticleBody blocks={blocks} locale={locale} />
      </article>

      {others.length > 0 && (
        <nav aria-labelledby="journal-more" className="mt-14 max-w-prose border-t border-line pt-8">
          <h2 id="journal-more" className="font-display text-xl font-semibold text-ink-900">
            Още от блога
          </h2>
          <ul className="mt-4 space-y-3">
            {others.map((entry) => (
              <li key={entry.slug}>
                <Link
                  href={href(locale, entry.href)}
                  className="font-medium text-pine-700 underline underline-offset-2 hover:text-pine-900"
                >
                  {entry.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
