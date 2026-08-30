import Link from "next/link";
import {
  buildSearchParams,
  clearFilters,
  countActiveFilters,
  setSingleFilter,
  toggleFilterValue,
  type CatalogQuery,
} from "@/lib/catalog/filters";
import type { CatalogFacets, FacetValue } from "@/lib/catalog/types";
import { cx } from "@/components/ui/primitives";

/**
 * Catalog filters.
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
  readonly hideCategories?: boolean;
  readonly idPrefix?: string;
}

function hrefFor(basePath: string, query: CatalogQuery): string {
  return `${basePath}${buildSearchParams(query)}`;
}

function FilterGroup({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="border-b border-line py-4 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-ink-900">
        {title}
        <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 text-ink-500 transition-transform [details[open]_&]:rotate-180" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function CheckboxLink({
  href,
  checked,
  label,
  count,
}: {
  href: string;
  checked: boolean;
  label: string;
  count: number;
}) {
  return (
    <li>
      <Link
        href={href}
        // `aria-pressed` communicates the on/off nature of a link acting as a
        // toggle, which a plain link would not convey.
        aria-pressed={checked}
        className="flex items-center gap-2.5 rounded-sm px-1 py-1.5 text-sm hover:bg-paper-sunken"
      >
        <span
          aria-hidden
          className={cx(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border",
            checked ? "border-pine-900 bg-pine-900 text-paper" : "border-line-strong bg-paper-raised",
          )}
        >
          {checked && (
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M2 6.5l2.5 2.5L10 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className={cx("min-w-0 flex-1 truncate", checked ? "font-medium text-ink-900" : "text-ink-700")}>
          {label}
        </span>
        <span className="shrink-0 text-2xs text-ink-300">{count}</span>
      </Link>
    </li>
  );
}

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
  filterKey: "brand" | "strength" | "category";
}) {
  if (values.length === 0) return null;
  return (
    <FilterGroup title={title}>
      <ul className="max-h-64 space-y-0.5 overflow-y-auto">
        {values.map((facet) => (
          <CheckboxLink
            key={facet.value}
            href={hrefFor(basePath, toggleFilterValue(query, filterKey, facet.value))}
            checked={selected.includes(facet.value)}
            label={facet.label}
            count={facet.count}
          />
        ))}
      </ul>
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
  filterKey: "decaf" | "aromas";
}) {
  if (values.length === 0) return null;
  return (
    <FilterGroup title={title}>
      <ul className="space-y-0.5">
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
  hideCategories = false,
}: FilterPanelProps) {
  const activeCount = countActiveFilters(query);

  return (
    <div>
      <div className="flex items-center justify-between border-b border-line pb-3">
        <h2 className="font-display text-sm font-semibold tracking-wide uppercase">Филтри</h2>
        {activeCount > 0 && (
          <Link
            href={hrefFor(basePath, clearFilters(query))}
            className="text-xs text-pine-700 underline-offset-4 hover:underline"
          >
            Изчисти всички ({activeCount})
          </Link>
        )}
      </div>

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
        values={facets.decaf}
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

/** Removable chips summarising the active filters. */
export function ActiveFilterChips({
  basePath,
  query,
  facets,
}: {
  basePath: string;
  query: CatalogQuery;
  facets: CatalogFacets;
}) {
  const labelFor = (values: readonly FacetValue[], value: string) =>
    values.find((facet) => facet.value === value)?.label ?? value;

  const chips: Array<{ key: string; label: string; href: string }> = [
    ...query.category.map((value) => ({
      key: `category-${value}`,
      label: labelFor(facets.categories, value),
      href: hrefFor(basePath, toggleFilterValue(query, "category", value)),
    })),
    ...query.brand.map((value) => ({
      key: `brand-${value}`,
      label: labelFor(facets.brands, value),
      href: hrefFor(basePath, toggleFilterValue(query, "brand", value)),
    })),
    ...query.strength.map((value) => ({
      key: `strength-${value}`,
      label: labelFor(facets.strengths, value),
      href: hrefFor(basePath, toggleFilterValue(query, "strength", value)),
    })),
  ];

  if (query.decaf) {
    chips.push({
      key: "decaf",
      label: labelFor(facets.decaf, query.decaf),
      href: hrefFor(basePath, setSingleFilter(query, "decaf", query.decaf)),
    });
  }
  if (query.aromas) {
    chips.push({
      key: "aromas",
      label: labelFor(facets.aromas, query.aromas),
      href: hrefFor(basePath, setSingleFilter(query, "aromas", query.aromas)),
    });
  }

  if (chips.length === 0) return null;

  return (
    <ul aria-label="Активни филтри" className="mb-4 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <li key={chip.key}>
          <Link
            href={chip.href}
            className="inline-flex items-center gap-1.5 rounded-xs border border-line-strong bg-paper-raised py-1 pr-1.5 pl-2.5 text-xs text-ink-700 hover:border-critical hover:text-critical"
          >
            {chip.label}
            <span className="sr-only">— премахни филтъра</span>
            <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
            </svg>
          </Link>
        </li>
      ))}
      {chips.length > 0 && (
        <li>
          {/* Always visible, unlike the sidebar's control, which is desktop-only. */}
          <Link
            href={hrefFor(basePath, clearFilters(query))}
            className="inline-flex items-center rounded-xs px-2 py-1 text-xs font-medium text-pine-700 underline underline-offset-4 hover:text-pine-900"
          >
            Изчисти всички
          </Link>
        </li>
      )}
    </ul>
  );
}
