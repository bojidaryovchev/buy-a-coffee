import type { Metadata } from "next";
import { Breadcrumbs, ButtonLink } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import {
  countActiveFilters,
  parseCatalogQuery,
  shouldIndexListing,
  type RawSearchParams,
} from "@/lib/catalog/filters";
import { listProducts } from "@/lib/catalog/queries";
import { siteConfig } from "@/config/site";

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

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const query = parseCatalogQuery(await searchParams);
  return {
    title: "Актуални промоции",
    description: `Кафе с намалени цени в ${siteConfig.name}.`,
    alternates: { canonical: "/promotions" },
    robots: shouldIndexListing(query) ? undefined : { index: false, follow: true },
  };
}

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseCatalogQuery(await searchParams);
  const result = await listProducts({ query, promotionsOnly: true });
  /*
   * With nothing reduced there is nothing for the lead to describe, and "all
   * of this is reduced" above an empty state would be a sentence about no
   * products. A filtered-to-nothing view still has promotions behind it.
   */
  const hasPromotions = result.total > 0 || countActiveFilters(query) > 0;

  return (
    <div className="shell pb-16">
      <Breadcrumbs
        items={[
          { name: "Начало", href: "/" },
          { name: "Промоции", href: "/promotions" },
        ]}
      />

      <header className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-ink-900 md:text-4xl">
          Актуални промоции
        </h1>
        {hasPromotions && (
          <p className="mt-3 max-w-[60ch] text-lg text-ink-700">
            Всичко тук е с намалена цена. До новата цена стои старата, зачеркната.
          </p>
        )}
      </header>

      <CatalogListing
        basePath="/promotions"
        query={query}
        result={result}
        emptyTitle="В момента няма активни промоции"
        emptyDescription="Щом намалим цена, продуктът се появява тук. Дотогава целият асортимент е на редовните си цени."
        emptyAction={<ButtonLink href="/categories">Разгледайте асортимента</ButtonLink>}
      />
    </div>
  );
}
