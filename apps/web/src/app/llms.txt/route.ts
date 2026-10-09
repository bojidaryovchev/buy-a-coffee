import { siteConfig, usingPlaceholderBrand } from "@/config/site";
import {
  countPromotions,
  getCatalogSummary,
  getCategoryTree,
  listBrands,
} from "@/lib/catalog/queries";
import { BUSINESS_SECTIONS } from "@/lib/catalog/business-sections";
import { getLandingAvailability } from "@/lib/catalog/landing-queries";
import { LANDING_IDS, LANDING_PATHS } from "@/lib/catalog/landings";
import { sectionListsProducts } from "@/lib/catalog/vending";
import { listArticles } from "@/lib/journal";
import { isSectionCategory } from "@/components/layout/navigation";
import { MACHINE_BRANDS } from "@/content/machines";
import { categoryNameFor } from "../../../content/category-copy";
import { landingCopy } from "../../../content/landing-copy";
import { consumablesCopy, vendingCopy } from "../../../content/vending";
import { llmsText } from "./body";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { brandHref, categoryHref, href } from "@/lib/routes";

/**
 * `/llms.txt` — a plain-language map of the shop for AI search.
 *
 * Generated from the live catalog rather than written, so it cannot drift the
 * way a hand-maintained file would. The three vend repos have carried one for
 * months; this repo did not, which is the whole reason it is here.
 *
 * WHY IT IS WORTH HAVING on a shop rather than a catalogue of specifications:
 * the two pages this site has that nothing else in the market does are the
 * wizard and the machine-compatibility pages. "Which capsules fit a Krups
 * Piccolo" is a question a person asks an assistant, not a search box, and the
 * answer is a page we already publish. `robots.ts` deliberately does not block
 * any AI crawler, so being quotable is the point.
 *
 * ⚠ IT MUST NEVER OUTLIVE THE INDEXING GATE. `robots.ts` closes the site to
 * crawlers on anything that is not production, and this file has to agree with
 * it: a machine-readable summary of a shop whose prices are still being
 * confirmed is the same mistake as an indexed catalogue, in the one format
 * designed to be quoted verbatim.
 *
 * The delivery and payment terms are the sentences `components/commerce/terms.ts`
 * builds for the site's own pages, and only for the terms that are set — see
 * `body.ts`, which holds the wording so that a test can read it.
 *
 * The company's legal identity is deliberately absent while
 * `usingPlaceholderBrand()` is true. `organizationJsonLd` guards it the same
 * way, for the same reason: a fabricated company number must not reach a format
 * built to be repeated.
 *
 * Every link is a public URL in the default locale, built through
 * `lib/routes.ts` like every other link on the site.
 *
 * **It lists what the sitemap lists.** A page that is `noindex` or a 404 while
 * it has no products — consumables, each of the landing listings, and the
 * promotions page while nothing is reduced — is left out here on the same
 * switch that takes it out of the sitemap, and comes back by itself when the
 * catalog fills it. A file written to be quoted must not
 * point an assistant at a page that says "nothing here yet".
 */

export const revalidate = 3600;

const isProduction = (): boolean => {
  const hostEnvironment = process.env.VERCEL_ENV;
  if (hostEnvironment) return hostEnvironment === "production";
  return (
    process.env.NEXT_PUBLIC_ENVIRONMENT === "production" ||
    (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENVIRONMENT === undefined)
  );
};

export async function GET() {
  if (!isProduction()) {
    return new Response("# Not available on this deployment.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const [summary, tree, brands, consumablesListed, landings, promotionCount] = await Promise.all([
    getCatalogSummary(),
    getCategoryTree(),
    listBrands({ withProductsOnly: true }),
    sectionListsProducts("consumables"),
    getLandingAvailability(),
    countPromotions(),
  ]);

  const locale = DEFAULT_LOCALE;
  const body = llmsText({
    locale,
    summary,
    /* Top-level categories only. The tree runs three deep in places, and a flat
       list of every leaf would be a sitemap in prose rather than a map. The
       category behind a business section is named by that section's page. */
    categories: tree
      .filter((category) => !isSectionCategory(category, BUSINESS_SECTIONS))
      // Under the name the listing gives itself, as every link on the site does.
      .map((category) => ({
        name: categoryNameFor(category),
        href: categoryHref(locale, category),
      })),
    brands: brands.map((brand) => ({
      name: brand.name,
      href: brandHref(locale, brand),
    })),
    machineBrandCount: MACHINE_BRANDS.length,
    sections: [
      { ...vendingCopy, href: href(locale, BUSINESS_SECTIONS.vending.path) },
      ...(consumablesListed
        ? [{ ...consumablesCopy, href: href(locale, BUSINESS_SECTIONS.consumables.path) }]
        : []),
    ].map((copy) => ({ name: copy.title, href: copy.href, description: copy.metaDescription })),
    hasPromotions: promotionCount > 0,
    landings: LANDING_IDS.filter((id) => landings.counts[id] > 0).map((id) => ({
      name: landingCopy[id].h1,
      href: href(locale, LANDING_PATHS[id]),
      description: landingCopy[id].llms,
    })),
    articles: siteConfig.features.blog
      ? listArticles().map((article) => ({
          name: article.title,
          href: href(locale, article.href),
          description: article.description,
        }))
      : [],
    company: usingPlaceholderBrand()
      ? null
      : `${siteConfig.legal.companyName}, ЕИК ${siteConfig.legal.companyId}`,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
