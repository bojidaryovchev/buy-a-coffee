import { expect } from "@playwright/test";
import { SOURCE_PATTERNS, referencesSource } from "./source-patterns";

/**
 * Assertions that the source site is absent.
 *
 * Specs import these helpers instead of writing the domain inline. The names
 * themselves live in `source-patterns.ts`, the one file the originality
 * scanner allows to hold them, so the allowlist does not grow an exception
 * every time a test asserts the domain is absent — and the scanner stays
 * strict, which is the point of it.
 */
export { SOURCE_PATTERNS, referencesSource };

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
