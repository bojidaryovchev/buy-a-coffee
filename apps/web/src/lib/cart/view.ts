import type {
  CutoutView,
  Availability,
  PriceView,
  ProductCardView,
  ProductStatus,
} from "@/lib/catalog/types";

/**
 * A product as the cart page shows it, and as `/api/cart` sends it.
 *
 * Built on the server from the same card every listing draws (`toCard` in the
 * query layer), so a line names and prices a product exactly as its card does.
 * Narrower than the card on purpose: this travels to the browser as JSON, and
 * carries only what the page prints. Never the supplier's name — that stays on
 * the owner's side (`ProductForOrder.sourceName`).
 */
export interface CartProductView {
  readonly id: string;
  /** The current slug, which may differ from the one the cart stored. */
  readonly slug: string;
  /** The whole name in one line, for `alt` and a screen reader. */
  readonly name: string;
  /** Brand and line, the heading: "Lavazza Super Crema". */
  readonly title: string;
  /** "Кафе на зърна, 1 кг". */
  readonly detail: string | null;
  readonly image: {
    readonly url: string;
    readonly alt: string;
    /** The photo cut out, when one is live (DESIGN.md, "Imagery"). */
    readonly cutout: CutoutView | null;
  } | null;
  /** Null for "Цена при запитване". */
  readonly price: PriceView | null;
  /** "0,35 € на чаша", or null. */
  readonly servingPrice: string | null;
  readonly availability: Availability;
  /** Why the line cannot be ordered, or null when it can. */
  readonly blocked: CartBlock | null;
}

/**
 * Why a product in the cart cannot go into the order.
 *
 *  - `unavailable`: the shop no longer sells it (removed, or held back while
 *    the sync is unsure of it) — or it is gone from the catalog altogether.
 *  - `out_of_stock`: it is sold, but not today. The product page takes no
 *    order for it either, and the cart does the same.
 *
 * "По поръчка" and an unknown stock are orderable, as on the product page:
 * the call is where either is settled.
 */
export type CartBlock = "unavailable" | "out_of_stock";

export function cartBlock(status: ProductStatus, availability: Availability): CartBlock | null {
  if (status !== "active") return "unavailable";
  if (availability === "out_of_stock") return "out_of_stock";
  return null;
}

export function toCartProductView(card: ProductCardView, status: ProductStatus): CartProductView {
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    title: card.title ?? card.name,
    detail: card.detail ?? null,
    image: card.image
      ? { url: card.image.url, alt: card.image.alt, cutout: card.image.cutout ?? null }
      : null,
    price: card.price,
    servingPrice: card.servingPrice?.formatted ?? null,
    availability: card.availability,
    blocked: cartBlock(status, card.availability),
  };
}
