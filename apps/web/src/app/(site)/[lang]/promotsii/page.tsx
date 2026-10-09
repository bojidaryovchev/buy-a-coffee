import type { Metadata } from "next";
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
import { breadcrumbJsonLd, listingBreadcrumbs } from "@/lib/seo/json-ld";
import {
  CALLBACK_SENTENCE,
  PROMOTIONS_META,
  metaDescription,
  pageTitle,
} from "@/lib/seo/listing-meta";
import { href, routes } from "@/lib/routes";

/**
 * Promotions.
 *
 * The capability is real even when the list is empty — the reference site has
 * a working promotions route with no active offers today. This route therefore
 * renders a proper empty state rather than a 404, so the link is never broken
 * and the page is ready the moment a reduced price appears in the catalog.
 *
 * "Reduced" is decided in one place, `listProducts({ promotionsOnly })`: the
 * old price must be genuinely higher than the price the customer pays. Both
 * are exact `numeric(12,2)` columns compared as numbers in SQL, which is the
 * same comparison of minor units `discountPercent` makes for the card — so a
 * product is on this page exactly when its card shows a struck-out price.
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
  return {
    /* Searchers type the singular as a modifier — „кафе на зърна промоция“,
       „капсули долче густо промоция“ — so the title carries „промоция“. */
    title: pageTitle(PROMOTIONS_META.title),
    description,
    alternates: pageAlternates(locale, routes.promotions),
    ...shareMetadata({
      locale,
      title: PROMOTIONS_META.title,
      description,
      path: href(locale, routes.promotions),
    }),
    /*
     * The page exists for search only while a reduction does (`docs/seo.md`
     * §1). With nothing reduced it still answers 200, so no link to it breaks,
     * but a page that says "nothing here today" is not one to index under
     * „промоция“.
     */
    robots: hasPromotions && shouldIndexListing(query) ? undefined : { index: false, follow: true },
  };
}

export default async function PromotionsPage({ params, searchParams }: PageProps) {
  const locale = await localeFrom(params);
  const path = href(locale, routes.promotions);
  const query = parseCatalogQuery(await searchParams);
  const result = await listProducts({ query, promotionsOnly: true });
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
            Всичко тук е с намалена цена. До новата цена стои старата, зачеркната.
          </p>
        )}
      </header>

      <CatalogListing
        locale={locale}
        basePath={path}
        query={query}
        result={result}
        emptyTitle="В момента няма активни промоции"
        emptyDescription="Щом намалим цена, продуктът се появява тук. Дотогава целият асортимент е на редовните си цени."
        emptyAction={
          <ButtonLink href={href(locale, routes.categories)}>Разгледайте асортимента</ButtonLink>
        }
      />
    </div>
  );
}
