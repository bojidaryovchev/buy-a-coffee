import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { categories, productCategories, products } from "@catalog/db/schema";
import { db } from "@/lib/db";
import type { CatalogQuery } from "./filters";
import { getProductBySlug, listProducts } from "./queries";
import type { ProductCardView, ProductListResult } from "./types";

/**
 * Reads for the two business sections, `/vending` and `/consumables`.
 *
 * Each section shows products from up to two places, and both are the
 * catalog's own data rather than a list kept by hand:
 *
 *  1. **A category, once the source has one.** The sections exist upstream as
 *     category-shaped pages that list nothing yet. When products are filed
 *     under them the sync will create the category, and from that moment
 *     `getSectionListing` returns it — no deploy, no edit here.
 *  2. **The vending blends already in the catalog**, picked by
 *     `isVendingBlendName`. Today that is the only thing `/vending` has to
 *     show, and it is filed under plain coffee beans, so no category would
 *     find it.
 *
 * Nothing in this file states that a product exists. A section with nothing
 * behind it returns `null` or an empty list, and the page omits it.
 */

export type BusinessSectionId = "vending" | "consumables";

export interface BusinessSection {
  readonly id: BusinessSectionId;
  readonly path: string;
  /**
   * The category that backs the section, by source key.
   *
   * The source key is the source's own slug and survives a rename of the
   * Bulgarian label; our storefront slug is derived from that label and would
   * not. Both are accepted, the same way the wizard binds a brewing system to
   * its categories, so either one changing costs us nothing.
   */
  readonly categoryKeys: readonly string[];
}

export const BUSINESS_SECTIONS: Readonly<Record<BusinessSectionId, BusinessSection>> = {
  vending: { id: "vending", path: "/vending", categoryKeys: ["vending-zona"] },
  consumables: { id: "consumables", path: "/consumables", categoryKeys: ["konsumativi"] },
};

/* --- The vending-blend rule --------------------------------------------- */

/**
 * A product is a vending blend when its name carries the word "Vending".
 *
 * That is the roaster's own designation — the line is sold as "Elia Vending
 * Aroma", "… Crema", "… Intenso" — so the rule repeats a claim the maker
 * already prints on the bag instead of making one for them.
 *
 * What it deliberately does not use:
 *
 *  - **Our descriptions.** Several say a blend "suits automatic machines".
 *    That is our prose, written per product; selecting on it would let a
 *    copywriter's turn of phrase put a coffee on a page for operators.
 *  - **Attributes.** The catalog has four (strength, intensity, decaf,
 *    flavoured) and none of them is about the machine.
 *  - **Substring matching.** The word must stand alone, so a product whose
 *    name merely contains the letters does not qualify.
 *
 * Cyrillic „Вендинг" counts too: product names here mix both scripts in one
 * string, and the source could start spelling the line either way.
 *
 * This predicate and `vendingBlendCondition` below are the same rule written
 * twice, once for code and once for SQL. `test/vending.test.ts` runs both over
 * the whole catalog and fails if they ever disagree.
 */
export function isVendingBlendName(name: string): boolean {
  return /(?<![\p{L}\p{N}_])(?:vending|вендинг)(?![\p{L}\p{N}_])/iu.test(name);
}

/**
 * The same rule in SQL.
 *
 * Matched on `catalog_translit(name)`, which lower-cases and folds Cyrillic to
 * Latin, so one ASCII pattern covers both spellings and the match does not
 * depend on the database's collation knowing how to case-fold Cyrillic.
 */
const vendingBlendCondition = sql`catalog_translit(${products.name}) ~ '\\mvending\\M'`;

/**
 * Upper bound on the blends shown. The rule finds three today; the cap exists
 * because each one costs a lookup (see `listVendingBlends`) and a bound that
 * is written down is better than one that is merely true this month.
 */
export const MAX_VENDING_BLENDS = 24;

/** Narrow a product down to what a card draws. */
function toCardView(product: ProductCardView): ProductCardView {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    oldPrice: product.oldPrice,
    discountPercent: product.discountPercent,
    availability: product.availability,
    weight: product.weight,
    intensity: product.intensity,
    systemId: product.systemId,
    servingPrice: product.servingPrice,
    brand: product.brand,
    image: product.image,
    shortDescription: product.shortDescription,
  };
}

