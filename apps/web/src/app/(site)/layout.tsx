import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { siteConfig, absoluteUrl } from "@/config/site";
import { getCategoryTree } from "@/lib/catalog/queries";
import { organizationJsonLd, webSiteJsonLd } from "@/lib/seo/json-ld";
import { SHARE_CARD } from "@/lib/seo/share-card";
import { JsonLd } from "@/components/seo/json-ld";

/**
 * The shop.
 *
 * Everything here was the root layout until the admin needed a shell of its
 * own. A route group leaves the URLs untouched — `(site)/products/[slug]` is
 * still `/products/[slug]` — so this is a move, not a redesign.
 *
 * Why it had to move rather than the admin nesting inside it: `getCategoryTree`
 * below is a database query on every render, and the header, footer, JSON-LD
 * and analytics provider are all descriptions of a storefront. An admin page
 * inheriting them would pay for a category tree it does not draw, and would
 * announce itself to analytics and to structured-data parsers as part of the
 * shop.
 *
 * The canonical and the indexable `robots` also live here rather than at the
 * root, so the admin cannot inherit either. A panel that declares itself
 * indexable is one link away from being in the index.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    url: absoluteUrl("/"),
    locale: siteConfig.locale.replace("-", "_"),
    /* Explicit, because setting `openGraph` at all drops the image inherited
       from `app/opengraph-image.tsx`. See the note in `lib/seo/share-card.ts`;
       without this line every page on the shop shares as a grey box. */
    images: [{ url: absoluteUrl(SHARE_CARD) }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    /* X reads `og:image` when there is no `twitter:image`, but the card type
       above promises a full-width image and it is cheaper to be explicit than
       to rely on that fallback holding. */
    images: [{ url: absoluteUrl(SHARE_CARD) }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // The navigation is catalog-driven, so an added category appears in the menu
  // without a code change.
  const categories = await getCategoryTree();

  return (
    <>
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
    </>
  );
}
