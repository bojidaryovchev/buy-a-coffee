import { expect, type Page } from "@playwright/test";

/**
 * The public Bulgarian URLs the suite visits, written out.
 *
 * Literal on purpose, not imported from `lib/routes.ts`: these specs check
 * what a visitor and a crawler actually get, so the expected URL must not be
 * computed by the code under test. A slug change is meant to fail here, and
 * the person making it updates this list in the same commit.
 */
export const BG = {
  home: "/bg",
  categories: "/bg/kategorii",
  /** The capsule parent category, at its landing slug (stored slug `kapsuli`). */
  capsules: "/bg/kafe-kapsuli",
  nespresso: "/bg/nespresso-kapsuli",
  brands: "/bg/marki",
  brand: (slug: string) => `/bg/marki/${slug}`,
  search: "/bg/tarsene",
  promotions: "/bg/promotsii",
  vending: "/bg/kafe-za-vending-mashini",
  consumables: "/bg/konsumativi",
  delivery: "/bg/dostavka-i-plashtane",
  contact: "/bg/kontakti",
  privacy: "/bg/poveritelnost",
  terms: "/bg/obshti-usloviya",
  cookies: "/bg/biskvitki",
  journal: "/bg/blog",
  wizard: "/bg/izbor-na-kafe",
  wizardResult: "/bg/izbor-na-kafe/rezultat",
  machines: "/bg/za-kafemashina",
  machineBrand: (slug: string) => `/bg/za-kafemashina/${slug}`,
  unsubscribe: "/bg/byuletin/otpisvane",
} as const;

/**
 * A product card's link. Products and categories share the first level under
 * the locale, so a product link is told apart by where it sits — every
 * product card is an `<article>` — rather than by its prefix.
 */
export const PRODUCT_LINK = 'article a[href^="/bg/"]:not([href*="#"])';

/**
 * Wait until the browser is on a product page.
 *
 * Not by URL alone: a category is one slug under `/bg` too, so the URL of the
 * listing a test just clicked away from already looks like a product's. The
 * order panel (`#order`) is what only a product page has.
 */
export async function expectProductPage(page: Page): Promise<void> {
  await expect(page.locator("#order")).toBeAttached();
  await expect(page).toHaveURL(/\/bg\/[a-z0-9-]+$/);
}
