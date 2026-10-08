/**
 * The source site's names, as patterns — and nothing else.
 *
 * Split out of `source-guard.ts` so that code which has no business loading
 * Playwright (a Vitest test that scans the database for the source) can share
 * the one list. Together the two files are the only places in the storefront
 * package that name the source; the originality scanner allows exactly these.
 */
export const SOURCE_PATTERNS: readonly RegExp[] = [/kafezona/i, /КафеЗона/i, /airacms/i];

/** True when a string refers to the source site in any form. */
export function referencesSource(value: string): boolean {
  return SOURCE_PATTERNS.some((pattern) => pattern.test(value));
}
