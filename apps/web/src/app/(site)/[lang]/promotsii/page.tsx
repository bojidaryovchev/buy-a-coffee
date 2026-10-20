import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs, ButtonLink } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { JsonLd } from "@/components/seo/json-ld";
import {
  countActiveFilters,
  parseCatalogQuery,
  shouldIndexListing,
  type RawSearchParams,
} from "@/lib/catalog/filters";
import { getListingFacts } from "@/lib/catalog/listing-facts";
import { listProducts } from "@/lib/catalog/queries";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { isPastLastPage, listingPage, pageQuery, pagedTitle } from "@/lib/seo/pagination";
import { breadcrumbJsonLd, listingBreadcrumbs } from "@/lib/seo/json-ld";
import {
  CALLBACK_SENTENCE,
  PROMOTIONS_META,
  metaDescription,
  pageTitle,
} from "@/lib/seo/listing-meta";
import { href, routes } from "@/lib/routes";
import { robotsFor } from "@/lib/seo/robots";

/**
 * Promotions.
 *
 * What is reduced today: mostly the shop's own promotions (`promotions`,
 * chosen by the owner in the panel, for a run of days), and any struck price
 * the source itself shows. The page is there whether or not anything is, and
 * renders a proper empty state rather than a 404, so the link is never broken
 * and the page fills the moment a promotion starts — by itself, at the start
 * of its first day, with no deploy.
 *
 * "Reduced" is decided in one place, `isReduced` in `price-sql.ts`, through
 * `listProducts({ promotionsOnly })`: the struck price must be genuinely
 * higher than the price the customer pays. Under a promotion the struck price
 * is the lowest of the 30 days before it, so a product the promotion prices
 * without a claim to make (its 30-day lowest was already lower) is not listed
 * here: this page is a claim. Both are exact `numeric(12,2)` values compared
 * as numbers in SQL, which is the same comparison of minor units
 * `discountPercent` makes for the card — so a product is on this page exactly
 * when its card shows a struck-out price.
 *
 * The copy holds no figure and no date: how much and until when belong to
 * each product, and its card and page say them.
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<LangParams>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  const query = parseCatalogQuery(await searchParams);
  const facts = await getListingFacts({ kind: "promotions" });
  const hasPromotions = facts.productCount > 0;
  const description = hasPromotions
    ? metaDescription(PROMOTIONS_META.description, facts.cupRange)
    : `${PROMOTIONS_META.descriptionWhenEmpty} ${CALLBACK_SENTENCE}`;
  // Page two and later name themselves (`lib/seo/pagination.ts`).
  const page = listingPage(query);
  const title = pagedTitle(PROMOTIONS_META.title, page);
  return {
    /* Searchers type the singular as a modifier — „кафе на зърна промоция“,
       „капсули долче густо промоция“ — so the title carries „промоция“. */
    title: pageTitle(title),
    description,
    alternates: pageAlternates(locale, `${routes.promotions}${pageQuery(page)}`),
    ...shareMetadata({
      locale,
      title,
      description,
      path: href(locale, `${routes.promotions}${pageQuery(page)}`),
    }),
    /*
     * The page exists for search only while a reduction does (`docs/seo.md`
     * §1). With nothing reduced it still answers 200, so no link to it breaks,
     * but a page that says "nothing here today" is not one to index under
     * „промоция“.
     */
    robots: robotsFor(hasPromotions && shouldIndexListing(query)),
  };
}

export default async function PromotionsPage({ params, searchParams }: PageProps) {
  const locale = await localeFrom(params);
  const path = href(locale, routes.promotions);
  const query = parseCatalogQuery(await searchParams);
  const result = await listProducts({ query, promotionsOnly: true });
  // `?page=99` of a two-page listing names nothing: a 404, not an empty page.
  if (isPastLastPage(result)) notFound();
  /*
   * With nothing reduced there is nothing for the lead to describe, and "all
   * of this is reduced" above an empty state would be a sentence about no
   * products. A filtered-to-nothing view still has promotions behind it.
   */
  const hasPromotions = result.total > 0 || countActiveFilters(query) > 0;
  const breadcrumbs = listingBreadcrumbs(locale, [{ name: PROMOTIONS_META.name, href: path }]);

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <Breadcrumbs items={breadcrumbs} />

      <header className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-ink-900 md:text-4xl">
          {PROMOTIONS_META.name}
        </h1>
        {hasPromotions && (
          <p className="mt-3 max-w-[60ch] text-lg text-ink-700">
            Всичко тук е с намалена цена. До нея стои зачеркната цената преди намалението, а при
            наша промоция страницата на продукта казва и докога важи.
          </p>
        )}
      </header>

      <CatalogListing
        locale={locale}
        basePath={path}
        query={query}
        result={result}
        emptyTitle="В момента няма активни промоции"
        emptyDescription="Когато пуснем промоция, намалените продукти се появяват тук. Дотогава целият асортимент е на редовните си цени."
        emptyAction={
          <ButtonLink href={href(locale, routes.categories)}>Разгледайте асортимента</ButtonLink>
        }
      />
    </div>
  );
}
