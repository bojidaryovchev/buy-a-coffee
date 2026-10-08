import type { Metadata } from "next";
import { parseCatalogQuery, shouldIndexListing, type RawSearchParams } from "@/lib/catalog/filters";
import { BUSINESS_SECTIONS, getSectionListing, listVendingBlends } from "@/lib/catalog/vending";
import { vendingCopy } from "../../../../content/vending";
import { BusinessSectionView } from "./_components/business-section";

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
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const query = parseCatalogQuery(await searchParams);

  return {
    title: vendingCopy.metaTitle,
    description: vendingCopy.metaDescription,
    // Filtered and paginated views of the listing consolidate on the clean page.
    alternates: { canonical: section.path },
    robots: shouldIndexListing(query) ? undefined : { index: false, follow: true },
  };
}

export default async function VendingPage({ searchParams }: PageProps) {
  const query = parseCatalogQuery(await searchParams);
  const [listing, blends] = await Promise.all([
    getSectionListing(section.id, query),
    listVendingBlends(),
  ]);

  return (
    <BusinessSectionView
      copy={vendingCopy}
      path={section.path}
      query={query}
      listing={listing}
      blends={blends}
    />
  );
}
