import type { Metadata, Viewport } from "next";
import { Inter, Literata } from "next/font/google";
import { siteConfig } from "@/config/site";
import "./globals.css";

/**
 * The root layout, and deliberately almost empty.
 *
 * It used to carry the header, the footer, the analytics provider and the
 * organisation JSON-LD. Those moved down to `(site)/layout.tsx` when the admin
 * arrived, because none of them belong on it: the header does a database query
 * for the category tree, the JSON-LD describes a shop, and the analytics
 * provider has nothing to learn from one person reading his own mail.
 *
 * What is left is what genuinely is shared — `<html>`, `<body>`, the two faces,
 * and the stylesheet. `next/font` must be called at module scope, so this is
 * also the only place the fonts can be defined once for both trees.
 *
 * The route groups below it do not appear in any URL:
 *
 *   (site)/   the shop. Header, footer, analytics, indexable.
 *   (admin)/  the panel. No chrome, noindex, password-gated.
 *
 * `not-found.tsx` stays here rather than in `(site)`: the global not-found is
 * rendered for unmatched URLs, which by definition are in neither group.
 */

/**
 * Both faces are loaded with the Cyrillic subset. That is not optional: the
 * catalog is Bulgarian, and a Latin-only face would render every product name
 * in a fallback font.
 */
const inter = Inter({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

const literata = Literata({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-literata",
  weight: ["400", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  formatDetection: { telephone: true },
};

export const viewport: Viewport = {
  themeColor: "#0f2e26",
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang={siteConfig.locale.split("-")[0] ?? "bg"}
      className={`${inter.variable} ${literata.variable}`}
    >
      <body className="flex min-h-dvh flex-col bg-paper text-ink-900 antialiased">{children}</body>
    </html>
  );
}
