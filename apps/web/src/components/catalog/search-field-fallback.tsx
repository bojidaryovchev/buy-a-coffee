/**
 * Static fallback for the search field.
 *
 * Rendered on the server while the interactive field hydrates. It is a real,
 * working `GET` form — not a skeleton — so search is usable immediately and
 * for anyone without JavaScript.
 */
export function SearchFieldFallback() {
  return (
    <form role="search" action="/search" method="get" className="w-full">
      <label htmlFor="search-fallback" className="sr-only">
        Търсене на продукти
      </label>
      <div className="flex h-11 items-stretch overflow-hidden rounded-sm border border-line-strong bg-paper-raised focus-within:border-pine-700">
        <input
          id="search-fallback"
          name="q"
          type="search"
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
  );
}
