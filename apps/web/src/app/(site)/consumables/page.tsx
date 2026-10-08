import type { Metadata } from "next";
import { parseCatalogQuery, shouldIndexListing, type RawSearchParams } from "@/lib/catalog/filters";
import { BUSINESS_SECTIONS, getSectionListing } from "@/lib/catalog/vending";
import { consumablesCopy } from "../../../../content/vending";
import { BusinessSectionView } from "../vending/_components/business-section";

/**
 * Consumables: what the word covers, and how to ask.
 *
 * The catalog lists no consumables today, so this page lists none and says so.
 * It explains the term and takes an enquiry. The day the source files products
 * under its consumables section, that category's listing appears here by
 * itself and the "nothing listed" sentence goes away with it.
 */
export const revalidate = 300;

const section = BUSINESS_SECTIONS.consumables;

interface PageProps {
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const query = parseCatalogQuery(await searchParams);

  return {
    title: consumablesCopy.metaTitle,
    description: consumablesCopy.metaDescription,
    // Filtered and paginated views of the listing consolidate on the clean page.
    alternates: { canonical: section.path },
    robots: shouldIndexListing(query) ? undefined : { index: false, follow: true },
  };
}

export default async function ConsumablesPage({ searchParams }: PageProps) {
  const query = parseCatalogQuery(await searchParams);
  const listing = await getSectionListing(section.id, query);

  return (
    <BusinessSectionView
      copy={consumablesCopy}
      path={section.path}
      query={query}
      listing={listing}
    />
  );
}
