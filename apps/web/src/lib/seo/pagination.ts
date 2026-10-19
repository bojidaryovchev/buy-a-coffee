import { DEFAULT_PAGE_SIZE, hasActiveFilters, type CatalogQuery } from "@/lib/catalog/filters";

/**
 * A listing's second and later pages: their own address, their own title.
 *
 * Page two of a listing is `noindex, follow` (`shouldIndexListing`): it is not
 * a page to rank, but it is the only page that links the products the first
 * one has no room for, and robots.txt lets a crawler fetch it for that. It
 * used to name page one as its canonical as well, which tells a search engine
 * two things at once — "this is page one" and "do not index this" — and
 * Google's own advice for pagination is a canonical of its own. So page two
 * is canonical to itself, and its title says which page it is.
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

/** „Кафе капсули — страница 2“: page one keeps its title as it is. */
export const pagedTitle = (title: string, page: number): string =>
  page > 1 ? `${title} — страница ${page}` : title;
