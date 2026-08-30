import { expect } from "@playwright/test";

/**
 * The one place in the test suite that names the source site.
 *
 * Specs import these helpers instead of writing the domain inline. That keeps
 * the originality scanner's allowlist to a single file rather than growing an
 * exception every time a test asserts the domain is absent — and the scanner
 * stays strict, which is the point of it.
 */
export const SOURCE_PATTERNS: readonly RegExp[] = [
  /kafezona/i,
  /КафеЗона/i,
  /airacms/i,
];

/** True when a string refers to the source site in any form. */
export function referencesSource(value: string): boolean {
  return SOURCE_PATTERNS.some((pattern) => pattern.test(value));
}

/** Assert that a blob of text carries no trace of the source site. */
export function expectNoSourceReference(value: string | null | undefined, context: string): void {
  expect(value ?? "", `${context} must not reference the source site`).not.toMatch(
    new RegExp(SOURCE_PATTERNS.map((pattern) => pattern.source).join("|"), "i"),
  );
}

/** Filter a list of URLs down to those that touch the source site. */
export function findSourceUrls(urls: readonly string[]): string[] {
  return urls.filter((url) => referencesSource(url));
}
