import { ProductGrid } from "@/components/catalog/product-card";
import { ActiveFilterChips, FilterPanel } from "@/components/catalog/filter-panel";
import { ListingToolbar } from "@/components/catalog/listing-toolbar";
import { ButtonLink, EmptyState, Pagination } from "@/components/ui/primitives";
import { buildSearchParams, clearFilters, hasActiveFilters, type CatalogQuery } from "@/lib/catalog/filters";
import type { ProductListResult } from "@/lib/catalog/types";

/**
 * The listing view shared by categories, brands, promotions and search.
 *
 * One implementation means filtering, sorting, pagination, empty states and
 * the mobile filter sheet behave identically everywhere, and a fix in one
 * place fixes them all.
 */
export function CatalogListing({
  basePath,
  query,
  result,
  hideBrands,
  hideCategories,
  emptyTitle = "Няма продукти по тези филтри",
  emptyDescription = "Опитайте да махнете филтър или разгледайте целия асортимент.",
}: {
  basePath: string;
  query: CatalogQuery;
  result: ProductListResult;
  hideBrands?: boolean;
  hideCategories?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const filtered = hasActiveFilters(query);

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_1fr] lg:gap-10">
      <aside className="hidden lg:block">
        <div className="sticky top-32">
          <FilterPanel
            basePath={basePath}
            query={query}
            facets={result.facets}
            {...(hideBrands !== undefined ? { hideBrands } : {})}
            {...(hideCategories !== undefined ? { hideCategories } : {})}
          />
        </div>
      </aside>

      <div className="min-w-0">
        <ListingToolbar
          basePath={basePath}
          query={query}
          facets={result.facets}
          total={result.total}
          {...(hideBrands !== undefined ? { hideBrands } : {})}
          {...(hideCategories !== undefined ? { hideCategories } : {})}
        />

        <ActiveFilterChips basePath={basePath} query={query} facets={result.facets} />

        {result.items.length === 0 ? (
          <EmptyState
            /*
             * An empty result has two very different causes, and telling the
             * visitor the wrong one is unhelpful: "this category is empty" when
             * they have simply over-filtered sends them away instead of back.
             */
            title={filtered ? "Няма продукти по тези филтри" : emptyTitle}
            description={
              filtered ? "Опитайте да махнете филтър или разгледайте целия асортимент." : emptyDescription
            }
            action={
              filtered ? (
                <ButtonLink href={`${basePath}${buildSearchParams(clearFilters(query))}`} variant="secondary">
                  Изчисти филтрите
                </ButtonLink>
              ) : (
                <ButtonLink href="/categories" variant="secondary">
                  Разгледай категориите
                </ButtonLink>
              )
            }
          />
        ) : (
          <>
            <ProductGrid products={result.items} />
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              buildHref={(page) => `${basePath}${buildSearchParams(query, { page })}`}
            />
          </>
        )}
      </div>
    </div>
  );
}
