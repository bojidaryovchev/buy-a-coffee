import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { brands, categories, productCategories, products } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { siteConfig } from "@/config/site";
import {
  EMPTY_JOURNAL_FIGURES,
  computeJournalFigures,
  type JournalCatalogRow,
  type JournalFigures,
} from "./journal-figures";

/**
 * The catalog read behind the journal's figures.
 *
 * Separate from `queries.ts` on purpose: the journal needs one flat pass over
 * the active catalog — price, pack size, attributes, categories — and nothing
 * else does. It follows that file's rules all the same: only `active` products,
 * and the price the customer sees is `retail_price_override ?? current_price`.
 *
 * Two round trips, bounded by the catalog (about 110 rows), and the arithmetic
 * happens in TypeScript through the shared exact-decimal helpers, for the same
 * reason the wizard does it there: one copy of the grams-per-serving
 * assumption, so the journal can never quote a per-cup price the wizard would
 * not.
 */
async function loadJournalRows(): Promise<readonly JournalCatalogRow[]> {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      brandName: brands.name,
      price: sql<
        string | null
      >`coalesce(${products.retailPriceOverride}, ${products.currentPrice})`,
      currency: products.currency,
      weightValue: products.weightValue,
      weightUnit: products.weightUnit,
      attributes: products.attributes,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(eq(products.status, "active"));

  if (rows.length === 0) return [];

  const links = await db
    .select({
      productId: productCategories.productId,
      slug: categories.slug,
      sourceKey: categories.sourceKey,
    })
    .from(productCategories)
    .innerJoin(categories, eq(categories.id, productCategories.categoryId))
    .where(
      inArray(
        productCategories.productId,
        rows.map((row) => row.id),
      ),
    );

  const byProduct = new Map<
    (typeof rows)[number]["id"],
    Array<JournalCatalogRow["categories"][number]>
  >();
  for (const link of links) {
    const list = byProduct.get(link.productId) ?? [];
    list.push({ slug: link.slug, sourceKey: link.sourceKey });
    byProduct.set(link.productId, list);
  }

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    brandName: row.brandName,
    price: row.price,
    currency: row.currency,
    weightValue: row.weightValue,
    weightUnit: row.weightUnit,
    attributes: row.attributes ?? {},
    categories: byProduct.get(row.id) ?? [],
  }));
}

/**
 * The figures, or the empty set if the catalog cannot be read.
 *
 * Swallowing the error is deliberate and specific to this caller. Everywhere
 * else a failed catalog read should fail the page, because the page *is* the
 * catalog. An article is prose that happens to quote a few numbers: it is
 * written to read correctly without them, so a database blip costs the reader
 * a table rather than the whole text. The failure is logged, not hidden.
 */
export async function getJournalFigures(): Promise<JournalFigures> {
  try {
    return computeJournalFigures(await loadJournalRows(), siteConfig.currency);
  } catch (error) {
    console.error("journal: catalog figures unavailable, rendering without them", error);
    return EMPTY_JOURNAL_FIGURES;
  }
}
