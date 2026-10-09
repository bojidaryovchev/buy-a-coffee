import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { brands, categories, productCategories, products } from "@catalog/db/schema";
import { productName } from "@catalog/shared";
import { db } from "@/lib/db";
import { siteConfig } from "@/config/site";
import {
  EMPTY_JOURNAL_FIGURES,
  computeJournalFigures,
  type JournalCatalogRow,
  type JournalFigures,
  type JournalLandings,
} from "./journal-figures";
import { getLandingAvailability } from "./landing-queries";
import { LANDING_IDS, type LandingId } from "./landings";

/**
 * The catalog read behind the journal's figures.
 *
 * Separate from `queries.ts` on purpose: the journal needs one flat pass over
 * the active catalog — price, pack size, attributes, categories — and nothing
 * else does. It follows that file's rules all the same: only `active` products,
 * and the price the customer sees is `retail_price_override ?? current_price`.
 *
 * Two round trips, bounded by the catalog (under two hundred rows), and the arithmetic
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
      sourceKey: products.sourceKey,
      previousSourceKeys: products.previousSourceKeys,
      brandKey: brands.sourceKey,
      brandName: brands.name,
      price: sql<
        string | null
      >`coalesce(${products.retailPriceOverride}, ${products.currentPrice})`,
      currency: products.currency,
      weightValue: products.weightValue,
      weightUnit: products.weightUnit,
      arabicaPercent: products.arabicaPercent,
      roast: products.roast,
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
    // The shop's own name, as everywhere a customer reads one (`productName`
    // in `@catalog/shared`); an article links a product by it.
    name: productName({
      sourceName: row.name,
      sourceKey: row.sourceKey,
      previousSourceKeys: row.previousSourceKeys,
      brand:
        row.brandKey || row.brandName ? { sourceKey: row.brandKey, name: row.brandName } : null,
      categoryKeys: (byProduct.get(row.id) ?? []).flatMap((category) =>
        category.sourceKey ? [category.sourceKey] : [],
      ),
      packValue: row.weightValue,
      packUnit: row.weightUnit,
    }).title,
    brandName: row.brandName,
    price: row.price,
    currency: row.currency,
    weightValue: row.weightValue,
    weightUnit: row.weightUnit,
    arabicaPercent: row.arabicaPercent,
    roast: row.roast,
    attributes: row.attributes ?? {},
    categories: byProduct.get(row.id) ?? [],
  }));
}

/**
 * Which landing listings an article may link to: the ones that have products.
 *
 * Asked of `getLandingAvailability`, the answer the landing routes 404 on and
 * the sitemap and footer are built from, so a link in an article appears and
 * disappears with the page it points at.
 */
async function loadJournalLandings(): Promise<JournalLandings> {
  const { counts } = await getLandingAvailability();
  return Object.fromEntries(LANDING_IDS.map((id) => [id, counts[id] > 0])) as Record<
    LandingId,
    boolean
  >;
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
    const [rows, landings] = await Promise.all([loadJournalRows(), loadJournalLandings()]);
    return computeJournalFigures(rows, siteConfig.currency, landings);
  } catch (error) {
    console.error("journal: catalog figures unavailable, rendering without them", error);
    return EMPTY_JOURNAL_FIGURES;
  }
}
