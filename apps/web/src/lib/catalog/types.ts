/**
 * Storefront view models.
 *
 * Deliberately separate from the database row shapes: pages should never have
 * to know about `retail_price_override`, `semantic_hash` or `source_data`.
 * Mapping happens once, in the query layer.
 */

export type Availability = "in_stock" | "out_of_stock" | "preorder" | "unknown";
export type ProductStatus = "active" | "missing" | "removed";

export interface PriceView {
  /** Exact decimal string, e.g. "30.00". Never a float. */
  readonly amount: string;
  readonly currency: string;
  readonly formatted: string;
}

export interface ProductImageView {
  readonly url: string;
  readonly alt: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface ProductCardView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly price: PriceView | null;
  readonly oldPrice: PriceView | null;
  readonly discountPercent: number | null;
  readonly availability: Availability;
  readonly weight: string | null;
  readonly intensity: string | null;
  readonly brand: { readonly slug: string; readonly name: string } | null;
  readonly image: ProductImageView | null;
  readonly shortDescription: string | null;
}

export interface ProductDetailView extends ProductCardView {
  readonly status: ProductStatus;
  readonly descriptionHtml: string | null;
  readonly descriptionText: string | null;
  readonly sku: string | null;
  readonly gtin: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  readonly images: readonly ProductImageView[];
  readonly categories: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly isPrimary: boolean;
    readonly parentSlug: string | null;
  }>;
  readonly updatedAt: Date | null;
}

export interface CategoryView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentSlug: string | null;
  readonly productCount: number;
  readonly children: readonly CategoryView[];
}

export interface BrandView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly tagline: string | null;
  readonly description: string | null;
  readonly productCount: number;
}

export interface FacetValue {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

export interface CatalogFacets {
  readonly brands: readonly FacetValue[];
  readonly strengths: readonly FacetValue[];
  readonly decaf: readonly FacetValue[];
  readonly aromas: readonly FacetValue[];
  readonly categories: readonly FacetValue[];
}

export interface ProductListResult {
  readonly items: readonly ProductCardView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly facets: CatalogFacets;
}
