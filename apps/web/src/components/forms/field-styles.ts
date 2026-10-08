/**
 * Field treatment for the storefront forms, from DESIGN.md "Inputs".
 *
 * One place, so the three forms cannot drift apart again. Everything a field
 * needs is a class here: 16 px text (`text-input`) so a phone does not zoom on
 * focus, a minimum height instead of a fixed one, a hover border, and NO
 * `outline-none` — the global focus ring does the work, and the border colour
 * change on focus is an addition to it, not a substitute.
 */

export const LABEL_CLASS = "mb-1 block text-sm font-medium text-ink-900";

const FIELD_BASE =
  "w-full rounded-sm border border-line-strong bg-paper-raised px-3 text-input text-ink-900 placeholder:text-ink-300 hover:border-ink-500 focus:border-pine-700 aria-[invalid]:border-critical disabled:bg-paper-sunken disabled:text-ink-500";

/** The default field: 48 px tall. */
export const INPUT_CLASS = `min-h-12 ${FIELD_BASE}`;

/** A secondary field inside a disclosure: 44 px tall. */
export const INPUT_COMPACT_CLASS = `min-h-11 ${FIELD_BASE}`;

export const TEXTAREA_CLASS = `${FIELD_BASE} py-2`;

export const HELPER_CLASS = "mt-1 text-xs text-ink-500";

/** Beneath its field, tied to it with `aria-describedby`. */
export const ERROR_CLASS = "mt-1 text-sm text-critical";
