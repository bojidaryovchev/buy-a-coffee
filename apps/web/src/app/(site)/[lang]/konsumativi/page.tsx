import type { Metadata } from "next";
import { parseCatalogQuery, shouldIndexListing, type RawSearchParams } from "@/lib/catalog/filters";
import { BUSINESS_SECTIONS, getSectionListing, sectionListsProducts } from "@/lib/catalog/vending";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { consumablesCopy } from "../../../../../content/vending";
import { BusinessSectionView } from "../_components/business-section";

/**
 * Consumables: what the word covers, and how to ask.
 *
 * The catalog lists no consumables today, so this page lists none and says so.
 * It explains the term and takes an enquiry. The day the source files products
 * under its consumables section, that category's listing appears here by
 * itself and the "nothing listed" sentence goes away with it.
 *
 * **`noindex`, and out of the sitemap, while it lists nothing** (the market
 * study's call). „консумативи за кафе“ is 10 searches a month, and a page that
 * says "we do not list this yet" is thin content to a crawler however useful
 * it is to a business reader who arrives through the menu. It stays reachable
 * and followable; the day a product is filed here it becomes indexable by
 * itself — `sectionListsProducts` is the one switch, read by this page and by
 * the sitemap.
 */
export const revalidate = 300;

const section = BUSINESS_SECTIONS.consumables;

interface PageProps {
  params: Promise<LangParams>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  const query = parseCatalogQuery(await searchParams);
  const indexable = shouldIndexListing(query) && (await sectionListsProducts(section.id));

  return {
    title: consumablesCopy.metaTitle,
    description: consumablesCopy.metaDescription,
    // Filtered and paginated views of the listing consolidate on the clean page.
    alternates: pageAlternates(locale, section.path),
    robots: indexable ? undefined : { index: false, follow: true },
  };
}

export default async function ConsumablesPage({ params, searchParams }: PageProps) {
  const locale = await localeFrom(params);
  const query = parseCatalogQuery(await searchParams);
  const listing = await getSectionListing(section.id, query);

  return (
    <BusinessSectionView
      locale={locale}
      copy={consumablesCopy}
      path={section.path}
      query={query}
      listing={listing}
    />
  );
}
