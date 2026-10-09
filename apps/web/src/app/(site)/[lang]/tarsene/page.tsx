import type { Metadata } from "next";
import { Breadcrumbs, ButtonLink, EmptyState } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { Suspense } from "react";
import { SearchField } from "@/components/catalog/search-field";
import { SearchFieldFallback } from "@/components/catalog/search-field-fallback";
import { countActiveFilters, parseCatalogQuery, type RawSearchParams } from "@/lib/catalog/filters";
import { listProducts } from "@/lib/catalog/queries";
import { siteConfig } from "@/config/site";
import { getDictionary } from "@/i18n/dictionaries";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { href, routes } from "@/lib/routes";

/**
 * Search results.
 *
 * Search runs against our own PostgreSQL catalog. The reference site filters
 * an embedded copy of the catalog in the browser; doing that here would mean
 * shipping the whole catalog to every visitor, so this is server-rendered
 * instead.
 *
 * Results pages are never indexed: they are unbounded, user-generated URLs and
 * exactly what `noindex` exists for.
 */
export const revalidate = 60;

interface PageProps {
  params: Promise<LangParams>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  const query = parseCatalogQuery(await searchParams);
  const title = query.q ? `Търсене: ${query.q}` : "Търсене";
  const description = `Търсене в асортимента на ${siteConfig.name}.`;
  return {
    title,
    description,
    alternates: pageAlternates(locale, routes.search),
    ...shareMetadata({ locale, title, description, path: href(locale, routes.search) }),
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ params, searchParams }: PageProps) {
  const locale = await localeFrom(params);
  const copy = getDictionary(locale).search;
  const path = href(locale, routes.search);
  const query = parseCatalogQuery(await searchParams);
  const hasQuery = query.q.length > 0;
  const result = hasQuery ? await listProducts({ query }) : null;

  return (
    <div className="shell pb-16">
      <Breadcrumbs
        items={[
          { name: "Начало", href: href(locale, routes.home) },
          { name: "Търсене", href: path },
        ]}
      />

      <header className="mb-8 max-w-xl">
        <h1 className="font-display text-2xl font-semibold text-ink-900 md:text-4xl">
          {hasQuery ? "Резултати от търсенето" : "Търсене"}
        </h1>
        {hasQuery && (
          <p className="mt-3 text-lg text-ink-700">
            {result?.total ?? 0} {result?.total === 1 ? "резултат" : "резултата"} за{" "}
            <span className="font-medium text-ink-900">„{query.q}“</span>
          </p>
        )}
        <div className="mt-5">
          <Suspense fallback={<SearchFieldFallback locale={locale} copy={copy} />}>
            <SearchField locale={locale} copy={copy} autoFocus={!hasQuery} />
          </Suspense>
        </div>
      </header>

      {!hasQuery ? (
        <EmptyState
          title="Какво търсите?"
          description="Търсете по име на продукт, марка или вид кафе."
          action={
            <ButtonLink href={href(locale, routes.categories)} variant="secondary">
              Или разгледайте категориите
            </ButtonLink>
          }
        />
      ) : result && result.total === 0 && countActiveFilters(query) === 0 ? (
        /*
         * Nothing matches the term itself. When the term does match and the
         * filters on top of it leave nothing, that is the listing's own
         * "no products with these filters" state, with its chips to remove —
         * telling that visitor their word was not found would be wrong.
         * The search field is directly above, in the page head.
         */
        <EmptyState
          title={`Не намерихме „${query.q}“`}
          description="Проверете изписването или опитайте с марка или система."
          action={<ButtonLink href={href(locale, routes.machines)}>Намери по машина</ButtonLink>}
        />
      ) : (
        result && <CatalogListing locale={locale} basePath={path} query={query} result={result} />
      )}
    </div>
  );
}
