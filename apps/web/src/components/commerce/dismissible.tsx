"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * Lets a visitor close the announcement bar. An enhancement and nothing more.
 *
 * Three decisions, each of them a thing this could easily have got wrong:
 *
 *   - The close button is rendered only once the page has hydrated. Without
 *     JavaScript there would be a button that does nothing, and a control that
 *     does nothing is worse than no control; the bar simply stays.
 *   - The button's slot is in the server-rendered markup at its final size, so
 *     the button appearing moves nothing. The bar never changes height on
 *     load, which is the layout shift a late-arriving banner usually causes.
 *   - The choice is not stored. Remembering it would mean writing to the
 *     visitor's browser, and the cookies page says — truthfully — that browsing
 *     the shop writes nothing there. It is held in memory instead: this
 *     component lives in the site layout, which survives client-side
 *     navigation, so the bar stays closed while the visitor moves around and
 *     returns on the next full page load.
 */

const subscribe = (): (() => void) => () => {};

export function Dismissible({
  children,
  label,
  closeLabel,
  className,
  innerClassName,
}: {
  children: ReactNode;
  /** Names the landmark, since a page may have more than one `aside`. */
  label: string;
  closeLabel: string;
  className?: string;
  innerClassName?: string;
}) {
  // False on the server and during hydration, true afterwards — without an
  // effect and without a hydration mismatch.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);

  // The landmark itself goes, not just its contents: an empty `aside` would
  // leave its border behind and an empty landmark for a screen reader to find.
  if (dismissed) return null;

  return (
    <aside aria-label={label} className={className}>
      <div className={innerClassName}>
        {/* Balances the close slot so the text stays optically centred. */}
        <span aria-hidden className="hidden h-8 w-8 shrink-0 sm:block" />
        <div className="min-w-0 flex-1">{children}</div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center">
          {hydrated && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label={closeLabel}
              className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-pine-900/10"
            >
              <svg
                aria-hidden
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          )}
        </span>
      </div>
    </aside>
  );
}
