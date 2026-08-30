"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { SORT_OPTIONS, buildSearchParams, countActiveFilters, type CatalogQuery } from "@/lib/catalog/filters";
import type { CatalogFacets } from "@/lib/catalog/types";
import { FilterPanel } from "@/components/catalog/filter-panel";

/**
 * Listing toolbar: result count, sort control, and the mobile filter sheet.
 *
 * The sort control is a `<select>` inside a real `<form>` with a submit button
 * that is hidden only when JavaScript is available, so choosing a sort order
 * still works without it.
 *
 * On small screens the filters open in a bottom sheet rather than the desktop
 * sidebar squeezed narrow — a filter list is unusable at 320px wide.
 */
export function ListingToolbar({
  basePath,
  query,
  facets,
  total,
  hideBrands,
  hideCategories,
}: {
  basePath: string;
  query: CatalogQuery;
  facets: CatalogFacets;
  total: number;
  hideBrands?: boolean;
  hideCategories?: boolean;
}) {
  const router = useRouter();
  const sortId = useId();
  const sheetId = useId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const activeCount = countActiveFilters(query);

  useEffect(() => {
    if (!sheetOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    sheetRef.current?.querySelector<HTMLElement>("button, a")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [sheetOpen]);

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-500" aria-live="polite">
        <span className="font-medium text-ink-900">{total}</span> {total === 1 ? "продукт" : "продукта"}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-expanded={sheetOpen}
          aria-controls={sheetId}
          className="inline-flex h-10 items-center gap-2 rounded-sm border border-line-strong px-3 text-sm lg:hidden"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M2 4h12M4 8h8M6.5 12h3" strokeLinecap="round" />
          </svg>
          Филтри
          {activeCount > 0 && (
            <span className="rounded-xs bg-pine-900 px-1.5 text-2xs text-paper">{activeCount}</span>
          )}
        </button>

        <form
          method="get"
          action={basePath}
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const sort = String(form.get("sort") ?? "relevance");
            router.push(`${basePath}${buildSearchParams(query, { sort: sort as CatalogQuery["sort"], page: 1 })}`);
          }}
        >
          {/* Preserve the rest of the query when the form submits natively. */}
          {query.q && <input type="hidden" name="q" value={query.q} />}
          {query.brand.length > 0 && <input type="hidden" name="brand" value={query.brand.join(",")} />}
          {query.strength.length > 0 && <input type="hidden" name="strength" value={query.strength.join(",")} />}
          {query.category.length > 0 && <input type="hidden" name="category" value={query.category.join(",")} />}
          {query.decaf && <input type="hidden" name="decaf" value={query.decaf} />}
          {query.aromas && <input type="hidden" name="aromas" value={query.aromas} />}

          <label htmlFor={sortId} className="sr-only">
            Подреди продуктите
          </label>
          <select
            id={sortId}
            name="sort"
            defaultValue={query.sort}
            onChange={(event) =>
              router.push(
                `${basePath}${buildSearchParams(query, { sort: event.target.value as CatalogQuery["sort"], page: 1 })}`,
              )
            }
            className="h-10 rounded-sm border border-line-strong bg-paper-raised px-3 text-sm"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <noscript>
            <button type="submit" className="h-10 rounded-sm border border-line-strong px-3 text-sm">
              Приложи
            </button>
          </noscript>
        </form>
      </div>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setSheetOpen(false)} aria-hidden />
          <div
            ref={sheetRef}
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-label="Филтри"
            className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-lg bg-paper p-5 shadow-float"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Филтри</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Затвори филтрите"
                className="inline-flex h-10 w-10 items-center justify-center rounded-sm hover:bg-paper-sunken"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <FilterPanel
              basePath={basePath}
              query={query}
              facets={facets}
              {...(hideBrands !== undefined ? { hideBrands } : {})}
              {...(hideCategories !== undefined ? { hideCategories } : {})}
            />

            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="mt-5 h-12 w-full rounded-sm bg-pine-900 text-base font-medium text-paper"
            >
              Покажи {total} {total === 1 ? "продукт" : "продукта"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
