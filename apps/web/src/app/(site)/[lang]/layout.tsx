import type { Metadata, Viewport } from "next";
import { SiteFrame, loadNavigation } from "@/components/layout/site-frame";
import { Measurement } from "@/components/measurement";
import { siteConfig, absoluteUrl } from "@/config/site";
import { organizationJsonLd, webSiteJsonLd } from "@/lib/seo/json-ld";
import { SHARE_CARD } from "@/lib/seo/share-card";
import { JsonLd } from "@/components/seo/json-ld";
import { HTML_LANG, OG_LOCALE, SHIPPING_LOCALES } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { localeFrom, type LangParams } from "@/i18n/params";
import { href, routes } from "@/lib/routes";
import { BODY_CLASS, fontVariables } from "../../fonts";
import "../../globals.css";

/**
 * The shop's root layout, one per locale.
 *
 * A root layout, not a group layout under `app/layout.tsx`, because
 * `<html lang>` has to follow the locale and a layout cannot read a dynamic
 * segment below itself. So this is where the document starts: `<html>`,
 * `<body>`, the faces, the stylesheet and the measurement scripts, which used
 * to live in `app/layout.tsx`, now live here and in `(admin)/layout.tsx`.
 *
 * Everything else here was already the shop's: the frame (`SiteFrame` — header,
 * footer, analytics provider, shared with the global 404) and the organisation
 * JSON-LD, none of which belongs on the admin. `loadNavigation` is a database
 * query on every render, and the panel must not pay for a category tree it
 * does not draw.
 *
 * A locale that is declared but switched off (`LOCALE_READY`) 404s here, and
 * so does any first segment that is not a locale at all. Only the shipping
 * locales are prerendered.
 *
 * The indexable `robots` lives here rather than above, so the admin cannot
 * inherit it. Canonical and `hreflang` do not: Next shallow-merges
 * `alternates`, so every page declares both together (`lib/seo/alternates.ts`).
 */
export function generateStaticParams(): LangParams[] {
  return SHIPPING_LOCALES.map((lang) => ({ lang }));
}

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<LangParams>;
}

export async function generateMetadata({
  params,
}: Omit<LayoutProps, "children">): Promise<Metadata> {
  const locale = await localeFrom(params);
  const { site } = getDictionary(locale);
  const title = `${siteConfig.name} — ${site.tagline}`;

  return {
    metadataBase: new URL(siteConfig.url),
    title: { default: title, template: `%s — ${siteConfig.name}` },
    description: site.description,
    applicationName: siteConfig.name,
    formatDetection: { telephone: true },
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      title,
      description: site.description,
      url: absoluteUrl(href(locale, routes.home)),
      locale: OG_LOCALE[locale],
      alternateLocale: SHIPPING_LOCALES.filter((other) => other !== locale).map(
        (other) => OG_LOCALE[other],
      ),
      /* Explicit, because setting `openGraph` at all drops the image inherited
         from `app/opengraph-image.tsx`. See the note in `lib/seo/share-card.ts`;
         without this line every page on the shop shares as a grey box. */
      images: [{ url: absoluteUrl(SHARE_CARD) }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: site.description,
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
}

export const viewport: Viewport = {
  themeColor: "#002c1d",
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
};

export default async function SiteLayout({ children, params }: LayoutProps) {
  const locale = await localeFrom(params);
  const dict = getDictionary(locale);

  const navigation = await loadNavigation(locale, dict);

  return (
    <html lang={HTML_LANG[locale]} className={fontVariables}>
      <body className={BODY_CLASS}>
        <JsonLd id="ld-organization" data={organizationJsonLd(locale)} />
        <JsonLd id="ld-website" data={webSiteJsonLd(locale)} />
        <SiteFrame navigation={navigation} dict={dict}>
          {children}
        </SiteFrame>
        <Measurement />
      </body>
    </html>
  );
}
