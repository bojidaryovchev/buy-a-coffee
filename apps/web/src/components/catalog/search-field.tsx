"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MAX_QUERY_LENGTH } from "@/lib/catalog/filters";
import { BrandLogo } from "@/components/catalog/brand-logo";
import { ImagePlaceholder } from "@/components/catalog/image-placeholder";
import { ProductImage } from "@/components/catalog/product-image";
import {
  SEARCH_BOX_CLASS,
  SEARCH_INPUT_CLASS,
  SearchSubmit,
  type SearchCopy,
} from "@/components/catalog/search-field-fallback";
import { SystemBadge } from "@/components/catalog/system-badge";
import type { SearchSuggestions } from "@/lib/catalog/types";
import { useAnalytics } from "@/components/analytics-provider";
import type { Locale } from "@/i18n/config";
import { fill, plural } from "@/i18n/fill";
import { categoryHref, href, productHref, routes } from "@/lib/routes";

/**
 * Header search with typeahead.
 *
 * The foundation is still a real `<form>` with a `GET` action, so search works
 * before hydration and with JavaScript disabled — the browser submits to the
 * locale's search page (`/bg/tarsene?q=...`) on its own. Everything below is an upgrade layered on top of
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

/**
 * What the visitor typed into the server-rendered field before this one
 * replaced it, and whether it had focus.
 *
 * The header renders `SearchFieldFallback` (a real GET form) while this
 * component waits for the URL, then swaps it out. On a slow phone that window
 * is long enough to type in, and without this the swap threw the text away
 * and dropped focus mid-word. Read during the first render, while the fallback
 * is still in the document; null on the server and wherever there was none.
 */
export function typedBeforeHydration(): {
  readonly value: string;
  readonly focused: boolean;
} | null {
  if (typeof document === "undefined") return null;
  const fallback = document.getElementById("search-fallback");
  if (!(fallback instanceof HTMLInputElement)) return null;
  return { value: fallback.value, focused: document.activeElement === fallback };
}

/** Where each kind of row leads, in the locale the field is drawn in. */
function suggestionLinks(locale: Locale) {
  return {
    product: (slug: string) => productHref(locale, { slug }),
    brand: (slug: string) => href(locale, routes.brand(slug)),
    category: (category: SearchSuggestions["categories"][number]) => categoryHref(locale, category),
    results: (term: string) => href(locale, `${routes.search}?q=${encodeURIComponent(term)}`),
  };
}

export function SearchField({
  locale,
  copy,
  autoFocus = false,
}: {
  locale: Locale;
  copy: SearchCopy;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const links = useMemo(() => suggestionLinks(locale), [locale]);
  const searchPath = href(locale, routes.search);
  const searchParams = useSearchParams();
  const inputId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const analytics = useAnalytics();

  const [carried] = useState(typedBeforeHydration);
  const [value, setValue] = useState(() => carried?.value || searchParams.get("q") || "");

  useEffect(() => {
    if (!carried?.focused) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // Once, on mount: this only hands over what the fallback had.
  }, [carried]);
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
      ...suggestions.products.map((product) => links.product(product.slug)),
      ...suggestions.brands.map((brand) => links.brand(brand.slug)),
      ...suggestions.categories.map((category) => links.category(category)),
    ];
    if (suggestions.total > 0) rows.push(links.results(term));
    return rows;
  }, [suggestions, term, links]);

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
      router.push(searchPath);
      return;
    }
    /*
     * When suggestions for this exact term are already in hand, the real
     * result count is known before the results page renders — better than
     * reporting an unknown count for every search.
     */
    const resultCount = suggestions.term === query ? suggestions.total : -1;
    analytics.track({ name: "search", query, resultCount });
    router.push(links.results(query));
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
      <form role="search" action={searchPath} method="get" onSubmit={submit} className="w-full">
        <label htmlFor={inputId} className="sr-only">
          {copy.label}
        </label>
        <div className={SEARCH_BOX_CLASS}>
          <input
            ref={inputRef}
            id={inputId}
            name="q"
            type="search"
            inputMode="search"
            enterKeyHint="search"
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
            placeholder={copy.placeholder}
            className={SEARCH_INPUT_CLASS}
            autoComplete="off"
          />
          <SearchSubmit label={copy.submit} />
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
        links={links}
        copy={copy}
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
  links,
  copy,
}: {
  id: string;
  expanded: boolean;
  suggestions: SearchSuggestions;
  term: string;
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (href: string) => void;
  links: ReturnType<typeof suggestionLinks>;
  copy: SearchCopy;
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
        {expanded ? fill(copy.suggestionCount, { count: rowCount, term }) : ""}
      </p>

      {expanded && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-[70vh] overflow-y-auto overscroll-contain rounded-md border border-line bg-paper-raised py-1.5 shadow-float">
          <ul id={id} role="listbox" aria-label={copy.suggestions}>
            {suggestions.products.map((product) => (
              <SuggestionRow
                key={product.slug}
                id={id}
                index={next()}
                activeIndex={activeIndex}
                href={links.product(product.slug)}
                onHover={onHover}
                onSelect={onSelect}
              >
                <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-sm bg-well">
                  {product.image ? (
                    <ProductImage
                      src={product.image.url}
                      alt=""
                      fill
                      sizes="40px"
                      placeholderLabel={false}
                      className="object-contain"
                    />
                  ) : (
                    <ImagePlaceholder label={false} />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink-900">{product.name}</span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <SystemBadge systemId={product.systemId} size="sm" />
                    <span className="truncate text-2xs tracking-wide text-ink-500 uppercase">
                      {[product.brandName, product.weight].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </span>

                {product.price && (
                  <span className="shrink-0 text-sm font-semibold text-ink-900 tabular-nums">
                    {product.price.formatted}
                  </span>
                )}
              </SuggestionRow>
            ))}

            {suggestions.brands.length > 0 && <GroupLabel>{copy.brands}</GroupLabel>}
            {suggestions.brands.map((brand) => (
              <SuggestionRow
                key={brand.slug}
                id={id}
                index={next()}
                activeIndex={activeIndex}
                href={links.brand(brand.slug)}
                onHover={onHover}
                onSelect={onSelect}
              >
                {/* Decorative: the name follows in text. A brand with no logo
                    keeps the empty box, so the names line up. */}
                <BrandLogo brand={brand} size="suggestion" decorative fallback="blank" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{brand.name}</span>
                <span className="shrink-0 text-2xs text-ink-300">{brand.productCount}</span>
              </SuggestionRow>
            ))}

            {suggestions.categories.length > 0 && <GroupLabel>{copy.categories}</GroupLabel>}
            {suggestions.categories.map((category) => (
              <SuggestionRow
                key={category.slug}
                id={id}
                index={next()}
                activeIndex={activeIndex}
                href={links.category(category)}
                onHover={onHover}
                onSelect={onSelect}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink-900">
                  {category.name}
                </span>
                <span className="shrink-0 text-2xs text-ink-300">{category.productCount}</span>
              </SuggestionRow>
            ))}

            {suggestions.total > 0 && (
              <SuggestionRow
                id={id}
                index={next()}
                activeIndex={activeIndex}
                href={links.results(term)}
                onHover={onHover}
                onSelect={onSelect}
              >
                <span className="flex-1 text-sm font-medium text-pine-700">
                  {fill(plural(copy.seeAll, suggestions.total), { count: suggestions.total })}
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
