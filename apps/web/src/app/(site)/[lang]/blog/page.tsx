import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, ButtonLink, EmptyState } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";
import { siteConfig } from "@/config/site";
import { JOURNAL_NAME, JOURNAL_PATH, formatArticleDate, listArticles } from "@/lib/journal";
import { breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo/json-ld";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { href, routes } from "@/lib/routes";
import { pageTitle } from "@/lib/seo/title";
import { JOURNAL_META } from "@/lib/seo/page-meta";
import { ArticleDrawing } from "@/components/journal/article-drawing";

/**
 * Journal index.
 *
 * The articles are files in the repository (`apps/web/content/journal/`), so
 * this page is static: it reads no database and renders once at build. Newest
 * first, which today means the order they are listed in — the articles with
 * measured search demand lead — since they all carry the same date.
 *
 * The empty state is kept. A journal with every article unlisted should still
 * say something true rather than render a heading over nothing.
 */

/** The heading and the breadcrumb: the section's name. The title says more (`JOURNAL_META`). */
const TITLE = JOURNAL_NAME;

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  return {
    title: pageTitle(JOURNAL_META.title),
    description: JOURNAL_META.description,
    alternates: pageAlternates(locale, JOURNAL_PATH),
    ...shareMetadata({
      locale,
      title: JOURNAL_META.title,
      description: JOURNAL_META.description,
      path: href(locale, JOURNAL_PATH),
    }),
  };
}

export default async function JournalPage({ params }: PageProps) {
  const locale = await localeFrom(params);
  if (!siteConfig.features.blog) notFound();

  const articles = listArticles();
  const breadcrumbs = [
    { name: "Начало", href: href(locale, routes.home) },
    { name: TITLE, href: href(locale, JOURNAL_PATH) },
  ];

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      {articles.length > 0 && (
        <JsonLd
          id="ld-journal"
          data={itemListJsonLd(
            articles.map((article) => ({ name: article.title, href: href(locale, article.href) })),
            TITLE,
          )}
        />
      )}
      <Breadcrumbs items={breadcrumbs} />

      <header className="mb-8 max-w-prose">
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">{TITLE}</h1>
        <p className="mt-2 text-base text-ink-500">
          Отговори на въпросите, които изникват преди поръчка.
        </p>
      </header>

      {articles.length === 0 ? (
        <EmptyState
          title="Още нищо публикувано"
          description="Пишем първите текстове. Междувременно можете да разгледате асортимента."
          action={
            <ButtonLink href={href(locale, routes.categories)} variant="secondary">
              Разгледай асортимента
            </ButtonLink>
          }
        />
      ) : (
        <ol className="max-w-3xl divide-y divide-line border-y border-line">
          {articles.map((article) => (
            <li key={article.slug}>
              {/* Each article's drawing beside it (DESIGN.md, "Imagery"). */}
              <article className="flex gap-6 py-6">
                <ArticleDrawing slug={article.slug} className="hidden w-24 shrink-0 sm:flex" />
                <div className="min-w-0">
                  <p className="text-2xs tracking-wide text-ink-500 uppercase">
                    <time dateTime={article.publishedAt}>
                      {formatArticleDate(article.publishedAt, locale)}
                    </time>
                  </p>
                  <h2 className="mt-1.5 font-display text-xl font-semibold text-ink-900 md:text-2xl">
                    <Link
                      href={href(locale, article.href)}
                      // Vertical padding on an inline link widens what a finger
                      // can hit without moving a line of the layout.
                      className="py-2 underline-offset-4 hover:text-pine-700 hover:underline"
                    >
                      {article.title}
                    </Link>
                  </h2>
                  <p className="mt-2 max-w-prose text-sm text-ink-700">{article.description}</p>
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
