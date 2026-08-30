import type { Metadata, Viewport } from "next";
import { Inter, Literata } from "next/font/google";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { siteConfig, absoluteUrl } from "@/config/site";
import { getCategoryTree } from "@/lib/catalog/queries";
import { organizationJsonLd, webSiteJsonLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/components/seo/json-ld";
import "./globals.css";

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
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    url: absoluteUrl("/"),
    locale: siteConfig.locale.replace("-", "_"),
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  formatDetection: { telephone: true },
};

export const viewport: Viewport = {
  themeColor: "#0f2e26",
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The navigation is catalog-driven, so an added category appears in the menu
  // without a code change.
  const categories = await getCategoryTree();

  return (
    <html lang={siteConfig.locale.split("-")[0] ?? "bg"} className={`${inter.variable} ${literata.variable}`}>
      <body className="flex min-h-dvh flex-col bg-paper text-ink-900 antialiased">
        <JsonLd id="ld-organization" data={organizationJsonLd()} />
        <JsonLd id="ld-website" data={webSiteJsonLd()} />

        <a href="#main" className="skip-link">
          Към основното съдържание
        </a>

        <AnalyticsProvider>
          <SiteHeader categories={categories} />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter categories={categories} />
        </AnalyticsProvider>
      </body>
    </html>
  );
}
