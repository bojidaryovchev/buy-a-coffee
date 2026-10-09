import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { categories } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { BUSINESS_SECTIONS, type BusinessSection } from "@/lib/catalog/business-sections";
import { BREWING_SYSTEMS, type BrewingSystem } from "@/lib/recommend/systems";

/**
 * What a category *is*, beyond its name: a brewing system, a business section,
 * or neither.
 *
 * Both answers are read off our own editorial tables — `BREWING_SYSTEMS` and
 * `BUSINESS_SECTIONS` — and both bind a category by its storefront slug *or*
 * the source key behind it, the same way everything else does: the slug is
 * derived from the Bulgarian name and moves when the name does, the source
 * key does not.
 */

export interface CategoryKeys {
  readonly slug: string;
  readonly sourceKey: string | null;
}

/**
 * The one brewing system a category holds, or null.
 *
 * Null for a category that maps to none („Капсули“, which holds five) and for
 * one that would map to several: a system badge in a listing's header is a
 * compatibility claim about everything below it.
 */
export function brewingSystemForCategory(category: CategoryKeys): BrewingSystem | null {
  const matched = BREWING_SYSTEMS.filter(
    (system) =>
      system.categorySlugs.includes(category.slug) ||
      (category.sourceKey !== null && system.categorySourceKeys.includes(category.sourceKey)),
  );
  return matched.length === 1 ? (matched[0] ?? null) : null;
}

/**
 * The business section a category backs, or null.
 *
 * The two business sections (`routes.vending`, `routes.consumables`) are pages
 * of their own that list such a category's products among other things. Once
 * the sync creates the category it would otherwise have a second, plainer
 * address at its own slug; `[slug]` answers that address with a 308 instead.
 */
export function businessSectionForCategory(category: CategoryKeys): BusinessSection | null {
  return (
    Object.values(BUSINESS_SECTIONS).find(
      (section) =>
        section.categoryKeys.includes(category.slug) ||
        (category.sourceKey !== null && section.categoryKeys.includes(category.sourceKey)),
    ) ?? null
  );
}

/**
 * Slugs of the categories that back a business section — the ones the category
 * index leaves out, because each has a section page instead.
 */
export async function listBusinessSectionCategorySlugs(): Promise<ReadonlySet<string>> {
  const keys = Object.values(BUSINESS_SECTIONS).flatMap((section) => [...section.categoryKeys]);
  const rows = await db
    .select({ slug: categories.slug })
    .from(categories)
    .where(
      and(
        eq(categories.status, "active"),
        sql`(${categories.sourceKey} = any(${sql.param(keys)}::text[]) or ${categories.slug} = any(${sql.param(keys)}::text[]))`,
      ),
    );
  return new Set(rows.map((row) => row.slug));
}
