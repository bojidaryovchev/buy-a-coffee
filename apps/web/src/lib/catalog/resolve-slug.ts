import "server-only";
import { cache } from "react";
import { LOCALES, type Locale } from "@/i18n/config";
import { getCategoryTree, getCurrentSlugOfFormer, getProductBySlug } from "@/lib/catalog/queries";
import type { CategoryView, ProductDetailView } from "@/lib/catalog/types";
import {
  categoryHref,
  categorySlug,
  productHref,
  productSlug,
  storedProductSlug,
} from "@/lib/routes";

/**
 * What `/<locale>/<slug>` is.
 *
 * Categories and products share the first level under the locale — `/bg/kafe-kapsuli`,
 * `/bg/<product>` — and are told apart here, in a fixed order:
 *
 *   1. **A category at its slug in this locale** — the curated landing slug,
 *      or the stored slug for a category with none.
 *   2. **A category at a slug it is not published at** — its stored slug when
 *      it has a landing slug (`/bg/kapsuli`), or its landing slug in another
 *      locale. A redirect, so one category is never indexable at two URLs.
 *   3. **A product**, by its slug in this locale; one reached at a different
 *      spelling (its slug in another locale, once there is one) redirects.
 *   4. **A product at a slug it used to have** (`products.previous_slugs`):
 *      a redirect to where it is now. Every product was moved once, from the
 *      supplier's wording to the shop's own, and the old addresses are indexed.
 *   5. Nothing: the 404.
 *
 * Categories go first, so a product can never shadow a category. Static
 * segments (`marki`, `tarsene`, …) go before both, by construction: Next
 * matches a static folder before a dynamic one, and `RESERVED_SLUGS` keeps
 * either from taking one.
 *
 * Cached per request: the page and its metadata both ask.
 */
export type SlugResolution =
  | {
      readonly kind: "category";
      readonly category: CategoryView;
      readonly tree: readonly CategoryView[];
    }
  | { readonly kind: "product"; readonly product: ProductDetailView }
  /**
   * A public URL in this locale, without a query string; the caller adds it.
   * `category` is set when the slug named a category, so the caller can send
   * a business section's category to the section in the same hop.
   */
  | { readonly kind: "redirect"; readonly to: string; readonly category?: CategoryView };

function flatten(nodes: readonly CategoryView[]): CategoryView[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

export const resolveSlug = cache(
  async (locale: Locale, slug: string): Promise<SlugResolution | null> => {
    const tree = await getCategoryTree();
    const all = flatten(tree);

    const category = all.find((entry) => categorySlug(locale, entry) === slug);
    if (category) return { kind: "category", category, tree };

    const elsewhere = all.find(
      (entry) =>
        entry.slug === slug || LOCALES.some((other) => categorySlug(other, entry) === slug),
    );
    if (elsewhere) {
      return { kind: "redirect", to: categoryHref(locale, elsewhere), category: elsewhere };
    }

    const stored = storedProductSlug(locale, slug);
    const product = await getProductBySlug(stored);
    if (product) {
      return productSlug(locale, product) === slug
        ? { kind: "product", product }
        : { kind: "redirect", to: productHref(locale, product) };
    }

    // A slug the product had before `catalog:reslug` moved it.
    const current = await getCurrentSlugOfFormer(stored);
    return current ? { kind: "redirect", to: productHref(locale, { slug: current }) } : null;
  },
);
