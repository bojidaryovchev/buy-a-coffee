import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { brands, categories, productCategories, products } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { cupRangeOf, uniformPieceCount, type CupRange, type CupRangeRow } from "./cup-range";

/**
 * What a listing's title and meta description say about the products on it.
 *
 * One flat read per listing — price and pack size of every product in scope —
 * and the arithmetic in TypeScript (`cup-range.ts`), for the reason
 * `journal-queries.ts` gives: one copy of the grams-per-serving assumption, so
 * a search snippet can never quote a per-cup price the cards would not.
 *
 * It follows the rules of `queries.ts`: only `active` products, and the price
 * the customer sees is `retail_price_override ?? current_price`. The scopes are
 * the same predicates `listProducts` applies, unfiltered — a description
 * belongs to the clean page the canonical points at, never to a filtered view.
 */

export type ListingScope =
  /** Everything on sale: the home page, the two index pages. */
  | { readonly kind: "all" }
  /** A category and its children, as `listProducts({ categorySlug })` lists it. */
  | { readonly kind: "category"; readonly slug: string }
  | { readonly kind: "brand"; readonly slug: string }
  /** Products whose old price is genuinely higher than the current one. */
  | { readonly kind: "promotions" }
  /** A hand-picked set, by stored slug: the vending page's blends. */
  | { readonly kind: "products"; readonly slugs: readonly string[] };

export interface ListingFacts {
  /** Products in scope. */
  readonly productCount: number;
  /** Null when nothing in scope has both a price and a pack size. */
  readonly cupRange: CupRange | null;
  /**
   * The one pack size every pack in scope shares, in pieces, or null when they
   * differ, when there are none, or when any pack is sold by weight. A title
   * may name a size only when it is true of the whole page.
   */
  readonly uniformPieceCount: number | null;
}

const retailPrice = sql<
  string | null
>`coalesce(${products.retailPriceOverride}, ${products.currentPrice})`;
const retailOldPrice = sql<
  string | null
>`coalesce(${products.retailOldPriceOverride}, ${products.oldPrice})`;

function scopeCondition(scope: ListingScope): SQL | undefined {
  switch (scope.kind) {
    case "all":
      return undefined;
    case "category":
      return sql`exists (
        select 1 from ${productCategories} pc
        join ${categories} c on c.id = pc.category_id
        left join ${categories} parent on parent.id = c.parent_id
        where pc.product_id = ${products.id}
          and (c.slug = ${scope.slug} or parent.slug = ${scope.slug})
      )`;
    case "brand":
      return eq(brands.slug, scope.slug);
    case "promotions":
      return sql`${retailOldPrice} is not null and ${retailOldPrice} > ${retailPrice}`;
    case "products":
      return inArray(products.slug, [...scope.slugs]);
  }
}

export async function getListingFacts(scope: ListingScope): Promise<ListingFacts> {
  // An empty hand-picked set lists nothing, and `in ()` is not valid SQL.
  if (scope.kind === "products" && scope.slugs.length === 0) {
    return { productCount: 0, cupRange: null, uniformPieceCount: null };
  }

  const rows: CupRangeRow[] = await db
    .select({
      price: retailPrice,
      currency: products.currency,
      weightValue: products.weightValue,
      weightUnit: products.weightUnit,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(and(eq(products.status, "active"), scopeCondition(scope)));

  return {
    productCount: rows.length,
    cupRange: cupRangeOf(rows),
    uniformPieceCount: uniformPieceCount(rows),
  };
}

export type BrandCategoryKeys = ReadonlyMap<
  string,
  ReadonlyArray<{ readonly slug: string; readonly sourceKey: string | null }>
>;

/**
 * The categories each brand has products in, for every brand at once, keyed by
 * brand slug.
 *
 * The brand index says what each brand makes. `listBrandCategoryKeys` answers
 * that for one brand; called per tile it would be a query per brand, which
 * `queries.ts` rules out.
 */
export async function listCategoryKeysByBrand(): Promise<BrandCategoryKeys> {
  const rows = await db
    .selectDistinct({
      brandSlug: brands.slug,
      slug: categories.slug,
      sourceKey: categories.sourceKey,
    })
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(productCategories, eq(productCategories.productId, products.id))
    .innerJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(eq(products.status, "active"));

  const byBrand = new Map<string, Array<{ slug: string; sourceKey: string | null }>>();
  for (const row of rows) {
    const list = byBrand.get(row.brandSlug) ?? [];
    list.push({ slug: row.slug, sourceKey: row.sourceKey });
    byBrand.set(row.brandSlug, list);
  }
  return byBrand;
}
