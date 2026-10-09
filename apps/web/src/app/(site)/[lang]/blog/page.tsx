import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs, ButtonLink, EmptyState } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";
import { absoluteUrl, siteConfig } from "@/config/site";
import { JOURNAL_NAME, JOURNAL_PATH, formatArticleDate, listArticles } from "@/lib/journal";
import { breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo/json-ld";
import { SHARE_CARD } from "@/lib/seo/share-card";
import { OG_LOCALE } from "@/i18n/config";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { href, routes } from "@/lib/routes";

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

const TITLE = JOURNAL_NAME;
const DESCRIPTION =
  "Видове капсули, как се избира кафе на зърна, арабика и робуста, цена на чаша — отговори на въпросите, които изникват преди поръчка.";

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: pageAlternates(locale, JOURNAL_PATH),
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      title: `${TITLE} — ${siteConfig.name}`,
      description: DESCRIPTION,
      url: absoluteUrl(href(locale, JOURNAL_PATH)),
      locale: OG_LOCALE[locale],
      // Named explicitly: setting `openGraph` drops the inherited share card.
      images: [{ url: absoluteUrl(SHARE_CARD) }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${TITLE} — ${siteConfig.name}`,
      description: DESCRIPTION,
      images: [{ url: absoluteUrl(SHARE_CARD) }],
    },
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
              <article className="py-6">
                <p className="text-2xs tracking-wide text-ink-500 uppercase">
                  <time dateTime={article.publishedAt}>
                    {formatArticleDate(article.publishedAt, locale)}
                  </time>
                </p>
                <h2 className="mt-1.5 font-display text-xl font-semibold text-ink-900 md:text-2xl">
                  <Link
                    href={href(locale, article.href)}
                    className="underline-offset-4 hover:text-pine-700 hover:underline"
                  >
                    {article.title}
                  </Link>
                </h2>
                <p className="mt-2 max-w-prose text-sm text-ink-700">{article.description}</p>
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
