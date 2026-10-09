import type { Metadata } from "next";
import { HomeView } from "@/components/home/home-view";
import { siteConfig } from "@/config/site";
import { parseCatalogQuery } from "@/lib/catalog/filters";
import { listHeroShelfCandidates } from "@/lib/catalog/home-queries";
import { selectHeroShelf } from "@/lib/catalog/home-shelf";
import {
  getCatalogSummary,
  getSystemAvailability,
  listBrands,
  listNewArrivals,
  listProducts,
} from "@/lib/catalog/queries";
import { listArticles } from "@/lib/journal";
import { getDictionary } from "@/i18n/dictionaries";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { routes } from "@/lib/routes";

/**
 * Home page.
 *
 * Every module is catalog-driven: the packshots, systems, brands, counts and
 * products shown here come from the database, so the page reflects the real
 * range rather than a hardcoded list that drifts.
 *
 * Sections that would have nothing to show are omitted entirely rather than
 * rendering an empty shell — the promotions band only appears when there
 * genuinely are promotions, the journal only when it has articles. The
 * sections themselves, and that rule, live in `components/home/`; this file
 * decides what is read and how many round trips it costs.
 *
 * The Organization and WebSite structured data come from the site layout,
 * which wraps this page.
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  const { site } = getDictionary(locale);
  return {
    title: { absolute: `${siteConfig.name} — ${site.tagline}` },
    description: site.description,
    alternates: pageAlternates(locale, routes.home),
  };
}

export default async function HomePage({ params }: PageProps) {
  const locale = await localeFrom(params);
  /*
   * Eleven round trips, all started together: summary 3, systems 1, brands 2,
   * new arrivals 2, promotions 2 (3 when there are any, for their images),
   * hero shelf 1. The journal is content in the repository and costs none.
   */
  const [summary, systemCounts, brands, newArrivals, promotions, shelfCandidates] =
    await Promise.all([
      getCatalogSummary(),
      getSystemAvailability(),
      listBrands({ withProductsOnly: true }),
      listNewArrivals(8),
      listProducts({
        query: { ...parseCatalogQuery({}), pageSize: 4 },
        promotionsOnly: true,
        includeFacets: false,
      }),
      listHeroShelfCandidates(),
    ]);

  return (
    <HomeView
      locale={locale}
      productCount={summary.products}
      brands={brands}
      systemCounts={systemCounts}
      shelf={selectHeroShelf(shelfCandidates)}
      newArrivals={newArrivals}
      promotions={promotions.items}
      articles={siteConfig.features.blog ? listArticles({ limit: 3 }) : []}
    />
  );
}
