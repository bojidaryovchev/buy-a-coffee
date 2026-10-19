/**
 * When each legal document's text last changed, for the sitemap's `lastmod`.
 *
 * A legal page is assembled from `legal.ts` and the commercial terms in
 * `siteConfig.commerce`; nothing in the catalog dates it, and the time the
 * sitemap was generated is not when it changed. A `lastmod` that moves on
 * every fetch teaches Google to ignore the sitemap's dates altogether, for the
 * product pages too.
 *
 * `fingerprint` is the first 16 hex digits of the SHA-256 of the document's
 * title, summary and sections as JSON. `test/legal-revisions.test.ts` recomputes it
 * and fails when the text changed without this date moving, and prints the
 * new value. Change the date to the day of the edit and the fingerprint to
 * what the test prints.
 */
export const LEGAL_REVISIONS: Readonly<
  Record<string, { readonly revisedAt: string; readonly fingerprint: string }>
> = {
  // All three changed with the cart (19 October 2026): what an order request
  // holds, and the cart in the browser's storage.
  privacy: { revisedAt: "2026-10-19", fingerprint: "ca9a0d96596f7ef2" },
  terms: { revisedAt: "2026-10-19", fingerprint: "ca0b44aaf4170a64" },
  cookies: { revisedAt: "2026-10-19", fingerprint: "ea0ac0fbbe69e84e" },
};
