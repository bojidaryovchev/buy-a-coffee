import "server-only";
import { cache } from "react";
import { eq, inArray, sql } from "drizzle-orm";
import { brands, categories, productCategories, products } from "@catalog/db/schema";
import { db } from "@/lib/db";
import { listProductCardsByIds } from "./queries";
import type { BrewingSystemId } from "@/lib/recommend/systems";
import {
  landingAvailability,
  selectLanding,
  selectSystem,
  type LandingAvailability,
  type LandingGroup,
  type LandingId,
  type LandingRow,
  type LandingSelection,
} from "./landings";
import type { ProductCardView } from "./types";

/**
 * The catalog reads behind the landing listings.
 *
 * Separate from `queries.ts` for the reason `journal-queries.ts` is: these
 * pages need one flat pass over the products on sale — brand, price, pack,
 * attributes, categories — and choose from it in code (`landings.ts`), which
 * no listing query does. The file follows that one's rules all the same: only
 * `active` products, and the price is `retail_price_override ?? current_price`.
 *
 * Two round trips for the rows, bounded by the catalog (under two hundred
 * products), and two more for the cards of whatever a page selected.
 */

/**
 * Every product on sale, as the selections need it.
 *
 * Wrapped in `cache`, so one request reads the catalog once however many parts
 * of the page ask: the footer asks on every page which landings exist, and a
 * listing page asks again for its cross-links and for its own products.
 */
const loadLandingRows = cache(async (): Promise<readonly LandingRow[]> => {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      brandSlug: brands.slug,
      brandSourceKey: brands.sourceKey,
      price: sql<
        string | null
      >`coalesce(${products.retailPriceOverride}, ${products.currentPrice})`,
      weightValue: products.weightValue,
      weightUnit: products.weightUnit,
      availability: products.availability,
      attributes: products.attributes,
    })
    .from(products)
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(eq(products.status, "active"));

  if (rows.length === 0) return [];

  /*
   * The categories in a second statement rather than a subquery in the select
   * list above, which is where Drizzle stops table-qualifying columns
   * (`getCategoryTree` documents the trap).
   */
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

  const keysByProduct = new Map<string, string[]>();
  for (const link of links) {
    const keys = keysByProduct.get(link.productId) ?? [];
    keys.push(link.slug);
    if (link.sourceKey) keys.push(link.sourceKey);
    keysByProduct.set(link.productId, keys);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    brandSlug: row.brandSlug,
    brandSourceKey: row.brandSourceKey,
    price: row.price,
    weightValue: row.weightValue,
    weightUnit: row.weightUnit,
    availability: row.availability,
    attributes: row.attributes ?? {},
    categoryKeys: keysByProduct.get(row.id) ?? [],
  }));
});

/** Which landings exist, and which anchors and neighbours a link may name. */
export async function getLandingAvailability(): Promise<LandingAvailability> {
  return landingAvailability(await loadLandingRows());
}

/** A group with the cards it draws, in the selection's order. */
export interface LandingGroupView extends Omit<LandingGroup, "items"> {
  readonly products: readonly ProductCardView[];
}

export interface LandingView extends Omit<LandingSelection, "groups"> {
  readonly groups: readonly LandingGroupView[];
}

/**
 * One landing, ready to render: the selection, with a card for each product.
 *
 * The figures the page states — the count, the per-cup range, the systems —
 * come from the selection, and the cards come from `queries.ts`, which is the
 * only place a row becomes a card. Both read the same displayed price and the
 * same pack columns through the same shared helpers, so the range in the meta
 * description is the range of the per-cup prices printed on the cards.
 *
 * A product that left the catalog between the two reads has no card and is
 * dropped, and the count is taken again from the cards actually drawn.
 */
async function withCards(chosen: LandingSelection): Promise<LandingView> {
  const cards = await listProductCardsByIds(
    chosen.groups.flatMap((group) => group.items.map((item) => item.id)),
  );

  const groups = chosen.groups
    .map((group) => ({
      key: group.key,
      system: group.system,
      poolSize: group.poolSize,
      products: group.items
        .map((item) => cards.get(item.id))
        .filter((card): card is ProductCardView => card !== undefined),
    }))
    .filter((group) => group.products.length > 0);

  return {
    ...chosen,
    groups,
    count: groups.reduce((sum, group) => sum + group.products.length, 0),
  };
}

/*
 * Cached per request: a page's metadata and its body both ask for the same
 * landing, and neither should make the other's read happen twice.
 */
export const getLanding = cache(async (id: LandingId): Promise<LandingView> =>
  withCards(selectLanding(id, await loadLandingRows())),
);

/** Everything on sale in one brewing system, as a landing-shaped listing. */
export const getSystemListing = cache(async (systemId: BrewingSystemId): Promise<LandingView> =>
  withCards(selectSystem(systemId, await loadLandingRows())),
);
