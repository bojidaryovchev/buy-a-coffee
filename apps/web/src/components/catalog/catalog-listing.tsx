import type { ReactNode } from "react";
import { ProductGrid } from "@/components/catalog/product-card";
import { ActiveFilterChips, FilterPanel } from "@/components/catalog/filter-panel";
import { ListingToolbar } from "@/components/catalog/listing-toolbar";
import { ButtonLink, EmptyState, Pagination } from "@/components/ui/primitives";
import {
  buildSearchParams,
  clearFilters,
  countActiveFilters,
  type CatalogQuery,
} from "@/lib/catalog/filters";
import type { ProductListResult } from "@/lib/catalog/types";

/**
 * The listing view shared by categories, brands, promotions and search.
 * Specified in DESIGN.md, "Listing page".
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
  emptyTitle = "Тук още няма продукти",
  emptyDescription,
  emptyAction,
}: {
  basePath: string;
  query: CatalogQuery;
  result: ProductListResult;
  hideBrands?: boolean;
  hideCategories?: boolean;
  /** Said when the listing holds nothing at all — not when it is over-filtered. */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
}) {
  const isEmpty = result.items.length === 0;
  /*
   * An empty result has two very different causes, and telling the visitor
   * the wrong one is unhelpful: "this category is empty" when they have simply
   * over-filtered sends them away instead of back. A search term counts as
   * narrowing too — the page that owns the term handles "nothing matches it"
   * itself, before it ever renders this component.
   */
  const narrowed = countActiveFilters(query) > 0 || query.q.length > 0;

  if (isEmpty && !narrowed && result.total === 0) {
    // Nothing to filter, sort or count: the empty state is the whole listing.
    return (
      <EmptyState
        title={emptyTitle}
        {...(emptyDescription ? { description: emptyDescription } : {})}
        action={emptyAction ?? <ButtonLink href="/wizard">Кое кафе е за вас</ButtonLink>}
      />
    );
  }

  const panelProps = {
    basePath,
    query,
    facets: result.facets,
    ...(hideBrands !== undefined ? { hideBrands } : {}),
    ...(hideCategories !== undefined ? { hideCategories } : {}),
  };

  return (
    <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-8">
      <aside className="hidden lg:block">
        {/* 128 px: the sticky header (116 px) and a little air. */}
        <div className="sticky top-32 -mx-1 max-h-[calc(100dvh-9rem)] overflow-y-auto px-1">
          <FilterPanel {...panelProps} />
        </div>
      </aside>

      <div className="min-w-0">
        <ListingToolbar {...panelProps} total={result.total} />

        <ActiveFilterChips basePath={basePath} query={query} facets={result.facets} />

        {/*
         * The cards are `h3`. On a phone the rail — and its "Филтри" heading —
         * is not rendered, so without this the page would step from `h1`
         * straight to `h3`.
         */}
        <h2 className="sr-only">Продукти</h2>

        {isEmpty && result.total > 0 ? (
          // A page number past the end — an old link to a listing that shrank.
          <EmptyState
            title="На тази страница няма продукти"
            description="Списъкът е по-къс, отколкото беше. Започнете от първата страница."
            action={
              <ButtonLink href={`${basePath}${buildSearchParams(query, { page: 1 })}`}>
                Към първата страница
              </ButtonLink>
            }
          />
        ) : isEmpty ? (
          // The toolbar, the chips and the rail stay: they are the way out.
          <EmptyState
            title="Няма продукти с тези филтри"
            description="Махнете някой филтър и опитайте пак."
            action={
              <ButtonLink href={`${basePath}${buildSearchParams(clearFilters(query))}`}>
                Изчисти филтрите
              </ButtonLink>
            }
          />
        ) : (
          <>
            {/*
             * Beside the rail the grid is three columns wide, not the four it
             * uses at full width. `ProductGrid` belongs to the card and takes
             * no column count, so the narrower grid is set from here.
             */}
            <div className="lg:[&>ul]:grid-cols-3">
              <ProductGrid products={result.items} />
            </div>
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
