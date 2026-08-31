"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MAX_QUERY_LENGTH } from "@/lib/catalog/filters";
import { PLACEHOLDER_IMAGE } from "@/lib/catalog/images";
import type { SearchSuggestions } from "@/lib/catalog/types";
import { useAnalytics } from "@/components/analytics-provider";

/**
 * Header search with typeahead.
 *
 * The foundation is still a real `<form>` with a `GET` action, so search works
 * before hydration and with JavaScript disabled — the browser submits to
 * `/search?q=...` on its own. Everything below is an upgrade layered on top of
 * that, and nothing below is required for search to function.
 *
 * The suggestions come from `/api/search/suggest`, which matches with the same
 * predicate as the results page. A dropdown that offers something the results
 * page cannot then find would be worse than no dropdown at all.
 *
 * Requests are debounced and de-duplicated through a small session cache,
 * because backspacing through a word should not re-ask the database questions
 * it has already answered.
 */

/** Long enough that a fast typist does not fire a request per character. */
const DEBOUNCE_MS = 180;
/** Matches the server's floor; below it a term matches half the catalog. */
const MIN_TERM_LENGTH = 2;
/** Bounded so a long session cannot grow the cache without limit. */
const CACHE_LIMIT = 40;

const EMPTY: SearchSuggestions = { term: "", products: [], brands: [], categories: [], total: 0 };