/**
 * Vending blends that are on sale and not already listed by the section's
 * category.
 *
 * The exclusion matters on the day the source files these same blends under
 * its vending category: without it the page would show each of them twice.
 *
 * The cards are loaded through `getProductBySlug`, one product at a time.
 * `queries.ts` avoids per-product lookups everywhere, and so would this — but
 * the mapping from a row to a card (which price wins, which image, whether a
 * reduction is genuine) is private to that file, and a second copy of the
 * price rule here is the worse trade: a card on this page must never disagree
 * with the product page it links to. The set is small and capped, and the page
 * is cached for five minutes.
 */
export async function listVendingBlends(): Promise<readonly ProductCardView[]> {
  const sectionKeys = [...BUSINESS_SECTIONS.vending.categoryKeys];

  const rows = await db
    .select({ slug: products.slug })
    .from(products)
    .where(
      and(
        eq(products.status, "active"),
        vendingBlendCondition,
        sql`not exists (
          select 1 from ${productCategories} pc
          join ${categories} c on c.id = pc.category_id
          left join ${categories} parent on parent.id = c.parent_id
          where pc.product_id = ${products.id}
            and c.status = 'active'
            and (
              c.source_key = any(${sql.param(sectionKeys)}::text[])
              or c.slug = any(${sql.param(sectionKeys)}::text[])
              or parent.source_key = any(${sql.param(sectionKeys)}::text[])
              or parent.slug = any(${sql.param(sectionKeys)}::text[])
            )
        )`,
      ),
    )
    .orderBy(asc(products.name))
    .limit(MAX_VENDING_BLENDS);

  const details = await Promise.all(rows.map((row) => getProductBySlug(row.slug)));

  return details
    .filter(
      (product): product is NonNullable<typeof product> =>
        // Re-checked because the two reads are not one snapshot.
        product !== null && product.status === "active",
    )
    .map(toCardView);
}

/* --- The category-backed path ------------------------------------------- */

export interface SectionCategory {
  readonly slug: string;
  readonly name: string;
  /** Products on sale in the category or in any of its children. */
  readonly productCount: number;
}

/** The category behind a section, or null while the source has none. */
export async function getSectionCategory(id: BusinessSectionId): Promise<SectionCategory | null> {
  const keys = [...BUSINESS_SECTIONS[id].categoryKeys];

  const [category] = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories)
    .where(
      and(
        eq(categories.status, "active"),
        sql`(${categories.sourceKey} = any(${sql.param(keys)}::text[]) or ${categories.slug} = any(${sql.param(keys)}::text[]))`,
      ),
    )
    // The source key is the stronger match: it is the one the sync assigns.
    .orderBy(sql`(${categories.sourceKey} = any(${sql.param(keys)}::text[])) desc`)
    .limit(1);

  if (!category) return null;

  /*
   * Counted here, in its own statement, rather than as a subquery in the select
   * list above: Drizzle does not table-qualify columns inside a select-list
   * subquery, which is the trap `getCategoryTree` documents.
   */
  const [count] = await db
    .select({ value: sql<number>`count(distinct ${products.id})::int` })
    .from(products)
    .innerJoin(productCategories, eq(productCategories.productId, products.id))
    .innerJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(
      and(
        eq(products.status, "active"),
        sql`(${categories.id} = ${category.id} or ${categories.parentId} = ${category.id})`,
      ),
    );

  return { slug: category.slug, name: category.name, productCount: count?.value ?? 0 };
}

export interface SectionListing {
  readonly category: SectionCategory;
  readonly result: ProductListResult;
}

/**
 * The section's own listing, with filters, sorting and pagination.
 *
 * Returns null both when the category does not exist and when it exists but
 * holds nothing on sale. The second case is the realistic first step upstream
 * — the category appears before its products do — and an empty listing with a
 * filter panel beside it would be the blank shell the page is meant to omit.
 *
 * The products come from `listProducts`, the same call the category pages
 * make, so prices, images, facets and ordering behave identically here.
 */
export async function getSectionListing(
  id: BusinessSectionId,
  query: CatalogQuery,
): Promise<SectionListing | null> {
  const category = await getSectionCategory(id);
  if (!category || category.productCount === 0) return null;

  const result = await listProducts({ query, categorySlug: category.slug });
  return { category, result };
}
