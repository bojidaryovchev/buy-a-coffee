import Link from "next/link";
// Not `filters.ts`, which carries zod: the panel is in the browser too (`filter-query.ts`).
import type { CatalogQuery } from "@/lib/catalog/filters";
import {
  buildSearchParams,
  clearFilters,
  countActiveFilters,
  listActiveFilters,
  setSingleFilter,
  toggleFilterValue,
  type ActiveFilter,
  type MultiFilterKey,
  type SingleFilterKey,
} from "@/lib/catalog/filter-query";
import { AROMAS_LABELS, DECAF_LABELS, STRENGTH_LABELS } from "@/lib/catalog/attributes";
import type { CatalogFacets, FacetValue } from "@/lib/catalog/types";
import { getBrewingSystem } from "@/lib/recommend/systems";
import { SystemIcon } from "@/components/catalog/system-icon";
import { cx } from "@/components/ui/primitives";

/**
 * Catalog filters. Specified in DESIGN.md, "Listing page".
 *
 * Every control is an ordinary link that points at the same page with a
 * different query string. That means filtering works with JavaScript disabled,
 * each filtered view is shareable and bookmarkable, the back button behaves,
 * and there is no client-side state to fall out of sync with the URL.
 *
 * The reference site filters by hiding DOM nodes in the browser. This is a
 * deliberate improvement rather than a copy, and it is why the storefront can
 * server-render a filtered listing at all.
 */

interface FilterPanelProps {
  readonly basePath: string;
  readonly query: CatalogQuery;
  readonly facets: CatalogFacets;
  /** Hide the brand group on a brand page, where it is meaningless. */
  readonly hideBrands?: boolean;
  /**
   * The category group is not part of the standard panel: on every listing we
   * have, the categories a visitor could pick are the brewing systems, and
   * "Система" already offers those. It is drawn only when a caller passes
   * `false` — a section whose subcategories are not systems.
   */
  readonly hideCategories?: boolean;
  /**
   * False where the container already carries the title "Филтри" (the phone
   * disclosure and the sheet), so it is not said twice.
   */
  readonly showTitle?: boolean;
}

function hrefFor(basePath: string, query: CatalogQuery): string {
  return `${basePath}${buildSearchParams(query)}`;
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="group border-b border-line py-3 last:border-b-0">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-sm text-sm font-semibold text-ink-900 lg:min-h-9 [&::-webkit-details-marker]:hidden">
        {title}
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-4 w-4 text-ink-500 transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}