export function SearchField({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inputId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const analytics = useAnalytics();

  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const [suggestions, setSuggestions] = useState<SearchSuggestions>(EMPTY);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  /*
   * Suggestions already fetched this session, keyed by term. Held in a ref
   * rather than state: reading it must never schedule a render.
   */
  const cache = useRef(new Map<string, SearchSuggestions>());

  // Keep the field in step with the URL (back button, filter chips, etc).
  useEffect(() => {
    setValue(searchParams.get("q") ?? "");
    setOpen(false);
  }, [searchParams]);

  const term = value.trim();
  const isSearchable = term.length >= MIN_TERM_LENGTH;

  /*
   * Fetch on a debounce, and abort the in-flight request when the term moves
   * on. Without the abort, a slow response for "la" can land after a fast one
   * for "lavazza" and replace it with stale rows.
   */
  useEffect(() => {
    if (!open || !isSearchable) return;

    const cached = cache.current.get(term);
    if (cached) {
      setSuggestions(cached);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
            signal: controller.signal,
            headers: { accept: "application/json" },
          });
          if (!response.ok) return;
          const data = (await response.json()) as SearchSuggestions;
          // The server echoes the term back; anything else is a stale reply.
          if (data.term !== term) return;

          if (cache.current.size >= CACHE_LIMIT) {
            cache.current.delete(cache.current.keys().next().value as string);
          }
          cache.current.set(term, data);
          setSuggestions(data);
        } catch {
          // An aborted or failed lookup leaves the form perfectly usable.
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, isSearchable, open]);

  /**
   * The destination of every row the arrow keys can reach, in the order the
   * panel draws them. The panel numbers its rows in the same order, which is
   * what `aria-activedescendant` relies on.
   */
  const options = useMemo<string[]>(() => {
    // Results for a term the visitor has already typed past are not navigable.
    if (suggestions.term !== term) return [];
    const rows = [
      ...suggestions.products.map((product) => `/products/${product.slug}`),
      ...suggestions.brands.map((brand) => `/brands/${brand.slug}`),
      ...suggestions.categories.map((category) => `/categories/${category.slug}`),
    ];
    if (suggestions.total > 0) rows.push(`/search?q=${encodeURIComponent(term)}`);
    return rows;
  }, [suggestions, term]);

  // A changed result set invalidates whatever row was highlighted.
  useEffect(() => setActiveIndex(-1), [options]);

  const isExpanded = open && isSearchable && options.length > 0;
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined;

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const goTo = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = term.slice(0, MAX_QUERY_LENGTH);
    close();
    if (!query) {
      router.push("/search");
      return;
    }
    /*
     * When suggestions for this exact term are already in hand, the real
     * result count is known before the results page renders — better than
     * reporting an unknown count for every search.
     */
    const resultCount = suggestions.term === query ? suggestions.total : -1;
    analytics.track({ name: "search", query, resultCount });
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (!isExpanded) {
      // Arrow-down on a closed field is a request to see the suggestions.
      if (event.key === "ArrowDown" && isSearchable) setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? options.length - 1 : index - 1));
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      // Enter on a highlighted row opens it instead of running the search.
      event.preventDefault();
      goTo(options[activeIndex]!);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      onBlur={(event) => {
        // Closing on blur must not fire when focus moves inside the dropdown.
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <form role="search" action="/search" method="get" onSubmit={submit} className="w-full">
        <label htmlFor={inputId} className="sr-only">
          Търсене на продукти
        </label>
        <div className="flex h-11 items-stretch overflow-hidden rounded-sm border border-line-strong bg-paper-raised focus-within:border-pine-700">
          <input
            ref={inputRef}
            id={inputId}
            name="q"
            type="search"
            role="combobox"
            aria-expanded={isExpanded}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            autoFocus={autoFocus}
            value={value}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(event) => {
              setValue(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Търсете кафе, марки, капсули…"
            className="min-w-0 flex-1 bg-transparent px-3.5 text-base outline-none placeholder:text-ink-300"
            autoComplete="off"
          />
          <button
            type="submit"
            className="flex shrink-0 items-center gap-1.5 bg-pine-900 px-4 text-sm font-medium text-paper hover:bg-pine-700"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M16.5 16.5L21 21" strokeLinecap="round" />
            </svg>
            <span className="sr-only sm:not-sr-only">Търси</span>
          </button>
        </div>
      </form>

      <SuggestionPanel
        id={listboxId}
        expanded={isExpanded}
        suggestions={suggestions}
        term={term}
        activeIndex={activeIndex}
        onHover={setActiveIndex}
        onSelect={goTo}
      />
    </div>
  );
}

/**
 * The dropdown.
 *
 * `role="option"` is put directly on the anchors rather than on wrapping list
 * items. That trades the link role away in the accessibility tree for two
 * things worth more here: the option's accessible name comes from its own
 * contents, and every row keeps a real `href`, so a product can still be
 * middle-clicked or opened in a new tab. Focus stays on the input throughout;
 * `aria-activedescendant` is what moves.
 */
function SuggestionPanel({
  id,
  expanded,
  suggestions,
  term,
  activeIndex,
  onHover,
  onSelect,
}: {
  id: string;
  expanded: boolean;
  suggestions: SearchSuggestions;
  term: string;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (href: string) => void;
}) {
  let index = -1;
  const next = () => (index += 1);

  const rowCount =
    suggestions.products.length +
    suggestions.brands.length +
    suggestions.categories.length +
    (suggestions.total > 0 ? 1 : 0);

  return (
    <>
      {/*
        Announced to screen readers, which cannot see the panel appear. It
        reports how many rows are actually in the list, not how many products
        matched — the two differ, and the list is what the arrow keys traverse.
      */}
      <p role="status" className="sr-only">
        {expanded ? `${rowCount} предложения за „${term}“` : ""}
      </p>

      {expanded && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-[70vh] overflow-y-auto overscroll-contain rounded-md border border-line bg-paper-raised py-1.5 shadow-float">
          <ul id={id} role="listbox" aria-label="Предложения при търсене">
            {suggestions.products.map((product) => (
              <SuggestionRow
                key={product.slug}
                id={id}
                index={next()}
                activeIndex={activeIndex}
                href={`/products/${product.slug}`}
                onHover={onHover}
                onSelect={onSelect}
              >
                <span className="relative h-12 w-10 shrink-0 overflow-hidden rounded-xs bg-paper-sunken">
                  <Image
                    src={product.image?.url ?? PLACEHOLDER_IMAGE}
                    alt=""
                    fill
                    sizes="40px"
                    className="object-contain p-0.5"
                  />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink-900">{product.name}</span>
                  <span className="block truncate text-2xs tracking-wide text-ink-500 uppercase">
                    {[product.brandName, product.weight].filter(Boolean).join(" · ")}
                  </span>
                </span>

                {product.price && (
                  <span className="shrink-0 text-sm font-semibold text-ink-900">
                    {product.price.formatted}
                  </span>
                )}
              </SuggestionRow>
            ))}

            {suggestions.brands.length > 0 && <GroupLabel>Марки</GroupLabel>}
            {suggestions.brands.map((brand) => (
              <SuggestionRow
                key={brand.slug}
                id={id}
                index={next()}
                activeIndex={activeIndex}
                href={`/brands/${brand.slug}`}
                onHover={onHover}
                onSelect={onSelect}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{brand.name}</span>
                <span className="shrink-0 text-2xs text-ink-300">{brand.productCount}</span>
              </SuggestionRow>
            ))}

            {suggestions.categories.length > 0 && <GroupLabel>Категории</GroupLabel>}
            {suggestions.categories.map((category) => (
              <SuggestionRow
                key={category.slug}
                id={id}
                index={next()}
                activeIndex={activeIndex}
                href={`/categories/${category.slug}`}
                onHover={onHover}
                onSelect={onSelect}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{category.name}</span>
                <span className="shrink-0 text-2xs text-ink-300">{category.productCount}</span>
              </SuggestionRow>
            ))}

            {suggestions.total > 0 && (
              <SuggestionRow
                id={id}
                index={next()}
                activeIndex={activeIndex}
                href={`/search?q=${encodeURIComponent(term)}`}
                onHover={onHover}
                onSelect={onSelect}
              >
                <span className="flex-1 text-sm font-medium text-pine-700">
                  Виж всички {suggestions.total}{" "}
                  {suggestions.total === 1 ? "резултат" : "резултата"}
                </span>
                <span aria-hidden className="text-pine-700">
                  →
                </span>
              </SuggestionRow>
            )}
          </ul>
        </div>
      )}
    </>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <li
      role="presentation"
      className="mt-1 border-t border-line px-3 pt-2 pb-1 text-2xs tracking-wide text-ink-500 uppercase"
    >
      {children}
    </li>
  );
}

function SuggestionRow({
  id,
  index,
  activeIndex,
  href,
  onHover,
  onSelect,
  children,
}: {
  id: string;
  index: number;
  activeIndex: number;
  href: string;
  onHover: (index: number) => void;
  onSelect: (href: string) => void;
  children: React.ReactNode;
}) {
  const isActive = index === activeIndex;
  return (
    <li role="presentation">
      <a
        id={`${id}-${index}`}
        role="option"
        aria-selected={isActive}
        href={href}
        tabIndex={-1}
        onMouseEnter={() => onHover(index)}
        /*
         * `mousedown` blurs the input before `click` would land, which would
         * close the panel out from under the pointer. Suppressing that keeps
         * the click on the row it was aimed at.
         */
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          // Let the browser handle modified clicks — new tab, new window.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onSelect(href);
        }}
        className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
          isActive ? "bg-pine-100" : "hover:bg-paper-sunken"
        }`}
      >
        {children}
      </a>
    </li>
  );
}
