import type { CommerceConfig } from "@/config/site";
import type { HeroShelfItem } from "@/lib/catalog/home-shelf";
import type { BrandView, ProductCardView } from "@/lib/catalog/types";
import type { ArticleSummary } from "@/lib/journal";
import { HomeHero } from "./hero";
import type { Locale } from "@/i18n/config";
import {
  DeliveryPromise,
  HomeBrands,
  HomePromotions,
  HowOrderingWorks,
  JournalTeaser,
  NewArrivals,
  ShopBySystem,
  SYSTEMS_ANCHOR,
  VendingBand,
  WizardEntry,
  stockedSystems,
  type SystemCounts,
} from "./sections";

/**
 * Everything the home page shows, as plain data.
 *
 * The route (`app/(site)/page.tsx`) fills this from the database and the
 * configuration; the view only arranges it. Keeping the two apart is what
 * lets a test render the whole page from a fixture and prove that a section
 * with nothing behind it is gone, not empty.
 */
export interface HomeData {
  /** The locale the page is rendered in; every link inside follows it. */
  readonly locale: Locale;
  /** Active products in the catalog. */
  readonly productCount: number;
  /** Brands, each with its own product count; those with none are ignored. */
  readonly brands: readonly BrandView[];
  /** Products per brewing system. */
  readonly systemCounts: SystemCounts;
  readonly shelf: readonly HeroShelfItem[];
  readonly newArrivals: readonly ProductCardView[];
  readonly promotions: readonly ProductCardView[];
  /** Empty when the journal is switched off or has nothing published. */
  readonly articles: readonly ArticleSummary[];
  /** Defaults to `siteConfig.commerce`; a test passes its own. */
  readonly commerce?: CommerceConfig;
}

/** The sections, in the order DESIGN.md gives them ("Home page"). */
export function HomeView({
  locale,
  productCount,
  brands,
  systemCounts,
  shelf,
  newArrivals,
  promotions,
  articles,
  commerce,
}: HomeData) {
  const hasSystems = stockedSystems(systemCounts).length > 0;
  const stockedBrands = brands.filter((brand) => brand.productCount > 0);

  return (
    <>
      <HomeHero
        locale={locale}
        brandCount={stockedBrands.length}
        productCount={productCount}
        shelf={shelf}
        systemsHref={hasSystems ? `#${SYSTEMS_ANCHOR}` : null}
      />
      <DeliveryPromise commerce={commerce} />
      <ShopBySystem counts={systemCounts} locale={locale} />
      {/* The wizard asks which system first; with none stocked it has no
          first question to ask. */}
      {hasSystems && <WizardEntry locale={locale} />}
      <HomePromotions products={promotions} locale={locale} />
      <NewArrivals products={newArrivals} locale={locale} />
      <HowOrderingWorks />
      <HomeBrands brands={stockedBrands} locale={locale} />
      <JournalTeaser articles={articles} locale={locale} />
      <VendingBand locale={locale} />
    </>
  );
}
