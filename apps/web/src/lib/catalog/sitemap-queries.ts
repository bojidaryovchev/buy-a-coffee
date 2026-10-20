import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { brands, categories, productCategories, productImages, products } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { isPlaceholderImage, resolveImageUrl } from "./images";
import { productPageChangedAt } from "./page-changed";
import { isReduced } from "./price-sql";
import { SITEMAP_PRODUCT_STATUSES } from "./product-status";

/**
 * What the sitemap needs to know about every product on sale, in three round
 * trips however large the catalog: its address and its last genuine change,
 * the photographs to list under it, and what it belongs to — its brand, its
 * categories, whether it is reduced — so that each listing can be dated by the
 * newest change among the products it shows rather than by the moment the
 * sitemap happened to be generated.
 *
 * Its own file, like `landing-queries.ts`, and by the same rules as
 * `queries.ts`: the price is `retail_price_override ?? current_price`, and
 * only `active` products are `listed` — what a listing shows, and so what
 * dates it. A `missing` product is here too, unlisted: its page stays
 * indexable until the sync gives up on it (`lib/catalog/product-status.ts`).
 */

export interface SitemapProduct {
  readonly id: string;
  readonly slug: string;
  /** When the page last changed: the source's change or our own (`productPageChangedAt`). */
  readonly updatedAt: Date | null;
  readonly brandSlug: string | null;
  /** Stored slugs and source keys of every category it is filed under. */
  readonly categoryKeys: readonly string[];
  /** Has a genuine reduction: what the promotions page lists. */
  readonly reduced: boolean;
  /** Its photographs, resolved against today's image host, in gallery order. */
  readonly images: readonly string[];
  /** On sale (`active`), so shown by the listings it is filed under. */
  readonly listed: boolean;
}

export async function listSitemapProducts(): Promise<readonly SitemapProduct[]> {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      updatedAt: productPageChangedAt,
      brandSlug: brands.slug,
      reduced: isReduced,
      status: products.status,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(inArray(products.status, [...SITEMAP_PRODUCT_STATUSES]))
    .orderBy(asc(products.slug));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [links, photos] = await Promise.all([
    db
      .select({
        productId: productCategories.productId,
        slug: categories.slug,
        sourceKey: categories.sourceKey,
      })
      .from(productCategories)
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .where(inArray(productCategories.productId, ids)),
    db
      .select({
        productId: productImages.productId,
        objectKey: productImages.objectKey,
        publicUrl: productImages.publicUrl,
      })
      .from(productImages)
      .where(
        and(
          inArray(productImages.productId, ids),
          eq(productImages.status, "active"),
          isNotNull(productImages.objectKey),
        ),
      )
      .orderBy(asc(productImages.ordinal)),
  ]);

  const keys = new Map<string, string[]>();
  for (const link of links) {
    const list = keys.get(link.productId) ?? [];
    list.push(link.slug, ...(link.sourceKey ? [link.sourceKey] : []));
    keys.set(link.productId, list);
  }

  const images = new Map<string, string[]>();
  for (const photo of photos) {
    // The key, as the gallery resolves it: against today's image host.
    const url = resolveImageUrl(photo.objectKey ?? photo.publicUrl ?? "");
    if (isPlaceholderImage(url)) continue;
    const list = images.get(photo.productId) ?? [];
    if (!list.includes(url)) list.push(url);
    images.set(photo.productId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    updatedAt: row.updatedAt,
    brandSlug: row.brandSlug,
    categoryKeys: keys.get(row.id) ?? [],
    reduced: Boolean(row.reduced),
    images: images.get(row.id) ?? [],
    listed: row.status === "active",
  }));
}
