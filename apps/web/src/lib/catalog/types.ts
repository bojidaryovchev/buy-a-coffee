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

/**
 * Price per kilogram or litre — the unit price a price label must carry for
 * goods sold by weight or volume (Dir. 98/6/EC, and Bulgarian law with it).
 *
 * Separate from `PriceView` because it carries the reference unit, and null
 * for anything sold by the piece, where the rule does not reach.
 */
export interface UnitPriceView {
  readonly amount: string;
  readonly currency: string;
  /** Ready to print, e.g. "39,80 € / кг". */
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
  /** Null for packs sold by the piece, and for any pack with no recorded size. */
  readonly unitPrice: UnitPriceView | null;
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

/**
 * Typeahead payloads.
 *
 * Deliberately narrower than `ProductCardView`: these cross the wire on every
 * few keystrokes, so they carry only what the dropdown row actually draws.
 */
export interface ProductSuggestion {
  readonly slug: string;
  readonly name: string;
  readonly brandName: string | null;
  readonly weight: string | null;
  readonly price: PriceView | null;
  readonly image: ProductImageView | null;
}

export interface LinkSuggestion {
  readonly slug: string;
  readonly name: string;
  readonly productCount: number;
}

export interface SearchSuggestions {
  /** Echoed back so a client can discard a response for a stale term. */
  readonly term: string;
  readonly products: readonly ProductSuggestion[];
  readonly brands: readonly LinkSuggestion[];
  readonly categories: readonly LinkSuggestion[];
  /** Total product matches, so the dropdown can offer "see all N". */
  readonly total: number;
}
