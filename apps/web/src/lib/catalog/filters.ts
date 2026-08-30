import { z } from "zod";

/**
 * Listing query parameters.
 *
 * Filter state lives in the URL so listing pages are shareable, refresh-safe
 * and crawlable. The reference site does the same thing client-side; ours does
 * it server-side, which is the one deliberate improvement over the observed
 * behaviour.
 *
 * The parameter names (`brand`, `strength`, `decaf`, `aromas`) and their
 * multi-value semantics are taken from the reference contract recorded in
 * `reference/latest/filters.json`, so links remain conceptually compatible.
 *
 * Every input is validated. A malformed parameter degrades to its default
 * rather than producing an error page: a bad link should still show products.
 */

export const SORT_OPTIONS = [
  { value: "relevance", label: "Най-подходящи" },
  { value: "name-asc", label: "Име А–Я" },
  { value: "name-desc", label: "Име Я–А" },
  { value: "price-asc", label: "Цена: ниска към висока" },
  { value: "price-desc", label: "Цена: висока към ниска" },
  { value: "newest", label: "Първо най-новите" },
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number]["value"];

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 96;
/** Bounded so a long query cannot be used to make the database work hard. */
export const MAX_QUERY_LENGTH = 80;
const MAX_MULTI_VALUES = 25;

/** Comma-separated multi-value parameter, de-duplicated and sorted. */
const multiValue = z
  .string()
  .optional()
  .transform((value) =>
    [
      ...new Set(
        (value ?? "")
          .split(",")
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => entry.length > 0 && entry.length <= 64),
      ),
    ]
      .sort()
      .slice(0, MAX_MULTI_VALUES),
  );

const yesNo = z
  .string()
  .optional()
  .transform((value) => {
    const normalized = value?.trim().toLowerCase();
    return normalized === "yes" || normalized === "no" ? normalized : null;
  });

export const catalogQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
      return trimmed.slice(0, MAX_QUERY_LENGTH);
    }),
  brand: multiValue,
  strength: multiValue,
  decaf: yesNo,
  aromas: yesNo,
  category: multiValue,
  sort: z
    .string()
    .optional()
    .transform((value): SortOption => {
      const match = SORT_OPTIONS.find((option) => option.value === value);
      return match?.value ?? "relevance";
    }),
  page: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number.parseInt(value ?? "1", 10);
      return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 1;
    }),
  pageSize: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number.parseInt(value ?? "", 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
      return Math.min(parsed, MAX_PAGE_SIZE);
    }),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parse untrusted search params into a validated query. Never throws. */
export function parseCatalogQuery(params: RawSearchParams): CatalogQuery {
  const result = catalogQuerySchema.safeParse({
    q: firstValue(params.q),
    brand: firstValue(params.brand),
    strength: firstValue(params.strength),
    decaf: firstValue(params.decaf),
    aromas: firstValue(params.aromas),
    category: firstValue(params.category),
    sort: firstValue(params.sort),
    page: firstValue(params.page),
    pageSize: firstValue(params.pageSize),
  });

  if (result.success) return result.data;
  // Unreachable in practice — every field has a total transform — but a
  // listing page must render even if that ever stops being true.
  return catalogQuerySchema.parse({});
}

/** True when the visitor has narrowed the listing in any way. */
export function hasActiveFilters(query: CatalogQuery): boolean {
  return (
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

/** Toggle one value of a multi-value filter, resetting to page 1. */
export function toggleFilterValue(
  query: CatalogQuery,
  key: "brand" | "strength" | "category",
  value: string,
): CatalogQuery {
  const current = new Set(query[key]);
  if (current.has(value)) current.delete(value);
  else current.add(value);
  return { ...query, [key]: [...current].sort(), page: 1 };
}

export function setSingleFilter(
  query: CatalogQuery,
  key: "decaf" | "aromas",
  value: "yes" | "no" | null,
): CatalogQuery {
  return { ...query, [key]: query[key] === value ? null : value, page: 1 };
}

export function clearFilters(query: CatalogQuery): CatalogQuery {
  return { ...query, brand: [], strength: [], category: [], decaf: null, aromas: null, page: 1 };
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
