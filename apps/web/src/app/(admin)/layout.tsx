import type { Metadata, Viewport } from "next";
import { siteConfig } from "@/config/site";
import { BODY_CLASS, fontVariables } from "../fonts";
import "../globals.css";

/**
 * The admin tree's root layout.
 *
 * A root of its own since the shop's root moved under `[lang]` so that
 * `<html lang>` can follow the locale: there is no `app/layout.tsx` above both
 * any more. This one brings what that file used to — `<html>`, `<body>`, the
 * faces and the stylesheet — and keeps the one thing the panel must not
 * inherit from the shop, its chrome and its indexable `robots`.
 *
 * No measurement scripts: nothing under `/admin` is measured (see
 * `components/measurement.tsx`), and here that is now true by construction.
 *
 * Belt and braces on indexing, and deliberately so. `robots.txt` disallows
 * `/admin`, but `robots.txt` is a crawl instruction, not an indexing one: a URL
 * linked from anywhere can still be indexed without ever being fetched.
 * `noindex` is the directive that actually keeps it out.
 *
 * The panel is Bulgarian, like the shop's operator, and stays at `/admin`
 * without a locale prefix. There is nothing to translate and nobody to
 * translate it for.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: "Администрация", template: "%s — Администрация" },
  applicationName: siteConfig.name,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#002c1d",
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg" className={fontVariables}>
      <body className={BODY_CLASS}>{children}</body>
    </html>
  );
}
