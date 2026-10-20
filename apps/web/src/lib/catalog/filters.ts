import { z } from "zod";
import { BREWING_SYSTEMS, type BrewingSystemId } from "@/lib/recommend/systems";
import { STRENGTH_ORDER } from "./attributes";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_QUERY_LENGTH,
  SORT_OPTIONS,
  type SortOption,
} from "./filter-query";

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
 * `system` is ours: the reference has no notion of a brewing system.
 *
 * Every input is validated. A malformed parameter degrades to its default
 * rather than producing an error page: a bad link should still show products.
 */

/* The limits, the sort options and the operations on a parsed query know
   nothing of zod and are in a module of their own, so the components in the
   browser can have them without it (`filter-query.ts`). Re-exported here,
   where every page has always found them. */
export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_QUERY_LENGTH,
  SORT_OPTIONS,
  buildSearchParams,
  clearFilters,
  countActiveFilters,
  hasActiveFilters,
  listActiveFilters,
  setSingleFilter,
  shouldIndexListing,
  toggleFilterValue,
  type ActiveFilter,
  type MultiFilterKey,
  type SingleFilterKey,
  type SortOption,
} from "./filter-query";

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

/**
 * Brewing systems, by the ids in `BREWING_SYSTEMS`. Anything else is dropped
 * here, so an unknown id never reaches the query or a chip.
 */
const SYSTEM_IDS: ReadonlySet<string> = new Set(BREWING_SYSTEMS.map((system) => system.id));
const systemValues = multiValue.transform((values) =>
  values.filter((value): value is BrewingSystemId => SYSTEM_IDS.has(value)),
);

/**
 * The intensity band: weak, medium or strong. The raw intensity numeral is
 * deliberately not a parameter — the source declares it on five different
 * scales, so "8" filters nothing meaningful.
 */
const STRENGTH_VALUES: ReadonlySet<string> = new Set(STRENGTH_ORDER);
const strengthValues = multiValue.transform((values) =>
  values.filter((value) => STRENGTH_VALUES.has(value)),
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
  system: systemValues,
  brand: multiValue,
  strength: strengthValues,
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
    system: firstValue(params.system),
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
