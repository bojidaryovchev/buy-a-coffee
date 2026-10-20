import type { ProductCardView } from "@/lib/catalog/types";

/**
 * A product as the promotion editor's picker lists it and as the editor
 * names a chosen one: the shop's own card, so what the owner chooses by —
 * name, pack, price, photo — is what the customer sees. By id, because a
 * promotion keeps product ids (`PromotionTargets`); the newsletter's picker
 * (`lib/newsletter/picker.ts`) answers with addresses for its text, which is
 * why this one has its own route.
 */
export interface PromotionPickerProduct {
  readonly id: string;
  readonly slug: string;
  /** Brand and line, as the card's heading. */
  readonly title: string;
  /** Format and pack: "Кафе на зърна, 1 кг". */
  readonly detail: string | null;
  readonly price: string | null;
  readonly image: string | null;
  readonly soldOut: boolean;
}

/** What one search answers with. */
export const PROMOTION_PICKER_RESULTS = 20;

export function toPromotionPickerProduct(card: ProductCardView): PromotionPickerProduct {
  return {
    id: card.id,
    slug: card.slug,
    title: card.title ?? card.name,
    detail: card.detail ?? null,
    price: card.price?.formatted ?? null,
    image: card.image?.url ?? null,
    soldOut: card.availability === "out_of_stock",
  };
}

/** "Lavazza Crema e Aroma, Кафе на зърна, 1 кг": a product told apart from its other packs. */
export function describeProduct(product: { title: string; detail: string | null }): string {
  return product.detail ? `${product.title}, ${product.detail}` : product.title;
}
