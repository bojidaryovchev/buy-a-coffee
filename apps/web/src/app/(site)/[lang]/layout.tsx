import type { Metadata, Viewport } from "next";
import { SiteFrame, loadNavigation } from "@/components/layout/site-frame";
import { Measurement } from "@/components/measurement";
import { siteConfig } from "@/config/site";
import { organizationJsonLd, webSiteJsonLd } from "@/lib/seo/json-ld";
import { shareDefaults } from "@/lib/seo/share";
import { TITLE_TEMPLATE } from "@/lib/seo/title";
import { JsonLd } from "@/components/seo/json-ld";
import { HTML_LANG, SHIPPING_LOCALES } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { localeFrom, type LangParams } from "@/i18n/params";
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
    // The separator before the shop's name is decided in `lib/seo/title.ts`.
    title: { default: title, template: TITLE_TEMPLATE },
    description: site.description,
    applicationName: siteConfig.name,
    formatDetection: { telephone: true },
    /*
     * For sharing, the layout says only what is true of every page: that it is
     * a website, the shop's name, the locale and the card. It names no address,
     * title or description. Next hands this whole object to any page that sets
     * no `openGraph` of its own (the merge is shallow), so a `url` or a
     * `title` here would be the home page's, announced by every such page;
     * that is how a shared category link used to be presented as the home
     * page. Every page, the home page included, declares its own through
     * `shareMetadata`. One that forgets shares with no `og:url` and with its
     * own `<title>` as `og:title` (Next fills a missing one from the title),
     * and `e2e/i18n.spec.ts` fails on it. See `lib/seo/share.ts`.
     */
    ...shareDefaults(locale),
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
