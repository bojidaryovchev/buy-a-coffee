import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { parseCatalogQuery, shouldIndexListing, type RawSearchParams } from "@/lib/catalog/filters";
import { listProducts } from "@/lib/catalog/queries";
import { siteConfig } from "@/config/site";

/**
 * Promotions.
 *
 * The capability is real even when the list is empty — the reference site has
 * a working promotions route with no active offers today. This route therefore
 * renders a proper empty state rather than a 404, so the link is never broken
 * and the page is ready the moment a reduced price appears in the catalog.
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

  return (
    <div className="shell pb-16">
      <Breadcrumbs
        items={[
          { name: "Начало", href: "/" },
          { name: "Промоции", href: "/promotions" },
        ]}
      />

      <header className="mb-8 max-w-prose">
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">
          Актуални промоции
        </h1>
        <p className="mt-2 text-base text-ink-500">
          Всичко тук е с намалена цена. Промоциите се сменят с движението на наличностите, така че
          си струва да проверявате.
        </p>
      </header>

      <CatalogListing
        basePath="/promotions"
        query={query}
        result={result}
        emptyTitle="В момента няма активни промоции"
        emptyDescription="В момента няма намалени продукти. Новите промоции се появяват тук веднага щом започнат."
      />
    </div>
  );
}
