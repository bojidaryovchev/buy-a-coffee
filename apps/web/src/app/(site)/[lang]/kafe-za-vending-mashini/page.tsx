import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseCatalogQuery, shouldIndexListing, type RawSearchParams } from "@/lib/catalog/filters";
import { getListingFacts, type ListingFacts } from "@/lib/catalog/listing-facts";
import {
  BUSINESS_SECTIONS,
  getSectionCategory,
  getSectionContents,
  getSectionListing,
  listVendingBlends,
  sectionListsProducts,
} from "@/lib/catalog/vending";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import { isPastLastPage, listingPage, pageQuery, pagedTitle } from "@/lib/seo/pagination";
import { href } from "@/lib/routes";
import { cupRangeOfRanges } from "@/lib/catalog/cup-range";
import { metaDescription, pageTitle } from "@/lib/seo/listing-meta";
import { vendingCopy, vendingMeta } from "../../../../../content/vending";
import { BusinessSectionView } from "../_components/business-section";
import { robotsFor } from "@/lib/seo/robots";

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

  /*
   * The title and the opening of the description say what is listed: bean
   * blends for vending, instant coffee, or both. Instant coffee is recognised
   * by name (`getSectionContents`).
   */
  const contents =
    category && category.productCount > 0 ? await getSectionContents(category) : null;
  const meta = vendingMeta({
    instant: (contents?.instant ?? 0) > 0,
    beans: blends.length > 0 || (contents !== null && contents.instant < contents.products),
  });
  // Page two and later name themselves (`lib/seo/pagination.ts`).
  const page = listingPage(query);
  const metaTitle = pagedTitle(meta.title, page);
  const description = metaDescription(meta.description, cupRange);

  return {
    title: pageTitle(metaTitle),
    description,
    // Filtered and sorted views of the listing consolidate on the clean page.
    alternates: pageAlternates(locale, `${section.path}${pageQuery(page)}`),
    ...shareMetadata({
      locale,
      title: metaTitle,
      description,
      path: href(locale, `${section.path}${pageQuery(page)}`),
    }),
    robots: robotsFor(shouldIndexListing(query)),
  };
}

export default async function VendingPage({ params, searchParams }: PageProps) {
  const locale = await localeFrom(params);
  const query = parseCatalogQuery(await searchParams);
  const [listing, blends, consumablesListed] = await Promise.all([
    getSectionListing(section.id, query),
    listVendingBlends(),
    sectionListsProducts("consumables"),
  ]);
  // `?page=99` of a two-page listing names nothing: a 404, not an empty page.
  if (listing && isPastLastPage(listing.result)) notFound();

  return (
    <BusinessSectionView
      locale={locale}
      copy={vendingCopy}
      path={section.path}
      query={query}
      listing={listing}
      blends={blends}
      relatedListed={consumablesListed}
    />
  );
}