function CheckboxLink({
  href,
  checked,
  label,
  count,
  systemId,
}: {
  href: string;
  checked: boolean;
  label: string;
  count: number;
  /** Set for a brewing system: its icon precedes its name, in its colour. */
  systemId?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        // `aria-pressed` communicates the on/off nature of a link acting as a
        // toggle, which a plain link would not convey.
        aria-pressed={checked}
        {...(systemId ? { "data-system": systemId } : {})}
        className={cx(
          "flex min-h-11 items-center gap-2.5 rounded-sm px-1 text-sm hover:bg-paper-sunken lg:min-h-9",
        )}
      >
        <span
          aria-hidden
          className={cx(
            "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-xs border",
            checked
              ? "border-pine-900 bg-pine-900 text-paper"
              : "border-line-strong bg-paper-raised",
          )}
        >
          {checked && (
            <svg
              viewBox="0 0 12 12"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M2 6.5l2.5 2.5L10 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        {systemId && <SystemIcon systemId={systemId} />}
        <span
          className={cx(
            "min-w-0 flex-1 truncate",
            checked ? "font-medium text-ink-900" : "text-ink-700",
          )}
        >
          {label}
        </span>
        <span className="shrink-0 text-2xs text-ink-300 tabular-nums">{count}</span>
      </Link>
    </li>
  );
}

/**
 * A long group shows its first options and folds the rest away.
 *
 * It used to scroll inside itself, which put a second scrollbar beside the
 * rail's own: the rail is already the scroll container on a desktop, and so is
 * the sheet on a phone. A `<details>` folds the rest instead — no JavaScript,
 * and the expanded state is announced. Options arrive most products first, so
 * the fold keeps the likeliest picks in view.
 */
const FOLD_AFTER = 8;
/** Folding fewer than this away would hide less than the toggle costs. */
const FOLD_MIN_HIDDEN = 3;

function MultiGroup({
  title,
  values,
  selected,
  basePath,
  query,
  filterKey,
}: {
  title: string;
  values: readonly FacetValue[];
  selected: readonly string[];
  basePath: string;
  query: CatalogQuery;
  filterKey: MultiFilterKey;
}) {
  if (values.length === 0) return null;

  const folds = values.length >= FOLD_AFTER + FOLD_MIN_HIDDEN;
  const shown = folds ? values.slice(0, FOLD_AFTER) : values;
  const folded = folds ? values.slice(FOLD_AFTER) : [];
  // A selected option is never out of sight: its fold renders open.
  const foldOpen = folded.some((facet) => selected.includes(facet.value));

  const option = (facet: FacetValue) => (
    <CheckboxLink
      key={facet.value}
      href={hrefFor(basePath, toggleFilterValue(query, filterKey, facet.value))}
      checked={selected.includes(facet.value)}
      label={facet.label}
      count={facet.count}
      {...(filterKey === "system" ? { systemId: facet.value } : {})}
    />
  );

  return (
    <FilterGroup title={title}>
      <ul className="py-1">{shown.map(option)}</ul>
      {folded.length > 0 && (
        // A named group: the panel's own `<details>` is `group` already, and
        // its chevron must not turn when this one opens.
        <details open={foldOpen} className="group/fold">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-sm px-1 text-sm whitespace-nowrap text-pine-700 underline-offset-4 hover:underline lg:min-h-9 [&::-webkit-details-marker]:hidden">
            <span className="group-open/fold:hidden">Покажи още {folded.length}</span>
            <span className="hidden group-open/fold:inline">Покажи по-малко</span>
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 transition-transform group-open/fold:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <ul className="pb-1">{folded.map(option)}</ul>
        </details>
      )}
    </FilterGroup>
  );
}

function SingleGroup({
  title,
  values,
  selected,
  basePath,
  query,
  filterKey,
}: {
  title: string;
  values: readonly FacetValue[];
  selected: "yes" | "no" | null;
  basePath: string;
  query: CatalogQuery;
  filterKey: SingleFilterKey;
}) {
  if (values.length === 0) return null;
  return (
    <FilterGroup title={title}>
      <ul className="py-1">
        {values.map((facet) => (
          <CheckboxLink
            key={facet.value}
            href={hrefFor(basePath, setSingleFilter(query, filterKey, facet.value as "yes" | "no"))}
            checked={selected === facet.value}
            label={facet.label}
            count={facet.count}
          />
        ))}
      </ul>
    </FilterGroup>
  );
}

export function FilterPanel({
  basePath,
  query,
  facets,
  hideBrands = false,
  hideCategories = true,
  showTitle = true,
}: FilterPanelProps) {
  const activeCount = countActiveFilters(query);
  /*
   * Offered only where it can narrow something. A listing that is already one
   * system has one entry here, and a group of one option filters nothing.
   */
  const systems = facets.systems && facets.systems.length > 1 ? facets.systems : [];
  // The caffeine group reads "with" before "without", as people ask for it.
  const caffeine = [...facets.decaf].sort((a, b) => a.value.localeCompare(b.value));

  return (
    <div>
      {(showTitle || activeCount > 0) && (
        <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line pb-2 lg:min-h-9">
          {showTitle ? (
            <h2 className="font-sans text-2xs font-semibold tracking-[0.06em] text-ink-500 uppercase">
              Филтри
            </h2>
          ) : (
            <span />
          )}
          {activeCount > 0 && (
            <Link
              href={hrefFor(basePath, clearFilters(query))}
              className="inline-flex min-h-11 items-center text-xs whitespace-nowrap text-pine-700 underline underline-offset-4 hover:text-pine-900 lg:min-h-9"
            >
              Изчисти всички ({activeCount})
            </Link>
          )}
        </div>
      )}

      <MultiGroup
        title="Система"
        values={systems}
        selected={query.system}
        basePath={basePath}
        query={query}
        filterKey="system"
      />
      {!hideCategories && (
        <MultiGroup
          title="Категория"
          values={facets.categories}
          selected={query.category}
          basePath={basePath}
          query={query}
          filterKey="category"
        />
      )}
      {!hideBrands && (
        <MultiGroup
          title="Марка"
          values={facets.brands}
          selected={query.brand}
          basePath={basePath}
          query={query}
          filterKey="brand"
        />
      )}
      <MultiGroup
        title="Интензивност"
        values={facets.strengths}
        selected={query.strength}
        basePath={basePath}
        query={query}
        filterKey="strength"
      />
      <SingleGroup
        title="Кофеин"
        values={caffeine}
        selected={query.decaf}
        basePath={basePath}
        query={query}
        filterKey="decaf"
      />
      <SingleGroup
        title="Ароматизирано"
        values={facets.aromas}
        selected={query.aromas}
        basePath={basePath}
        query={query}
        filterKey="aromas"
      />
    </div>
  );
}

/**
 * What a chip says. A system, a band and a yes/no answer are named from our
 * own tables, so the chip is right even when the value is absent from the
 * facets (a filter that matches nothing in this listing still has to be shown,
 * or it could not be removed). A brand or category has no such table and
 * falls back to its slug.
 */
function chipLabel(filter: ActiveFilter, facets: CatalogFacets): string {
  const fromFacets = (values: readonly FacetValue[]) =>
    values.find((facet) => facet.value === filter.value)?.label ?? filter.value;

  switch (filter.key) {
    case "system":
      return getBrewingSystem(filter.value)?.name ?? filter.value;
    case "category":
      return fromFacets(facets.categories);
    case "brand":
      return fromFacets(facets.brands);
    case "strength":
      return STRENGTH_LABELS[filter.value] ?? filter.value;
    case "decaf":
      return DECAF_LABELS[filter.value] ?? filter.value;
    case "aromas":
      return AROMAS_LABELS[filter.value] ?? filter.value;
  }
}

/** Removable chips for the active filters. DESIGN.md, "Chips". */
export function ActiveFilterChips({
  basePath,
  query,
  facets,
}: {
  basePath: string;
  query: CatalogQuery;
  facets: CatalogFacets;
}) {
  const filters = listActiveFilters(query);
  if (filters.length === 0) return null;

  return (
    <ul aria-label="Активни филтри" className="mb-4 flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <li key={`${filter.key}-${filter.value}`} className="max-w-full">
          <Link
            href={`${basePath}${filter.removeSearch}`}
            {...(filter.key === "system" ? { "data-system": filter.value } : {})}
            // Removing a filter is not destructive, so the hover is ink, not red.
            className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-sm border border-line-strong bg-paper-raised px-3 text-sm text-ink-700 transition-colors hover:border-ink-900 hover:text-ink-900 lg:min-h-9"
          >
            {filter.key === "system" && <SystemIcon systemId={filter.value} />}
            <span className="truncate">{chipLabel(filter, facets)}</span>
            <span className="sr-only">— премахни филтъра</span>
            <svg
              aria-hidden
              viewBox="0 0 12 12"
              className="h-3 w-3 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
            </svg>
          </Link>
        </li>
      ))}
      <li>
        {/* Always visible, unlike the rail's control, which is desktop-only. */}
        <Link
          href={hrefFor(basePath, clearFilters(query))}
          className="inline-flex min-h-11 items-center px-1 text-sm font-medium whitespace-nowrap text-pine-700 underline underline-offset-4 hover:text-pine-900 lg:min-h-9"
        >
          Изчисти всички
        </Link>
      </li>
    </ul>
  );
}
