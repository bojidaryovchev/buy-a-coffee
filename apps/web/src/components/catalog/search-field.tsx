"use client";

import { useRouter, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAnalytics } from "@/components/analytics-provider";
import {
  SEARCH_BOX_CLASS,
  SEARCH_INPUT_CLASS,
  SearchSubmit,
  type SearchCopy,
} from "@/components/catalog/search-field-fallback";
import type { Locale } from "@/i18n/config";
import { fill } from "@/i18n/fill";
import { deferredModule, useDeferredModule } from "@/lib/after-load";
// Not `filters.ts`, which carries zod into every page's header (`filter-query.ts`).
import { MAX_QUERY_LENGTH } from "@/lib/catalog/filter-query";
import type { SearchSuggestions } from "@/lib/catalog/types";
import { href, routes } from "@/lib/routes";

/**
 * Header search with typeahead.
 *
 * The foundation is a real `<form>` with a `GET` action, so search works
 * before hydration and with JavaScript disabled — the browser submits to the
 * locale's search page (`/bg/tarsene?q=...`) on its own. Everything else is an
 * upgrade layered on top of that, and nothing else is required for search to
 * function.
 *
 * In two parts, so that no page downloads the dropdown before it has painted.
 * This one is drawn by the server and hydrated where it stands: the form, the
 * text, the keys, and the live region that announces the list. The typeahead
 * — the requests, the panel, and the logos, photographs and badges in its
 * rows (`search-suggestions.tsx`) — is fetched on the first idle moment after
 * the page has loaded, or the moment the visitor points at or focuses the
 * field, whichever comes first. Until it is here the field is a plain search
 * box that takes text and submits; once it is here the field is a combobox,
 * and names its list in `aria-controls` only while the list is in the page.
 *
 * The query the field shows comes from the address. The search page knows it
 * on the server and hands it in (`initialQuery`), so its field is drawn with
 * it. The header's is not told: a layout does not see the address, so the
 * server draws it empty and it fills in from the address once the page has
 * hydrated (`FollowAddress`).
 *
 * The `<input>` is the same element from the server's HTML to the open
 * dropdown. Nothing replaces it, so nothing typed is lost and the focus — and
 * a phone's keyboard — stay where they are while the typeahead arrives. (It
 * used to be: the field swapped out a server-rendered stand-in when the page
 * hydrated, and anything typed into the stand-in went with it.)
 */

/** Matches the server's floor; below it a term matches half the catalog. */
const MIN_TERM_LENGTH = 2;

const EMPTY: SearchSuggestions = { term: "", products: [], brands: [], categories: [], total: 0 };

/*
 * Its own chunk, fetched after the page. A few modules its rows share with the
 * page — the system icon, the product image — are copied into that chunk
 * rather than shared with the page's, a few hundred bytes the bundler judges
 * cheaper than another request; accepted.
 */
const TYPEAHEAD = deferredModule(() => import("@/components/catalog/search-suggestions"));

/** Ask for the typeahead now: the visitor is reaching for the field. */
const wake = () => {
  TYPEAHEAD.load().catch(() => undefined);
};

export function SearchField({
  locale,
  copy,
  autoFocus = false,
  initialQuery = "",
}: {
  locale: Locale;
  copy: SearchCopy;
  autoFocus?: boolean;
  /**
   * The query the page was asked for, where the server knows it (the search
   * page), so the field is drawn with it. The header has none to give.
   */
  initialQuery?: string;
}) {
  const router = useRouter();
  const searchPath = href(locale, routes.search);
  const inputId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const analytics = useAnalytics();
  const typeahead = useDeferredModule(TYPEAHEAD);
  const links = useMemo(() => typeahead?.suggestionLinks(locale), [typeahead, locale]);

  const [value, setValue] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<SearchSuggestions>(EMPTY);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  /*
   * Whatever was typed before the page hydrated is in the field already:
   * hydration leaves an input's text alone. The state learns it here, before
   * the first re-render could write the empty value back over it, and a field
   * the visitor is already in asks for its typeahead at once.
   */
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const focused = document.activeElement === input;
    if (focused) wake();
    if (input.value === "") return;
    setValue(input.value);
    if (focused) setOpen(true);
  }, []);

  /*
   * Keep the field in step with the URL: the back button, filter chips, a
   * search run from the other field. On arrival the address only fills a
   * field nobody has typed into.
   */
  const followAddress = useCallback((query: string, arriving: boolean) => {
    if (arriving && inputRef.current?.value) return;
    setValue(query);
    setOpen(false);
  }, []);

  const term = value.trim();
  const isSearchable = term.length >= MIN_TERM_LENGTH;

  useEffect(() => {
    if (!typeahead || !open || !isSearchable) return;
    return typeahead.fetchSuggestions(term, setSuggestions);
  }, [typeahead, term, isSearchable, open]);

  const options = useMemo<string[]>(
    () => (typeahead && links ? typeahead.suggestionOptions(suggestions, term, links) : []),
    [typeahead, suggestions, term, links],
  );

  // A changed result set invalidates whatever row was highlighted.
  useEffect(() => setActiveIndex(-1), [options]);

  const isExpanded = open && isSearchable && options.length > 0;
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined;

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const goTo = useCallback(
    (target: string) => {
      close();
      router.push(target);
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
    router.push(href(locale, `${routes.search}?q=${encodeURIComponent(query)}`));
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
      // A pointer on its way to the field, a beat before it takes focus.
      onPointerDown={wake}
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
            role={typeahead ? "combobox" : undefined}
            aria-expanded={typeahead ? isExpanded : undefined}
            // Only while the panel draws the list: an id that names nothing
            // in the page is a broken reference.
            aria-controls={isExpanded ? listboxId : undefined}
            aria-autocomplete={typeahead ? "list" : undefined}
            aria-activedescendant={activeOptionId}
            autoFocus={autoFocus}
            value={value}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(event) => {
              setValue(event.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              wake();
            }}
            onKeyDown={onKeyDown}
            placeholder={copy.placeholder}
            className={SEARCH_INPUT_CLASS}
            autoComplete="off"
          />
          <SearchSubmit label={copy.submit} />
        </div>
      </form>

      {/*
        Announced to screen readers, which cannot see the panel appear. It
        reports how many rows are actually in the list, not how many products
        matched — the two differ, and the list is what the arrow keys traverse.
        Here rather than in the panel: a live region must already be in the
        page when its words change.
      */}
      <p role="status" className="sr-only">
        {isExpanded ? fill(copy.suggestionCount, { count: options.length, term }) : ""}
      </p>

      {typeahead && links && (
        <typeahead.SuggestionPanel
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
      )}

      <Suspense fallback={null}>
        <FollowAddress onChange={followAddress} />
      </Suspense>
    </div>
  );
}

/**
 * Reads the query from the address for the field.
 *
 * A component of its own, drawing nothing, in a Suspense boundary of its own:
 * reading the search parameters opts whatever reads them out of the static
 * render. Here that is this empty component, so the server still draws the
 * field itself, and the field never has to be replaced once it is in the page.
 */
function FollowAddress({ onChange }: { onChange: (query: string, arriving: boolean) => void }) {
  const searchParams = useSearchParams();
  const seen = useRef<ReadonlyURLSearchParams | null>(null);

  useEffect(() => {
    // A second run for the same address (React's development double effects).
    if (seen.current === searchParams) return;
    onChange(searchParams.get("q") ?? "", seen.current === null);
    seen.current = searchParams;
  }, [searchParams, onChange]);

  return null;
}
