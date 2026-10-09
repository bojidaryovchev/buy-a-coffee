import { siteConfig, usingPlaceholderBrand } from "@/config/site";
import { getCatalogSummary, getCategoryTree, listBrands } from "@/lib/catalog/queries";
import { BUSINESS_SECTIONS } from "@/lib/catalog/business-sections";
import { listArticles } from "@/lib/journal";
import { isSectionCategory } from "@/components/layout/navigation";
import { MACHINE_BRANDS } from "@/content/machines";
import { consumablesCopy, vendingCopy } from "../../../content/vending";
import { llmsText } from "./body";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { brandHref, categoryHref, href, routes } from "@/lib/routes";

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

  const [summary, tree, brands] = await Promise.all([
    getCatalogSummary(),
    getCategoryTree(),
    listBrands({ withProductsOnly: true }),
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
      .map((category) => ({ name: category.name, href: categoryHref(locale, category) })),
    brands: brands.map((brand) => ({
      name: brand.name,
      href: brandHref(locale, brand),
    })),
    machineBrandCount: MACHINE_BRANDS.length,
    sections: [
      { ...vendingCopy, href: href(locale, BUSINESS_SECTIONS.vending.path) },
      { ...consumablesCopy, href: href(locale, BUSINESS_SECTIONS.consumables.path) },
    ].map((copy) => ({ name: copy.title, href: copy.href, description: copy.metaDescription })),
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
