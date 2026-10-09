import "server-only";
import type { ReactNode } from "react";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { AnnouncementBar, hasAnnouncement } from "@/components/commerce/announcement-bar";
import { buildNavigation, type SiteNavigation } from "@/components/layout/navigation";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { siteConfig } from "@/config/site";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/bg";
import { BUSINESS_SECTIONS } from "@/lib/catalog/business-sections";
import { countPromotions, getCategoryTree } from "@/lib/catalog/queries";

/**
 * The shop's frame — skip link, announcement bar, header, `<main>`, footer —
 * shared by the two documents that draw it: the locale's root layout, and the
 * global 404 (`app/global-not-found.tsx`), which bypasses layouts and would
 * otherwise be a page with no way on but its own two buttons.
 */

/**
 * The navigation for one locale, from the live catalog.
 *
 * Catalog-driven, so a system that sells out leaves the menu and a category
 * the sync adds joins it, without a code change. The rail is organised by
 * brewing system, but which systems have products — and how many — is already
 * in the tree, so the header, the drawer and the footer are all drawn from
 * that one read. The second, a count, decides whether "Промоции" is worth a
 * link; the two run together.
 */
export async function loadNavigation(locale: Locale, dict: Dictionary): Promise<SiteNavigation> {
  const [categories, promotionCount] = await Promise.all([getCategoryTree(), countPromotions()]);
  return buildNavigation(categories, {
    locale,
    labels: dict.nav,
    sections: BUSINESS_SECTIONS,
    hasJournal: siteConfig.features.blog,
    // A link to a page that has only ever been empty is worse than no link.
    hasPromotions: promotionCount > 0,
  });
}

export function SiteFrame({
  navigation,
  dict,
  children,
}: {
  navigation: SiteNavigation;
  dict: Dictionary;
  children: ReactNode;
}) {
  return (
    <>
      <a href="#main" className="skip-link">
        {dict.skipLink}
      </a>

      <AnalyticsProvider>
        {/* Above the sticky header, so it scrolls away and the header takes
            the top of the screen. It carries the hours and the phone number
            on a wide screen; when there is no bar, the header does. */}
        <AnnouncementBar locale={navigation.locale} dict={dict} />
        <SiteHeader navigation={navigation} dict={dict} showPhone={!hasAnnouncement()} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter navigation={navigation} dict={dict} />
      </AnalyticsProvider>
    </>
  );
}
