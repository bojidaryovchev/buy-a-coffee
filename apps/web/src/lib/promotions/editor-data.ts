import "server-only";
import type { PromotionTargets } from "@catalog/db/schema";
import type { BrandOption, CategoryOption, ChosenProduct } from "@/components/admin/promotion-form";
import { getCategoryTree, listBrands, listProductCardsByIds } from "@/lib/catalog/queries";
import type { CategoryView } from "@/lib/catalog/types";

/**
 * What the editor offers to choose from: the brands and the category tree
 * with how many products each has on sale (the shop's own counts and names),
 * and the shop's names of the products a promotion already lists.
 *
 * A brand or a category with nothing on sale is not offered — choosing it
 * would change nothing — unless the promotion already has it, so that it can
 * still be taken out.
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
  const brands = brandRows
    .filter((brand) => brand.productCount > 0 || chosenBrands.has(brand.id))
    .map((brand) => ({ id: brand.id, name: brand.name, count: brand.productCount }))
    .sort((a, b) => a.name.localeCompare(b.name, "bg"));

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

  const chosenProducts: Record<string, ChosenProduct> = {};
  for (const [id, card] of cards) {
    chosenProducts[id] = { title: card.title ?? card.name, detail: card.detail ?? null };
  }

  return { brands, categories: keep(tree), chosenProducts };
}
