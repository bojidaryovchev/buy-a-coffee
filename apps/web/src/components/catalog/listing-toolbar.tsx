"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  SORT_OPTIONS,
  buildSearchParams,
  countActiveFilters,
  type CatalogQuery,
} from "@/lib/catalog/filters";
import type { CatalogFacets } from "@/lib/catalog/types";
import { FilterPanel } from "@/components/catalog/filter-panel";

/**
 * Listing toolbar: result count, the phone's way into the filters, and the
 * sort control. Specified in DESIGN.md, "Listing page".
 *
 * Both controls are written to work before any script runs:
 *
 *  - The filters are a `<details>` disclosure holding the same `FilterPanel`
 *    the desktop rail shows. Once the page has hydrated it is swapped for a
 *    button that opens the panel in a bottom sheet instead — a filter list is
 *    easier to use over the page than pushed into it — but the disclosure is
 *    what the server sends, so the filters open with JavaScript off.
 *  - The sort control is a `<select>` inside a real `GET` form with a submit
 *    button in `<noscript>`.
 */

const FILTER_TRIGGER =
  "inline-flex min-h-10 w-[calc(50%-0.375rem)] cursor-pointer items-center justify-center gap-2 rounded-sm border border-line-strong bg-paper-raised px-4 text-sm font-medium text-ink-900 transition-colors hover:bg-paper-sunken sm:w-auto";

function productsLabel(total: number): string {
  return total === 1 ? "продукт" : "продукта";
}

function FilterTriggerContent({ activeCount }: { activeCount: number }) {
  return (
    <>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="h-4 w-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M2 4h12M4 8h8M6.5 12h3" strokeLinecap="round" />
      </svg>
      Филтри
      {activeCount > 0 && (
        <span className="rounded-xs bg-pine-900 px-1.5 text-2xs text-paper tabular-nums">
          <span className="sr-only">активни: </span>
          {activeCount}
        </span>
      )}
    </>
  );
}

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
  const sheetTitleId = useId();
  /*
   * False on the server and until hydration. The swap happens in an effect so
   * that a visitor who has already opened the disclosure — on a slow
   * connection the page is usable long before it hydrates — keeps it open
   * rather than having it close under their finger.
   */
  const [enhanced, setEnhanced] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const activeCount = countActiveFilters(query);

  useEffect(() => {
    if (!disclosureRef.current?.open) setEnhanced(true);
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    const sheet = sheetRef.current;
    const trigger = triggerRef.current;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const focusable = () =>
      Array.from(
        sheet?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), summary") ?? [],
      );
    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSheetOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      // Keep focus inside the sheet: the page behind it is covered.
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      trigger?.focus();
    };
  }, [sheetOpen]);

  const panelProps = {
    basePath,
    query,
    facets,
    showTitle: false,
    ...(hideBrands !== undefined ? { hideBrands } : {}),
    ...(hideCategories !== undefined ? { hideCategories } : {}),
  };

  const pushSort = (sort: string) =>
    router.push(
      `${basePath}${buildSearchParams(query, { sort: sort as CatalogQuery["sort"], page: 1 })}`,
    );

  return (
    /*
     * Below `lg` this is a two-column grid: the count on the first line, the
     * filters and the sort control sharing the second. The disclosure spans
     * both columns of that second line so its panel can open to the full
     * width, while its summary takes only the left half; the sort form is
     * placed over the right half of the same row.
     */
    <div className="mb-4 grid grid-cols-2 items-start gap-3 lg:flex lg:flex-wrap lg:items-center lg:justify-between">
      <p className="col-span-full text-sm text-ink-500" aria-live="polite">
        <span className="font-medium text-ink-900 tabular-nums">{total}</span>{" "}
        {productsLabel(total)}
      </p>

      {enhanced ? (
        <div className="col-span-full row-start-2 lg:hidden">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-controls={sheetId}
            className={FILTER_TRIGGER}
          >
            <FilterTriggerContent activeCount={activeCount} />
          </button>
        </div>
      ) : (
        <details ref={disclosureRef} className="col-span-full row-start-2 lg:hidden">
          <summary className={`${FILTER_TRIGGER} list-none [&::-webkit-details-marker]:hidden`}>
            <FilterTriggerContent activeCount={activeCount} />
          </summary>
          <div className="mt-3 rounded-md border border-line bg-paper-raised px-4 py-1">
            <FilterPanel {...panelProps} />
          </div>
        </details>
      )}

      <form
        method="get"
        action={basePath}
        className="col-start-2 row-start-2 flex items-center gap-2 sm:justify-self-end"
        onSubmit={(event) => {
          event.preventDefault();
          pushSort(String(new FormData(event.currentTarget).get("sort") ?? "relevance"));
        }}
      >
        {/* Preserve the rest of the query when the form submits natively. */}
        {query.q && <input type="hidden" name="q" value={query.q} />}
        {query.system.length > 0 && (
          <input type="hidden" name="system" value={query.system.join(",")} />
        )}
        {query.brand.length > 0 && (
          <input type="hidden" name="brand" value={query.brand.join(",")} />
        )}
        {query.strength.length > 0 && (
          <input type="hidden" name="strength" value={query.strength.join(",")} />
        )}
        {query.category.length > 0 && (
          <input type="hidden" name="category" value={query.category.join(",")} />
        )}
        {query.decaf && <input type="hidden" name="decaf" value={query.decaf} />}
        {query.aromas && <input type="hidden" name="aromas" value={query.aromas} />}

        <label htmlFor={sortId} className="sr-only text-sm text-ink-500 sm:not-sr-only">
          Подреди:
        </label>
        <select
          id={sortId}
          name="sort"
          defaultValue={query.sort}
          onChange={(event) => pushSort(event.target.value)}
          className="min-h-10 w-full min-w-0 rounded-sm border border-line-strong bg-paper-raised px-3 text-input text-ink-900 hover:border-ink-500 focus:border-pine-700 sm:w-auto"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <noscript>
          <button
            type="submit"
            className="min-h-10 rounded-sm border border-line-strong bg-paper-raised px-3 text-sm font-medium text-ink-900 hover:bg-paper-sunken"
          >
            Приложи
          </button>
        </noscript>
      </form>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/40"
            onClick={() => setSheetOpen(false)}
            aria-hidden
          />
          <div
            ref={sheetRef}
            id={sheetId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={sheetTitleId}
            className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-lg bg-paper px-5 pt-5 shadow-float"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 id={sheetTitleId} className="font-display text-lg font-semibold text-ink-900">
                Филтри
              </h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Затвори филтрите"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-ink-700 hover:bg-paper-sunken hover:text-ink-900"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <FilterPanel {...panelProps} />

            {/* The sheet has no bottom padding of its own: the list must not show under this. */}
            <div className="sticky bottom-0 -mx-5 mt-4 border-t border-line bg-paper px-5 py-4">
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-sm bg-pine-900 px-6 text-base font-medium text-paper transition-colors hover:bg-pine-700"
              >
                Покажи {total} {productsLabel(total)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
