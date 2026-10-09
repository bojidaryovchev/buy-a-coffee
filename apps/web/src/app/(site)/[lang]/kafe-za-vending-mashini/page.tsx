import type { Metadata } from "next";
import { parseCatalogQuery, shouldIndexListing, type RawSearchParams } from "@/lib/catalog/filters";
import { getListingFacts, type ListingFacts } from "@/lib/catalog/listing-facts";
import {
  BUSINESS_SECTIONS,
  getSectionCategory,
  getSectionListing,
  listVendingBlends,
} from "@/lib/catalog/vending";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { href } from "@/lib/routes";
import { cupRangeOfRanges } from "@/lib/catalog/cup-range";
import { metaDescription, pageTitle } from "@/lib/seo/listing-meta";
import { vendingCopy } from "../../../../../content/vending";
import { BusinessSectionView } from "../_components/business-section";

/**
 * Vending zone: coffee for people who fill machines.
 *
 * Everything listed comes from the catalog — the blends the roaster names
 * "Vending", and, once the source files products under its own vending
 * section, that category's listing as well. The prose around them is ours and
 * promises nothing the catalog does not show.
 */
export const revalidate = 300;

const section = BUSINESS_SECTIONS.vending;

interface PageProps {
  params: Promise<LangParams>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  const query = parseCatalogQuery(await searchParams);

  /*
   * What the page lists: the section's own category, once the catalog has
   * one, and the blends the roaster names "Vending". The description quotes
   * the price per cup across both, so it is read from both.
   */
  const [category, blends] = await Promise.all([
    getSectionCategory(section.id),
    listVendingBlends(),
  ]);
  const listed: ListingFacts[] = await Promise.all([
    ...(category && category.productCount > 0
      ? [getListingFacts({ kind: "category", slug: category.slug })]
      : []),
    getListingFacts({ kind: "products", slugs: blends.map((blend) => blend.slug) }),
  ]);
  const cupRange = cupRangeOfRanges(listed.map((facts) => facts.cupRange));

  const description = metaDescription(vendingCopy.metaDescription, cupRange);

  return {
    title: pageTitle(vendingCopy.metaTitle),
    description,
    // Filtered and paginated views of the listing consolidate on the clean page.
    alternates: pageAlternates(locale, section.path),
    ...shareMetadata({
      locale,
      title: vendingCopy.metaTitle,
      description,
      path: href(locale, section.path),
    }),
    robots: shouldIndexListing(query) ? undefined : { index: false, follow: true },
  };
}

export default async function VendingPage({ params, searchParams }: PageProps) {
  const locale = await localeFrom(params);
  const query = parseCatalogQuery(await searchParams);
  const [listing, blends] = await Promise.all([
    getSectionListing(section.id, query),
    listVendingBlends(),
  ]);

  return (
    <BusinessSectionView
      locale={locale}
      copy={vendingCopy}
      path={section.path}
      query={query}
      listing={listing}
      blends={blends}
    />
  );
}
