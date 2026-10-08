import type { MetadataRoute } from "next";
import { absoluteUrl, siteConfig } from "@/config/site";
import { getCategoryTree, listAllProductSlugs, listBrands } from "@/lib/catalog/queries";
import { BUSINESS_SECTIONS } from "@/lib/catalog/vending";
import { JOURNAL_PATH, listArticles } from "@/lib/journal";
import { isSectionCategory } from "@/components/layout/navigation";
import { MACHINE_BRANDS } from "@/content/machines";

/**
 * Sitemap.
 *
 * Built from the live catalog, so it can never list a product we no longer
 * sell — the opposite of the reference site, whose sitemap still advertises
 * 111 URLs that return the home page.
 *
 * Only indexable pages appear: no search, no filtered listings, no legal
 * boilerplate given artificial priority.
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [productSlugs, categories, brands] = await Promise.all([
    listAllProductSlugs(),
    getCategoryTree(),
    listBrands({ withProductsOnly: true }),
  ]);

  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    {
      url: absoluteUrl("/categories"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    { url: absoluteUrl("/brands"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: absoluteUrl("/promotions"), lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: absoluteUrl("/wizard"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    {
      url: absoluteUrl("/wizard/machines"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    ...Object.values(BUSINESS_SECTIONS).map((section) => ({
      url: absoluteUrl(section.path),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    { url: absoluteUrl("/delivery"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/contact"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/cookies"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  // The journal costs nothing to list: its articles are files, not rows.
  const articles = siteConfig.features.blog ? listArticles() : [];
  const newestArticle = articles.reduce<Date | null>(
    (latest, article) =>
      latest === null || article.lastModified > latest ? article.lastModified : latest,
    null,
  );

  // The index is only worth advertising once it lists something.
  if (newestArticle) {
    staticRoutes.push({
      url: absoluteUrl(JOURNAL_PATH),
      lastModified: newestArticle,
      changeFrequency: "weekly",
      priority: 0.4,
    });
  }

  const flattenCategories = (nodes: typeof categories): typeof categories =>
    nodes.flatMap((node) => [node, ...flattenCategories(node.children)]);

  const entries: MetadataRoute.Sitemap = [
    ...staticRoutes,
    /*
     * Machine compatibility pages. They answer a question people actually
     * type — "which capsules fit a Krups Piccolo" — and they are built from
     * our own data rather than the catalog, so they are stable enough to
     * advertise.
     */
    ...MACHINE_BRANDS.map((brand) => ({
      url: absoluteUrl(`/wizard/machines/${brand.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...flattenCategories(categories)
      .filter((category) => !isSectionCategory(category, BUSINESS_SECTIONS))
      .map((category) => ({
        url: absoluteUrl(`/categories/${category.slug}`),
        lastModified: now,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
    ...brands.map((brand) => ({
      url: absoluteUrl(`/brands/${brand.slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...productSlugs.map((product) => ({
      url: absoluteUrl(`/products/${product.slug}`),
      // The catalog sync only moves this when the product genuinely changed.
      lastModified: product.updatedAt ?? now,
      changeFrequency: "weekly" as const,
      priority: 0.9,
    })),
    ...articles.map((article) => ({
      url: absoluteUrl(article.href),
      lastModified: article.lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];

  // A URL listed twice is a mistake somewhere above; the first one stands.
  const seen = new Set<string>();
  return entries.filter((entry) => !seen.has(entry.url) && seen.add(entry.url));
}
