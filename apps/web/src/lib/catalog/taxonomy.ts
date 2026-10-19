import "server-only";
import { cache } from "react";
import { and, asc, eq, sql } from "drizzle-orm";
import { brands, categories, productCategories, products } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { isInstantCoffee, isNotInstantCoffee } from "./product-kind-sql";

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
 * Every category that holds at least one visible product of a brand, other
 * than instant coffee.
 *
 * Only `active` products count, as everywhere else on the storefront: a brand
 * summary that mentioned a format whose last product had gone would be
 * describing a shelf that is empty. Instant coffee is left out because these
 * categories are read for the brewing systems they name, and instant coffee
 * is in none, whatever shelf it is filed on; `brandHasInstantCoffee` says
 * whether the brand has any.
 *
 * Read once per request (React `cache`): a brand's page, its metadata and its
 * share card's metadata all ask the same question.
 */
export const listBrandCategoryKeys = cache(async function listBrandCategoryKeys(
  brandSlug: string,
): Promise<readonly CategoryKey[]> {
  return db
    .selectDistinct({ slug: categories.slug, sourceKey: categories.sourceKey })
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(productCategories, eq(productCategories.productId, products.id))
    .innerJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(and(eq(products.status, "active"), eq(brands.slug, brandSlug), isNotInstantCoffee))
    .orderBy(asc(categories.slug));
});

/** Whether a brand has instant coffee on sale, by the products' own names. Once per request. */
export const brandHasInstantCoffee = cache(async function brandHasInstantCoffee(
  brandSlug: string,
): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .where(and(eq(products.status, "active"), eq(brands.slug, brandSlug), isInstantCoffee));
  return (row?.count ?? 0) > 0;
});
