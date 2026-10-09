import type { MetadataRoute } from "next";
import { absoluteUrl, siteConfig } from "@/config/site";
import { SHIPPING_LOCALES } from "@/i18n/config";
import { getCategoryTree, listAllProductSlugs, listBrands } from "@/lib/catalog/queries";
import { BUSINESS_SECTIONS } from "@/lib/catalog/business-sections";
import { sectionListsProducts } from "@/lib/catalog/vending";
import { JOURNAL_PATH, listArticles } from "@/lib/journal";
import { isSectionCategory } from "@/components/layout/navigation";
import { MACHINE_BRANDS } from "@/content/machines";
import { languageAlternates, type LocalePath } from "@/lib/seo/alternates";
import { brandHref, categoryHref, href, productHref, routes } from "@/lib/routes";

/**
 * Sitemap.
 *
 * Built from the live catalog, so it can never list a product we no longer
 * sell — the opposite of the reference site, whose sitemap still advertises
 * 111 URLs that return the home page.
 *
 * Only indexable pages appear: no search, no filtered listings, no answered
 * wizard, no legal boilerplate given artificial priority. The consumables page
 * is left out while it lists nothing, because it is `noindex` until then and a
 * sitemap entry for a page that asks not to be indexed is a contradiction.
 *
 * **Every page once per shipping locale, each entry carrying the page's whole
 * `hreflang` set**, `x-default` included — the same set the page's own head
 * declares (`lib/seo/alternates.ts`). Grouped by page, not by locale, because
 * the set belongs to the page. While Bulgarian alone ships, that is one `bg`
 * entry per page with a `bg` and an `x-default` alternate.
 *
 * `lastModified` is a real date wherever the data holds one — a product's last
 * genuine change, an article's revision date, the newest article for the
 * journal's index. Everywhere else it is the time of generation, which is the
 * honest answer for a page assembled from the live catalog.
 *
 * Every URL appears once. The two business sections are listed by their own
 * pages; the day the sync files products under them, the categories behind
 * them are left out here, as they are left out of the menu, so the same shelf
 * is not advertised at two addresses.
 */
export const revalidate = 3600;

interface Page {
  readonly path: LocalePath;
  readonly lastModified: Date;
  readonly changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  readonly priority: number;
}

const at =
  (canonical: string): LocalePath =>
  (locale) =>
    href(locale, canonical);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [productSlugs, categories, brands, consumablesListed] = await Promise.all([
    listAllProductSlugs(),
    getCategoryTree(),
    listBrands({ withProductsOnly: true }),
    sectionListsProducts("consumables"),
  ]);

  const now = new Date();
  const page = (
    path: LocalePath,
    changeFrequency: Page["changeFrequency"],
    priority: number,
    lastModified: Date = now,
  ): Page => ({ path, changeFrequency, priority, lastModified });

  const pages: Page[] = [
    page(at(routes.home), "daily", 1),
    page(at(routes.categories), "weekly", 0.8),
    page(at(routes.brands), "weekly", 0.7),
    page(at(routes.promotions), "daily", 0.7),
    page(at(routes.wizard), "monthly", 0.8),
    page(at(routes.machines), "monthly", 0.7),
    page(at(BUSINESS_SECTIONS.vending.path), "weekly", 0.6),
    ...(consumablesListed ? [page(at(BUSINESS_SECTIONS.consumables.path), "weekly", 0.6)] : []),
    page(at(routes.delivery), "monthly", 0.5),
    page(at(routes.contact), "monthly", 0.5),
    page(at(routes.privacy), "yearly", 0.2),
    page(at(routes.terms), "yearly", 0.2),
    page(at(routes.cookies), "yearly", 0.2),
  ];

  // The journal costs nothing to list: its articles are files, not rows.
  const articles = siteConfig.features.blog ? listArticles() : [];
  const newestArticle = articles.reduce<Date | null>(
    (latest, article) =>
      latest === null || article.lastModified > latest ? article.lastModified : latest,
    null,
  );

  // The index is only worth advertising once it lists something.
  if (newestArticle) pages.push(page(at(JOURNAL_PATH), "weekly", 0.4, newestArticle));

  const flattenCategories = (nodes: typeof categories): typeof categories =>
    nodes.flatMap((node) => [node, ...flattenCategories(node.children)]);

  pages.push(
    /*
     * Machine compatibility pages. They answer a question people actually
     * type — "which capsules fit a Krups Piccolo" — and they are built from
     * our own data rather than the catalog, so they are stable enough to
     * advertise.
     */
    ...MACHINE_BRANDS.map((brand) => page(at(routes.machineBrand(brand.slug)), "monthly", 0.6)),
    ...flattenCategories(categories)
      .filter((category) => !isSectionCategory(category, BUSINESS_SECTIONS))
      .map((category) => page((locale) => categoryHref(locale, category), "daily", 0.8)),
    ...brands.map((brand) => page((locale) => brandHref(locale, brand), "weekly", 0.6)),
    ...productSlugs.map((product) =>
      // The catalog sync only moves `updatedAt` when the product genuinely changed.
      page((locale) => productHref(locale, product), "weekly", 0.9, product.updatedAt ?? now),
    ),
    ...articles.map((article) => page(at(article.href), "monthly", 0.5, article.lastModified)),
  );

  const entries: MetadataRoute.Sitemap = pages.flatMap((entry) => {
    const languages = languageAlternates(entry.path);
    return SHIPPING_LOCALES.map((locale) => ({
      url: absoluteUrl(entry.path(locale)),
      lastModified: entry.lastModified,
      changeFrequency: entry.changeFrequency,
      priority: entry.priority,
      alternates: { languages },
    }));
  });

  // A URL listed twice is a mistake somewhere above; the first one stands.
  const seen = new Set<string>();
  return entries.filter((entry) => !seen.has(entry.url) && seen.add(entry.url));
}
