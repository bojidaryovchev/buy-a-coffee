import type { Metadata } from "next";
import { Breadcrumbs, ButtonLink, EmptyState } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { Suspense } from "react";
import { SearchField } from "@/components/catalog/search-field";
import { SearchFieldFallback } from "@/components/catalog/search-field-fallback";
import { parseCatalogQuery, type RawSearchParams } from "@/lib/catalog/filters";
import { listProducts } from "@/lib/catalog/queries";
import { siteConfig } from "@/config/site";

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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const query = parseCatalogQuery(await searchParams);
  return {
    title: query.q ? `Търсене: ${query.q}` : "Търсене",
    description: `Търсене в асортимента на ${siteConfig.name}.`,
    alternates: { canonical: "/search" },
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseCatalogQuery(await searchParams);
  const hasQuery = query.q.length > 0;
  const result = hasQuery
    ? await listProducts({ query })
    : null;

  return (
    <div className="shell pb-16">
      <Breadcrumbs items={[{ name: "Начало", href: "/" }, { name: "Търсене", href: "/search" }]} />

      <header className="mb-8 max-w-xl">
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">
          {hasQuery ? "Резултати от търсенето" : "Търсене"}
        </h1>
        {hasQuery && (
          <p className="mt-2 text-base text-ink-500">
            {result?.total ?? 0} {result?.total === 1 ? "резултат" : "резултата"} за{" "}
            <span className="font-medium text-ink-900">„{query.q}“</span>
          </p>
        )}
        <div className="mt-5">
          <Suspense fallback={<SearchFieldFallback />}>
            <SearchField autoFocus={!hasQuery} />
          </Suspense>
        </div>
      </header>

      {!hasQuery ? (
        <EmptyState
          title="Какво търсите?"
          description="Търсете по име на продукт, марка или вид кафе."
          action={
            <ButtonLink href="/categories" variant="secondary">
              Или разгледайте категориите
            </ButtonLink>
          }
        />
      ) : result && result.total === 0 ? (
        <EmptyState
          title={`Няма съвпадения за „${query.q}“`}
          description="Опитайте с по-кратка или различно изписана дума, или разгледайте асортимента по категории."
          action={
            <ButtonLink href="/categories" variant="secondary">
              Разгледай категориите
            </ButtonLink>
          }
        />
      ) : (
        result && <CatalogListing basePath="/search" query={query} result={result} />
      )}
    </div>
  );
}
