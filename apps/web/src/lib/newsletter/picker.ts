import type { ProductCardView } from "@/lib/catalog/types";

/**
 * A product as the composer's picker lists it: what the owner chooses by —
 * photo, name, pack, price — from the storefront's own card, like the letter
 * that will carry it. Shared by the search route and the picker.
 */
export interface PickerProduct {
  readonly slug: string;
  /** Brand and line, as the card's heading. */
  readonly title: string;
  /** Format and pack: "Кафе на зърна, 1 кг". */
  readonly detail: string | null;
  readonly price: string | null;
  readonly oldPrice: string | null;
  readonly image: string | null;
  readonly soldOut: boolean;
}

/** What one search answers with: enough for a brand's whole range. */
export const PICKER_RESULTS = 20;

export function toPickerProduct(card: ProductCardView): PickerProduct {
  return {
    slug: card.slug,
    title: card.title ?? card.name,
    detail: card.detail ?? null,
    price: card.price?.formatted ?? null,
    oldPrice: card.price && card.oldPrice ? card.oldPrice.formatted : null,
    image: card.image?.url ?? null,
    soldOut: card.availability === "out_of_stock",
  };
}
