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
 *
 * The children are the bar's own row and are laid out by `innerClassName`; the
 * slot is the last thing in that row. On a phone, where the row is one centred
 * sentence, an empty slot of the same width goes in front of it so the
 * sentence stays in the middle of the screen. Both slots reach a little into
 * the row's padding, which keeps the sentence on one line at 390 px.
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
  // leave its band behind and an empty landmark for a screen reader to find.
  if (dismissed) return null;

  return (
    <aside aria-label={label} className={className}>
      <div className={innerClassName}>
        <span aria-hidden className="-mr-4 -ml-2 h-6 w-6 shrink-0 md:hidden" />
        {children}
        <span className="-mr-2 -ml-4 flex h-6 w-6 shrink-0 items-center justify-center md:-mr-1.5 md:-ml-3">
          {hydrated && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label={closeLabel}
              className="flex h-6 w-6 items-center justify-center rounded-sm text-pine-200 transition-colors hover:bg-pine-700 hover:text-paper"
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
