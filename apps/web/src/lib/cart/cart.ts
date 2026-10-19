/**
 * The cart, as data: what is in it, and the rules for changing it.
 *
 * Pure, and client-safe on purpose. The store (`store.ts`) keeps a cart in the
 * browser's `localStorage` and calls these to change it; the order form posts
 * what they produce; the server action checks it again with its own schema.
 *
 * A line is a product and a quantity, and nothing else. No price, no name: the
 * browser is not trusted with either. The cart page asks the server what each
 * product is and costs today (`/api/cart`), and the order is priced from the
 * database when it is stored. The slug is kept beside the id only so a line
 * can link to its product before the server has answered; the id is the key,
 * because a product's slug can change and its id cannot.
 *
 * Nothing here is personal data, which is why it can live in the browser
 * without a consent banner (`content/legal.ts`, the cookie policy).
 */

/** The `localStorage` key. Named in the cookie policy; change both together. */
export const CART_STORAGE_KEY = "buy-a-coffee.cart";

/** The stored shape's version. A cart in a shape this code does not know is read as empty. */
export const CART_VERSION = 1;

/** How many of one product a line may hold: more is a phone call. */
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 99;

/**
 * Different products one cart may hold. Far above any real order — an office
 * stocking a month is a dozen lines — and low enough that a cart cannot be
 * made into a large request.
 */
export const MAX_CART_LINES = 50;

export interface CartLine {
  readonly productId: string;
  readonly slug: string;
  readonly quantity: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A product id as the database writes it. Anything else cannot name a product. */
export function isProductId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A quantity a line may hold: a whole number from 1 to 99, whatever was asked for. */
export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return MIN_QUANTITY;
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, Math.trunc(value)));
}

/** Whether a product can still be added: it is already in the cart, or there is room. */
export function canAdd(lines: readonly CartLine[], productId: string): boolean {
  return lines.length < MAX_CART_LINES || lines.some((line) => line.productId === productId);
}

/**
 * Add a product. A product already in the cart has its quantity raised — one
 * line per product, never two — and keeps its place; the slug is refreshed,
 * since the page that added it knows the current one. A cart with no room
 * left is returned as it was.
 */
export function addToCart(
  lines: readonly CartLine[],
  item: { readonly productId: string; readonly slug: string },
  quantity = 1,
): CartLine[] {
  const existing = lines.find((line) => line.productId === item.productId);
  if (existing) {
    return lines.map((line) =>
      line.productId === item.productId
        ? { ...line, slug: item.slug, quantity: clampQuantity(line.quantity + quantity) }
        : line,
    );
  }
  if (!canAdd(lines, item.productId)) return [...lines];
  return [
    ...lines,
    { productId: item.productId, slug: item.slug, quantity: clampQuantity(quantity) },
  ];
}

/** Set one line's quantity, within bounds. A product not in the cart is not added. */
export function setLineQuantity(
  lines: readonly CartLine[],
  productId: string,
  quantity: number,
): CartLine[] {
  return lines.map((line) =>
    line.productId === productId ? { ...line, quantity: clampQuantity(quantity) } : line,
  );
}

export function removeFromCart(lines: readonly CartLine[], productId: string): CartLine[] {
  return lines.filter((line) => line.productId !== productId);
}

/** Units in the cart: what the header's count shows. */
export function cartUnits(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * The stored text, as lines.
 *
 * Whatever is in storage was written by this code or by somebody editing it by
 * hand, and an older version of this code may have written it. So nothing is
 * assumed: text that is not JSON, a shape of another version, a line with no
 * usable id — each is dropped, never thrown. A repeated product is merged, and
 * every quantity is brought within bounds. The worst a damaged cart can do is
 * come back shorter.
 */
export function parseCart(raw: string | null | undefined): CartLine[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof data !== "object" || data === null) return [];
  const { v, lines } = data as { v?: unknown; lines?: unknown };
  if (v !== CART_VERSION || !Array.isArray(lines)) return [];

  let cart: CartLine[] = [];
  for (const entry of lines) {
    if (typeof entry !== "object" || entry === null) continue;
    const { productId, slug, quantity } = entry as Record<string, unknown>;
    if (!isProductId(productId)) continue;
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) continue;
    if (typeof quantity !== "number") continue;
    cart = addToCart(cart, { productId, slug }, clampQuantity(quantity));
  }
  return cart;
}

/** Lines, as the text `parseCart` reads. */
export function serializeCart(lines: readonly CartLine[]): string {
  return JSON.stringify({
    v: CART_VERSION,
    lines: lines.map(({ productId, slug, quantity }) => ({ productId, slug, quantity })),
  });
}
