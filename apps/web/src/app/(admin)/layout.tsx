import type { Metadata } from "next";

/**
 * The admin tree.
 *
 * A group layout, not a root one: `app/layout.tsx` above it already provides
 * `<html>`, `<body>` and the fonts, and a second root would mean a second
 * `<html>` on every page. What this adds is the one thing the panel must not
 * inherit from `(site)` — the storefront chrome and the indexable `robots`.
 *
 * Belt and braces on indexing, and deliberately so. `robots.txt` disallows
 * `/admin`, but `robots.txt` is a crawl instruction, not an indexing one: a URL
 * linked from anywhere can still be indexed without ever being fetched.
 * `noindex` is the directive that actually keeps it out.
 *
 * The panel is Bulgarian, like the shop. There is nothing to translate and
 * nobody to translate it for.
 */
export const metadata: Metadata = {
  title: { default: "Администрация", template: "%s — Администрация" },
  robots: { index: false, follow: false },
};

export default function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
