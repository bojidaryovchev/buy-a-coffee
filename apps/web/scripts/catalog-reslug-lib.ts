/**
 * Moving products to the shop's own slugs: the reading, the plan and the write.
 *
 * Shared by `catalog:reslug` and `seed:reference`, so the seeded catalog the
 * tests run against has been through exactly the move production goes through.
 * This file has no entry point and opens no connection of its own.
 *
 * The plan itself is `planSlugMoves` in `@catalog/shared`: a function of the
 * products and the reserved slugs and nothing else, which is why two databases
 * holding the same catalog end at the same URLs (see
 * `packages/scraper-core/test/slugRoutes.test.ts`). What is added here is
 * where the inputs come from and how the result is written.
 */
import { eq, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { brands, categories, productCategories, products } from "@catalog/db/schema";
import {
  type ProductNameInput,
  type SlugMove,
  parseWeight,
  planSlugMoves,
  productName,
  productSearchName,
} from "@catalog/shared";
import { RESERVED_PRODUCT_SLUGS } from "@catalog/shared/storefront-data";

export interface ReslugRow {
  readonly id: string;
  readonly sourceKey: string;
  /** The supplier's name: what the owner knows the product by. */
  readonly name: string;
  readonly slug: string;
  readonly previousSlugs: readonly string[];
  readonly base: string;
  /** What `search_name` should hold, and what it holds. */
  readonly searchName: string;
  readonly storedSearchName: string | null;
}

export interface ReslugPlan {
  readonly rows: readonly ReslugRow[];
  readonly moves: ReadonlyArray<SlugMove & { readonly id: string; readonly name: string }>;
  /**
   * Products whose stored search name is not the shop's current name for them:
   * every product the first time, and afterwards only one whose name changed
   * (an override was written) before the sync has run again.
   */
  readonly renames: ReadonlyArray<{ readonly id: string; readonly searchName: string }>;
}

/** Every address a product may not take: routes, landing slugs, stored category slugs. */
function reservedWith(categorySlugs: Iterable<string>): ReadonlySet<string> {
  return new Set([...RESERVED_PRODUCT_SLUGS, ...categorySlugs]);
}

/**
 * Read every product with what its name is built from, and plan the move.
 *
 * Every product, whatever its status: a removed product keeps its page, so it
 * keeps a slug, and it must not be left holding one a live product needs.
 * The inputs are exactly the ones the sync hands `assignProductSlug` for a new
 * product (`sync.ts`): the brand row's own key and name, the source keys of
 * the categories the product is linked to, the parsed pack size.
 */
export async function planReslug(
  db: Database,
  options: {
    /** Only this source site's products. The seed uses it; production has one site. */
    readonly sourceSiteId?: string;
  } = {},
): Promise<ReslugPlan> {
  const scope = options.sourceSiteId ? eq(products.sourceSiteId, options.sourceSiteId) : undefined;
  const [productRows, categoryLinks, categoryRows] = await Promise.all([
    db
      .select({
        id: products.id,
        sourceKey: products.sourceKey,
        previousSourceKeys: products.previousSourceKeys,
        name: products.name,
        slug: products.slug,
        previousSlugs: products.previousSlugs,
        searchName: products.searchName,
        weightValue: products.weightValue,
        weightUnit: products.weightUnit,
        brandKey: brands.sourceKey,
        brandName: brands.name,
      })
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(scope),
    db
      .select({ productId: productCategories.productId, sourceKey: categories.sourceKey })
      .from(productCategories)
      .innerJoin(categories, eq(categories.id, productCategories.categoryId)),
    db.select({ slug: categories.slug }).from(categories),
  ]);

  const categoryKeys = new Map<string, string[]>();
  for (const link of categoryLinks) {
    if (!link.sourceKey) continue;
    categoryKeys.set(link.productId, [...(categoryKeys.get(link.productId) ?? []), link.sourceKey]);
  }

  const rows: ReslugRow[] = productRows.map((row) => {
    const name = productName({
      sourceName: row.name,
      sourceKey: row.sourceKey,
      previousSourceKeys: row.previousSourceKeys,
      brand: row.brandKey ? { sourceKey: row.brandKey, name: row.brandName } : null,
      categoryKeys: categoryKeys.get(row.id) ?? [],
      packValue: row.weightValue,
      packUnit: row.weightUnit,
    });
    return {
      id: row.id,
      sourceKey: row.sourceKey,
      name: row.name,
      slug: row.slug,
      previousSlugs: row.previousSlugs,
      base: name.slugBase,
      searchName: productSearchName(name),
      storedSearchName: row.searchName,
    };
  });

  const byKey = new Map(rows.map((row) => [row.sourceKey, row]));
  const moves = planSlugMoves(rows, reservedWith(categoryRows.map((row) => row.slug))).map(
    (move) => {
      const row = byKey.get(move.sourceKey) as ReslugRow;
      return { ...move, id: row.id, name: row.name };
    },
  );
  const renames = rows
    .filter((row) => row.storedSearchName !== row.searchName)
    .map((row) => ({ id: row.id, searchName: row.searchName }));
  return { rows, moves, renames };
}

/**
 * Write a plan: each product gets its new slug, the slug it leaves is
 * appended to `previous_slugs`, and its search name is brought up to date, in
 * one transaction.
 *
 * Two passes, because `(source_site_id, slug)` is unique and checked row by
 * row: were one product ever planned into the slug another is leaving, the
 * direct update would fail on whichever ran first. Every moving product is
 * parked on a placeholder first, then given its slug.
 *
 * A slug a product returns to is taken out of its own history, so the list
 * never holds the address the product is currently at.
 */
export async function applyReslug(db: Database, plan: ReslugPlan): Promise<number> {
  if (plan.moves.length === 0 && plan.renames.length === 0) return 0;
  await db.transaction(async (tx) => {
    // The name search matches by; no URL depends on it.
    for (const rename of plan.renames) {
      await tx
        .update(products)
        .set({ searchName: rename.searchName })
        .where(eq(products.id, rename.id));
    }
    for (const move of plan.moves) {
      await tx
        .update(products)
        .set({ slug: `reslug-in-progress-${move.id}` })
        .where(eq(products.id, move.id));
    }
    for (const move of plan.moves) {
      await tx
        .update(products)
        .set({
          slug: move.to,
          previousSlugs: sql`array_append(
            array_remove(array_remove(${products.previousSlugs}, ${move.to}::text), ${move.from}::text),
            ${move.from}::text
          )`,
        })
        .where(eq(products.id, move.id));
    }
  });
  return plan.moves.length;
}

/* --- The reference snapshot ---------------------------------------------- */

/** One product of `reference/latest/products.json`, as far as a slug needs it. */
export interface SnapshotSlugProduct {
  readonly sourceKey: string;
  readonly slug?: string | null;
  readonly name: string;
  readonly brandKey?: string | null;
  readonly categoryKeys?: readonly string[];
  readonly weight?: string | null;
}

/**
 * The slug each snapshot product has on the storefront today, by the slug the
 * snapshot carries for it.
 *
 * The snapshot records the slug a product had when it was exported. One
 * exported before the move still says `kapsuli-dg-…`, while the written copy
 * is keyed by where the product is now. Rather than rewrite a crawl artifact
 * by hand, whoever joins the snapshot to our copy asks here — the same plan
 * the database was moved by, so the answer is the slug the product really has.
 * A snapshot exported after the move maps every slug to itself.
 *
 * A product with no slug in the snapshot has not been synced, and is not in
 * the map.
 */
export function currentSlugsOfSnapshot(
  snapshotProducts: readonly SnapshotSlugProduct[],
  snapshotBrands: ReadonlyArray<{ readonly sourceKey: string; readonly name: string }> = [],
  categorySlugs: Iterable<string> = [],
): Map<string, string> {
  const brandNames = new Map(snapshotBrands.map((brand) => [brand.sourceKey, brand.name]));
  const synced = snapshotProducts.filter(
    (product): product is SnapshotSlugProduct & { slug: string } => Boolean(product.slug),
  );
  const moves = planSlugMoves(
    synced.map((product) => {
      const weight = parseWeight(product.weight ?? null);
      const input: ProductNameInput = {
        sourceName: product.name,
        sourceKey: product.sourceKey,
        brand: product.brandKey
          ? {
              sourceKey: product.brandKey,
              name: brandNames.get(product.brandKey) ?? product.brandKey,
            }
          : null,
        categoryKeys: product.categoryKeys ?? [],
        packValue: weight?.value ?? null,
        packUnit: weight?.unit ?? null,
      };
      return {
        sourceKey: product.sourceKey,
        slug: product.slug,
        base: productName(input).slugBase,
      };
    }),
    reservedWith(categorySlugs),
  );
  const moved = new Map(moves.map((move) => [move.from, move.to]));
  return new Map(synced.map((product) => [product.slug, moved.get(product.slug) ?? product.slug]));
}
