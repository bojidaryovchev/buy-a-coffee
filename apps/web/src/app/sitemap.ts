import type { MetadataRoute } from "next";
import { absoluteUrl, siteConfig } from "@/config/site";
import { getCategoryTree, listAllProductSlugs, listBrands } from "@/lib/catalog/queries";

/**
 * Sitemap.
 *
 * Built from the live catalog, so it can never list a product we no longer
 * sell — the opposite of the reference site, whose sitemap still advertises
 * 111 URLs that return the home page.
 *
 * Only indexable pages appear: no search, no filtered listings, no legal
 * boilerplate given artificial priority.
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
    { url: absoluteUrl("/categories"), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: absoluteUrl("/brands"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: absoluteUrl("/promotions"), lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: absoluteUrl("/contact"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: absoluteUrl("/cookies"), lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  if (siteConfig.features.blog) {
    staticRoutes.push({
      url: absoluteUrl("/journal"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.4,
    });
  }

  const flattenCategories = (nodes: typeof categories): typeof categories =>
    nodes.flatMap((node) => [node, ...flattenCategories(node.children)]);

  return [
    ...staticRoutes,
    ...flattenCategories(categories).map((category) => ({
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
  ];
}
