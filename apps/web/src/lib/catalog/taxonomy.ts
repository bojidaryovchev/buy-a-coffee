import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { brands, categories, productCategories, products } from "@catalog/db/schema";
import { db } from "@/lib/db";

/**
 * Source keys for the taxonomy.
 *
 * The view models in `types.ts` carry storefront slugs, which is right for
 * links. Our editorial content — category introductions, brewing systems — is
 * keyed by the sync's source key instead, because a slug is derived from a
 * Bulgarian name and moves when the name does. These two reads are the bridge.
 */

export interface CategoryKey {
  readonly slug: string;
  readonly sourceKey: string;
}

/** The source key behind a category slug, or null for an unknown slug. */
export async function getCategorySourceKey(slug: string): Promise<string | null> {
  const [row] = await db
    .select({ sourceKey: categories.sourceKey })
    .from(categories)
    .where(and(eq(categories.slug, slug), eq(categories.status, "active")))
    .limit(1);
  return row?.sourceKey ?? null;
}

/**
 * Every category that holds at least one visible product of a brand.
 *
 * Only `active` products count, as everywhere else on the storefront: a brand
 * summary that mentioned a format whose last product had gone would be
 * describing a shelf that is empty.
 */
export async function listBrandCategoryKeys(brandSlug: string): Promise<readonly CategoryKey[]> {
  return db
    .selectDistinct({ slug: categories.slug, sourceKey: categories.sourceKey })
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(productCategories, eq(productCategories.productId, products.id))
    .innerJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(and(eq(products.status, "active"), eq(brands.slug, brandSlug)))
    .orderBy(asc(categories.slug));
}
