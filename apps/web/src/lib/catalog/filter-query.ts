import type { CatalogQuery } from "./filters";

/**
 * The listing query once it is parsed: its limits, its sort options and the
 * plain operations on it, without zod.
 *
 * `filters.ts` builds the schema that parses a URL into a query as it loads,
 * so whatever imports anything from it carries zod into the browser. The
 * search field is in the header of every page and needs one number from here;
 * the listing toolbar and the filter panel need the rest. They import this
 * module, and the parsing stays on the server, where the pages call it.
 * `filters.ts` re-exports all of it, so every server import is unchanged.
 */

/** In the order the sort control lists them. */
export const SORT_OPTIONS = [
  { value: "relevance", label: "Най-подходящи" },
  { value: "price-per-cup", label: "Цена на чаша: ниска към висока" },
  { value: "price-asc", label: "Цена: ниска към висока" },
  { value: "price-desc", label: "Цена: висока към ниска" },
  { value: "newest", label: "Първо най-новите" },
  { value: "name-asc", label: "Име А–Я" },
  { value: "name-desc", label: "Име Я–А" },
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number]["value"];

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 96;
/** Bounded so a long query cannot be used to make the database work hard. */
export const MAX_QUERY_LENGTH = 80;

/** True when the visitor has narrowed the listing in any way. */
export function hasActiveFilters(query: CatalogQuery): boolean {
  return (
    query.system.length > 0 ||
    query.brand.length > 0 ||
    query.strength.length > 0 ||
    query.category.length > 0 ||
    query.decaf !== null ||
    query.aromas !== null ||
    query.q.length > 0
  );
}

export function countActiveFilters(query: CatalogQuery): number {
  return (
    query.system.length +
    query.brand.length +
    query.strength.length +
    query.category.length +
    (query.decaf ? 1 : 0) +
    (query.aromas ? 1 : 0)
  );
}

/**
 * Serialise a query back to a search string.
 *
 * Defaults are omitted so the canonical URL of an unfiltered listing is the
 * bare path, and the parameter order is fixed so the same state always
 * produces the same URL.
 */
export function buildSearchParams(
  query: Partial<CatalogQuery>,
  overrides: Partial<CatalogQuery> = {},
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();

  if (merged.q) params.set("q", merged.q);
  if (merged.system?.length) params.set("system", [...merged.system].sort().join(","));
  if (merged.brand?.length) params.set("brand", [...merged.brand].sort().join(","));
  if (merged.strength?.length) params.set("strength", [...merged.strength].sort().join(","));
  if (merged.category?.length) params.set("category", [...merged.category].sort().join(","));
  if (merged.decaf) params.set("decaf", merged.decaf);
  if (merged.aromas) params.set("aromas", merged.aromas);
  if (merged.sort && merged.sort !== "relevance") params.set("sort", merged.sort);
  if (merged.page && merged.page > 1) params.set("page", String(merged.page));
  if (merged.pageSize && merged.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set("pageSize", String(merged.pageSize));
  }

  const serialised = params.toString();
  return serialised ? `?${serialised}` : "";
}

export type MultiFilterKey = "system" | "brand" | "strength" | "category";
export type SingleFilterKey = "decaf" | "aromas";

/** Toggle one value of a multi-value filter, resetting to page 1. */
export function toggleFilterValue(
  query: CatalogQuery,
  key: MultiFilterKey,
  value: string,
): CatalogQuery {
  const current = new Set(query[key]);
  if (current.has(value)) current.delete(value);
  else current.add(value);
  return { ...query, [key]: [...current].sort(), page: 1 };
}

export function setSingleFilter(
  query: CatalogQuery,
  key: SingleFilterKey,
  value: "yes" | "no" | null,
): CatalogQuery {
  return { ...query, [key]: query[key] === value ? null : value, page: 1 };
}

export function clearFilters(query: CatalogQuery): CatalogQuery {
  return {
    ...query,
    system: [],
    brand: [],
    strength: [],
    category: [],
    decaf: null,
    aromas: null,
    page: 1,
  };
}

export interface ActiveFilter {
  readonly key: MultiFilterKey | SingleFilterKey;
  readonly value: string;
  /**
   * The search string of the same listing without this one filter — every
   * other filter, the search term and the sort order kept, back on page 1.
   */
  readonly removeSearch: string;
}

/**
 * The active filters, one entry per removable value, in the order the filter
 * groups appear in the panel. The search term is not one of them: it is
 * changed in the search field, not removed with a chip.
 */
export function listActiveFilters(query: CatalogQuery): readonly ActiveFilter[] {
  const multi = (key: MultiFilterKey): ActiveFilter[] =>
    query[key].map((value) => ({
      key,
      value,
      removeSearch: buildSearchParams(toggleFilterValue(query, key, value)),
    }));
  const single = (key: SingleFilterKey): ActiveFilter[] => {
    const value = query[key];
    return value
      ? [{ key, value, removeSearch: buildSearchParams(setSingleFilter(query, key, null)) }]
      : [];
  };

  return [
    ...multi("system"),
    ...multi("category"),
    ...multi("brand"),
    ...multi("strength"),
    ...single("decaf"),
    ...single("aromas"),
  ];
}

/**
 * Whether a listing URL should be indexed.
 *
 * A filtered or paginated permutation is near-duplicate content and would
 * dilute the canonical listing, so only the clean first page is indexable.
 */
export function shouldIndexListing(query: CatalogQuery): boolean {
  return !hasActiveFilters(query) && query.page === 1 && query.sort === "relevance";
}
