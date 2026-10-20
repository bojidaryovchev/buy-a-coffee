import { DEFAULT_PAGE_SIZE, hasActiveFilters, type CatalogQuery } from "@/lib/catalog/filters";

/**
 * A listing's second and later pages: their own address, their own title.
 *
 * Page two of a clean listing is `index, follow` (`shouldIndexListing`): it
 * is the only page that links the products the first one has no room for.
 * Until 20 October 2026 it was `noindex, follow`, and five products were
 * linked from nowhere a search engine keeps following. It used to name page
 * one as its canonical as well, against Google's own advice for pagination,
 * which is a canonical of its own. So page two is canonical to itself, and
 * its title says which page it is. A page number past the last page names
 * nothing and is a 404 (`isPastLastPage`), so an indexable listing cannot
 * be multiplied into empty pages.
 *
 * A filtered, sorted or resized view is a different matter: it is the same
 * products in another arrangement, and still names the clean first page.
 */

/** The page of the clean listing a view is; 1 for page one and for any filtered view. */
export function listingPage(query: CatalogQuery): number {
  const clean =
    !hasActiveFilters(query) && query.sort === "relevance" && query.pageSize === DEFAULT_PAGE_SIZE;
  return clean && query.page > 1 ? query.page : 1;
}

/** The query that names page `page` of a listing: nothing for page one. */
export const pageQuery = (page: number): string => (page > 1 ? `?page=${page}` : "");

/**
 * A page number past a listing's last page: `?page=99` of a two-page listing.
 * The page calls `notFound()` for it before rendering anything. Page one is
 * never past the last, even for an empty listing (`pageCount` is at least 1).
 */
export function isPastLastPage(result: {
  readonly page: number;
  readonly pageCount: number;
}): boolean {
  return result.page > result.pageCount;
}

/** „Кафе капсули — страница 2“: page one keeps its title as it is. */
export const pagedTitle = (title: string, page: number): string =>
  page > 1 ? `${title} — страница ${page}` : title;
