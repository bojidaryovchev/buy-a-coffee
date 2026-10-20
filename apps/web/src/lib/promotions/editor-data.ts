import "server-only";
import { inArray } from "drizzle-orm";
import { brands, categories, type PromotionTargets } from "@catalog/db/schema";
import type { BrandOption, CategoryOption, ChosenProduct } from "@/components/admin/promotion-form";
import { brandDisplayName } from "@/lib/catalog/brand-display";
import { getCategoryTree, listBrands, listProductCardsByIds } from "@/lib/catalog/queries";
import type { CategoryView } from "@/lib/catalog/types";
import { db } from "@/lib/db";

/**
 * What the editor offers to choose from: the brands and the category tree
 * with how many products each has on sale (the shop's own counts and names),
 * and the shop's names of the products a promotion already lists.
 *
 * A brand or a category with nothing on sale is not offered — choosing it
 * would change nothing — unless the promotion already has it, so that it can
 * still be taken out. One the sync no longer lists (not `active`) is shown
 * the same way, marked `inactive`: the shop's lists leave it out, but a
 * promotion that chose it still holds it.
 */
export async function loadEditorChoices(targets: PromotionTargets): Promise<{
  brands: BrandOption[];
  categories: CategoryOption[];
  chosenProducts: Record<string, ChosenProduct>;
}> {
  const productIds = [...new Set([...targets.productIds, ...targets.excludedProductIds])];
  const [brandRows, tree, cards] = await Promise.all([
    listBrands(),
    getCategoryTree(),
    listProductCardsByIds(productIds),
  ]);

  const chosenBrands = new Set(targets.brandIds);
  const listedBrands = new Set(brandRows.map((brand) => brand.id));
  const unlistedBrandIds = targets.brandIds.filter((id) => !listedBrands.has(id));
  const unlistedBrands =
    unlistedBrandIds.length === 0
      ? []
      : await db
          .select({ id: brands.id, name: brands.name, sourceKey: brands.sourceKey })
          .from(brands)
          .where(inArray(brands.id, unlistedBrandIds));
  const brandOptions: BrandOption[] = [
    ...brandRows
      .filter((brand) => brand.productCount > 0 || chosenBrands.has(brand.id))
      .map((brand) => ({ id: brand.id, name: brand.name, count: brand.productCount })),
    ...unlistedBrands.map((brand) => ({
      id: brand.id,
      name: brandDisplayName(brand),
      count: 0,
      inactive: true,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name, "bg"));

  const chosenCategories = new Set(targets.categoryIds);
  const keep = (nodes: readonly CategoryView[]): CategoryOption[] =>
    nodes
      .filter((node) => node.productCount > 0 || chosenCategories.has(node.id))
      .map((node) => ({
        id: node.id,
        name: node.name,
        count: node.productCount,
        children: keep(node.children),
      }));
  const flat = (nodes: readonly CategoryView[]): CategoryView[] =>
    nodes.flatMap((node) => [node, ...flat(node.children)]);
  const listedCategories = new Set(flat(tree).map((node) => node.id));
  const unlistedCategoryIds = targets.categoryIds.filter((id) => !listedCategories.has(id));
  const unlistedCategories =
    unlistedCategoryIds.length === 0
      ? []
      : await db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(inArray(categories.id, unlistedCategoryIds));

  const chosenProducts: Record<string, ChosenProduct> = {};
  for (const [id, card] of cards) {
    chosenProducts[id] = { title: card.title ?? card.name, detail: card.detail ?? null };
  }

  return {
    brands: brandOptions,
    categories: [
      ...keep(tree),
      ...unlistedCategories.map((category) => ({
        id: category.id,
        name: category.name,
        count: 0,
        children: [],
        inactive: true,
      })),
    ],
    chosenProducts,
  };
}
