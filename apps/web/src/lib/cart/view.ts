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
  /** Null for "Цена при запитване". Any running promotion is already off it. */
  readonly price: PriceView | null;
  /**
   * The struck price, when the shop's own promotion reduces the line: the
   * lowest price of the 30 days before it. Null when no promotion of ours
   * does, when that lowest price was no higher than today's, and for the
   * source's own struck price, which the cards show and the cart does not:
   * the cart says what the shop's reductions save.
   */
  readonly oldPrice: PriceView | null;
  /** The badge's figure: set with `oldPrice`, and null when it rounds under one percent. */
  readonly discountPercent: number | null;
  /**
   * The shop's own promotion behind the reduction: the words it gives
   * customers, if any, and when it ends (ISO, the end of its last day in
   * Sofia). Null when no promotion reduced the line, or when the line is not
   * shown reduced. Never the owner's own name for it, which no card carries.
   */
  readonly promotion: {
    readonly label: string | null;
    readonly endsAt: string;
  } | null;
  /**
   * When this price stops being the price: the end of the promotion that sets
   * it (ISO), shown or not, so the page asks again then. Null for a price no
   * promotion sets. Not a claim, and not shown.
   */
  readonly priceEndsAt: string | null;
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
  // Reduced when the card is, by a promotion of ours: a struck price beside a price.
  const promotion = card.price !== null ? (card.promotion ?? null) : null;
  const reduced = promotion !== null && card.oldPrice !== null;
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
    oldPrice: reduced ? card.oldPrice : null,
    discountPercent:
      reduced && card.discountPercent !== null && card.discountPercent >= 1
        ? card.discountPercent
        : null,
    promotion: reduced ? { label: promotion.label, endsAt: promotion.endsAt } : null,
    priceEndsAt: promotion?.endsAt ?? null,
    servingPrice: card.servingPrice?.formatted ?? null,
    availability: card.availability,
    blocked: cartBlock(status, card.availability),
  };
}

/** A little after a price ends, so the server has seen it end too. */
const REQUOTE_AFTER_END_MS = 2_000;
/** When the browser's clock says it ended already and the server still priced it so. */
const REQUOTE_RETRY_MS = 30_000;
/** Far below `setTimeout`'s own limit (24.8 days); a later end is asked about again then. */
const REQUOTE_MAX_MS = 6 * 60 * 60_000;

/**
 * How long the cart page waits before asking the server again about a price
 * that ends at `endsAt` (`priceEndsAt`): until just after it ends, at most six
 * hours, and never in a loop when the browser's clock runs ahead of the
 * server's.
 */
export function requoteDelay(endsAt: number, now: number): number {
  const until = endsAt - now + REQUOTE_AFTER_END_MS;
  return until <= 0 ? REQUOTE_RETRY_MS : Math.min(until, REQUOTE_MAX_MS);
}
