import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/bg";
import { href, routes } from "@/lib/routes";

/*
 * The search field's look, shared with the interactive `SearchField` so the
 * server's version and the hydrated one cannot drift. DESIGN.md, "Inputs" at
 * the `min-h-11` size, with the submit attached to its right edge.
 *
 * The field and its button are one bordered box, so the focus ring belongs to
 * the box: the global ring (2 px pine-700, 2 px offset) is drawn around the
 * whole control while the input has keyboard focus. The input's own outline is
 * switched off only because the box clips it at the rounded corners; the
 * ring on the box is its equal replacement. The button keeps a ring of its
 * own, drawn inside its edge in `gold-300`, the ring colour on pine, so
 * tabbing from the field to the button visibly moves.
 */
export const SEARCH_BOX_CLASS =
  "flex min-h-11 items-stretch overflow-hidden rounded-sm border border-line-strong bg-paper-raised transition-colors hover:border-ink-500 focus-within:border-pine-700 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-pine-700";

export const SEARCH_INPUT_CLASS =
  "min-w-0 flex-1 bg-transparent px-3 text-input text-ink-900 placeholder:text-ink-300 focus-visible:outline-none";

export const SEARCH_BUTTON_CLASS =
  "flex shrink-0 items-center gap-1.5 bg-pine-900 px-4 text-sm font-medium text-paper transition-colors hover:bg-pine-700 focus-visible:-outline-offset-4 focus-visible:outline-gold-300";

/** The field's words, from the frame's dictionary (`search`). */
export type SearchCopy = Dictionary["search"];

/**
 * Static fallback for the search field.
 *
 * Rendered on the server while the interactive field hydrates. It is a real,
 * working `GET` form — not a skeleton — so search is usable immediately and
 * for anyone without JavaScript.
 */
export function SearchFieldFallback({ locale, copy }: { locale: Locale; copy: SearchCopy }) {
  return (
    <form role="search" action={href(locale, routes.search)} method="get" className="w-full">
      <label htmlFor="search-fallback" className="sr-only">
        {copy.label}
      </label>
      <div className={SEARCH_BOX_CLASS}>
        <input
          id="search-fallback"
          name="q"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder={copy.placeholder}
          className={SEARCH_INPUT_CLASS}
          autoComplete="off"
        />
        <SearchSubmit label={copy.submit} />
      </div>
    </form>
  );
}

export function SearchSubmit({ label }: { label: string }) {
  return (
    <button type="submit" className={SEARCH_BUTTON_CLASS}>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M16.5 16.5L21 21" strokeLinecap="round" />
      </svg>
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}
