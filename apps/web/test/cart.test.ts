import { describe, expect, it } from "vitest";
import {
  CART_STORAGE_KEY,
  MAX_CART_LINES,
  addToCart,
  cartUnits,
  clampQuantity,
  isProductId,
  parseCart,
  removeFromCart,
  serializeCart,
  setLineQuantity,
  type CartLine,
} from "@/lib/cart/cart";
import { SERVER_SNAPSHOT, createCartStore, type StorageLike } from "@/lib/cart/store";

/**
 * The cart in the browser: the rules for changing it (`lib/cart/cart.ts`) and
 * the store that keeps it in `localStorage` (`lib/cart/store.ts`).
 *
 * The store is built here with a storage and an event source of the test's
 * own, so the cases a browser produces — another tab writing, storage that
 * throws, a cart edited by hand — can be produced on purpose.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const id = (index: number) => `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`;

describe("clampQuantity", () => {
  it("keeps a quantity from 1 to 99, as the order form's lines do", () => {
    expect(clampQuantity(5)).toBe(5);
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(-3)).toBe(1);
    expect(clampQuantity(150)).toBe(99);
  });

  it("reads anything that is not a whole number as something sensible", () => {
    expect(clampQuantity(2.9)).toBe(2);
    expect(clampQuantity(Number.NaN)).toBe(1);
    expect(clampQuantity(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("isProductId", () => {
  it("accepts a uuid and nothing else", () => {
    expect(isProductId(A)).toBe(true);
    expect(isProductId(A.toUpperCase())).toBe(true);
    expect(isProductId("lavazza-crema")).toBe(false);
    expect(isProductId(`${A}'; drop table products;--`)).toBe(false);
    expect(isProductId(42)).toBe(false);
  });
});

describe("addToCart", () => {
  it("adds a product as a new line", () => {
    expect(addToCart([], { productId: A, slug: "a" }, 2)).toEqual([
      { productId: A, slug: "a", quantity: 2 },
    ]);
  });

  it("merges a product already in the cart, in its place, with the newest slug", () => {
    const lines = addToCart(
      addToCart(addToCart([], { productId: A, slug: "a" }), { productId: B, slug: "b" }),
      { productId: A, slug: "a-renamed" },
      3,
    );
    expect(lines).toEqual([
      { productId: A, slug: "a-renamed", quantity: 4 },
      { productId: B, slug: "b", quantity: 1 },
    ]);
  });

  it("caps the merged quantity at 99", () => {
    const lines = addToCart(
      [{ productId: A, slug: "a", quantity: 98 }],
      { productId: A, slug: "a" },
      5,
    );
    expect(lines[0]?.quantity).toBe(99);
  });

  it("adds nothing new to a full cart, but still raises a line it holds", () => {
    const full: CartLine[] = Array.from({ length: MAX_CART_LINES }, (_, index) => ({
      productId: id(index),
      slug: `p${index}`,
      quantity: 1,
    }));
    expect(addToCart(full, { productId: C, slug: "c" })).toEqual(full);
    expect(addToCart(full, { productId: id(0), slug: "p0" })[0]?.quantity).toBe(2);
  });

  it("does not change the cart it was given", () => {
    const lines: CartLine[] = [{ productId: A, slug: "a", quantity: 1 }];
    addToCart(lines, { productId: A, slug: "a" });
    expect(lines[0]?.quantity).toBe(1);
  });
});

describe("setLineQuantity and removeFromCart", () => {
  const lines: CartLine[] = [
    { productId: A, slug: "a", quantity: 1 },
    { productId: B, slug: "b", quantity: 2 },
  ];

  it("sets a quantity within bounds and adds no product", () => {
    expect(setLineQuantity(lines, B, 7)[1]?.quantity).toBe(7);
    expect(setLineQuantity(lines, B, 0)[1]?.quantity).toBe(1);
    expect(setLineQuantity(lines, B, 1000)[1]?.quantity).toBe(99);
    expect(setLineQuantity(lines, C, 3)).toEqual(lines);
  });

  it("removes a line and leaves the rest in order", () => {
    expect(removeFromCart(lines, A)).toEqual([{ productId: B, slug: "b", quantity: 2 }]);
    expect(removeFromCart(lines, C)).toEqual(lines);
  });

  it("counts units, not lines", () => {
    expect(cartUnits(lines)).toBe(3);
    expect(cartUnits([])).toBe(0);
  });
});

describe("parseCart and serializeCart", () => {
  const lines: CartLine[] = [
    { productId: A, slug: "a", quantity: 2 },
    { productId: B, slug: "b", quantity: 1 },
  ];

  it("read back what they write", () => {
    expect(parseCart(serializeCart(lines))).toEqual(lines);
  });

  it("store ids, slugs and quantities only", () => {
    const stored = JSON.parse(serializeCart(lines)) as { v: number; lines: object[] };
    expect(stored.v).toBe(1);
    for (const line of stored.lines)
      expect(Object.keys(line).sort()).toEqual(["productId", "quantity", "slug"]);
  });

  it("read nothing, text that is not JSON, and another version's shape as an empty cart", () => {
    expect(parseCart(null)).toEqual([]);
    expect(parseCart("")).toEqual([]);
    expect(parseCart("{not json")).toEqual([]);
    expect(parseCart("[1,2,3]")).toEqual([]);
    expect(parseCart(JSON.stringify({ v: 2, lines }))).toEqual([]);
    expect(parseCart(JSON.stringify({ v: 1, lines: "many" }))).toEqual([]);
  });

  it("drop the lines they cannot use and keep the rest", () => {
    const raw = JSON.stringify({
      v: 1,
      lines: [
        { productId: A, slug: "a", quantity: 2 },
        { productId: "not-a-uuid", slug: "x", quantity: 1 },
        { productId: B, slug: "", quantity: 1 },
        { productId: B, slug: "b", quantity: "2" },
        null,
        { productId: C, slug: "c", quantity: 1, price: "0.01" },
      ],
    });
    expect(parseCart(raw)).toEqual([
      { productId: A, slug: "a", quantity: 2 },
      // Whatever else a hand-edited line carries is not kept.
      { productId: C, slug: "c", quantity: 1 },
    ]);
  });

  it("merge a repeated product and bring every quantity within bounds", () => {
    const raw = JSON.stringify({
      v: 1,
      lines: [
        { productId: A, slug: "a", quantity: 60 },
        { productId: A, slug: "a", quantity: 60 },
        { productId: B, slug: "b", quantity: -4 },
      ],
    });
    expect(parseCart(raw)).toEqual([
      { productId: A, slug: "a", quantity: 99 },
      { productId: B, slug: "b", quantity: 1 },
    ]);
  });

  it("never hold more than the cart's limit", () => {
    const many = Array.from({ length: MAX_CART_LINES + 10 }, (_, index) => ({
      productId: id(index),
      slug: `p${index}`,
      quantity: 1,
    }));
    expect(parseCart(JSON.stringify({ v: 1, lines: many }))).toHaveLength(MAX_CART_LINES);
  });
});

/* -- the store ------------------------------------------------------------- */

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StorageLike & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  return storage;
}

function eventSource() {
  const listeners = new Set<(event: { key: string | null }) => void>();
  return {
    addEventListener: (_type: "storage", listener: (event: { key: string | null }) => void) =>
      void listeners.add(listener),
    removeEventListener: (_type: "storage", listener: (event: { key: string | null }) => void) =>
      void listeners.delete(listener),
    fire: (key: string | null) => {
      for (const listener of listeners) listener({ key });
    },
    get count() {
      return listeners.size;
    },
  };
}

const item = (productId: string, slug = "slug") => ({ productId, slug, name: `Продукт ${slug}` });

describe("the cart store", () => {
  it("is empty and not ready on the server, so hydration matches", () => {
    expect(SERVER_SNAPSHOT).toEqual({ ready: false, lines: [] });
  });

  it("reads the cart already in storage", () => {
    const storage = memoryStorage({
      [CART_STORAGE_KEY]: serializeCart([{ productId: A, slug: "a", quantity: 3 }]),
    });
    const store = createCartStore({ storage: () => storage });
    expect(store.getSnapshot()).toEqual({
      ready: true,
      lines: [{ productId: A, slug: "a", quantity: 3 }],
    });
  });

  it("hands React the same snapshot until the cart changes", () => {
    const store = createCartStore({ storage: () => memoryStorage() });
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    store.add(item(A));
    expect(store.getSnapshot()).not.toBe(first);
  });

  it("writes every change to storage and tells its subscribers", () => {
    const storage = memoryStorage();
    const store = createCartStore({ storage: () => storage });
    let heard = 0;
    store.subscribe(() => (heard += 1));

    store.add(item(A, "a"), 2);
    store.add(item(B, "b"));
    store.setQuantity(A, 5);
    store.remove(B);

    expect(parseCart(storage.data.get(CART_STORAGE_KEY))).toEqual([
      { productId: A, slug: "a", quantity: 5 },
    ]);
    expect(heard).toBe(4);
  });

  it("leaves no key behind once the cart is empty", () => {
    const storage = memoryStorage();
    const store = createCartStore({ storage: () => storage });
    expect(storage.data.has(CART_STORAGE_KEY)).toBe(false);
    store.add(item(A));
    expect(storage.data.has(CART_STORAGE_KEY)).toBe(true);
    store.clear();
    expect(storage.data.has(CART_STORAGE_KEY)).toBe(false);
    expect(store.getSnapshot().lines).toEqual([]);
  });

  it("announces every add, and says when a full cart took nothing", () => {
    const full = Array.from({ length: MAX_CART_LINES }, (_, index) => ({
      productId: id(index),
      slug: `p${index}`,
      quantity: 1,
    }));
    const store = createCartStore({
      storage: () => memoryStorage({ [CART_STORAGE_KEY]: serializeCart(full) }),
    });
    const events: Array<{ added: boolean; quantity: number }> = [];
    const stop = store.onAdded((event) => events.push(event));

    expect(store.add(item(C), 2).added).toBe(false);
    expect(store.add(item(id(3)), 2).added).toBe(true);
    stop();
    store.add(item(id(4)));

    expect(events).toEqual([
      expect.objectContaining({ productId: C, added: false, quantity: 2 }),
      expect.objectContaining({ productId: id(3), added: true, quantity: 2 }),
    ]);
  });

  it("follows another tab: a storage event for the cart is read, any other is ignored", () => {
    const storage = memoryStorage();
    const events = eventSource();
    const store = createCartStore({ storage: () => storage, events });
    let heard = 0;
    const stop = store.subscribe(() => (heard += 1));
    expect(store.getSnapshot().lines).toEqual([]);

    // The other tab writes, and the browser tells this one.
    storage.data.set(CART_STORAGE_KEY, serializeCart([{ productId: B, slug: "b", quantity: 4 }]));
    events.fire(CART_STORAGE_KEY);
    expect(store.getSnapshot().lines).toEqual([{ productId: B, slug: "b", quantity: 4 }]);

    events.fire("something-else");
    expect(heard).toBe(1);

    // Site data cleared in another tab.
    storage.data.clear();
    events.fire(null);
    expect(store.getSnapshot().lines).toEqual([]);

    stop();
    expect(events.count).toBe(0);
  });

  it("adds to what another tab wrote, not to what this one last saw", () => {
    const storage = memoryStorage();
    const store = createCartStore({ storage: () => storage });
    store.add(item(A, "a"));
    // Another tab added B, and this tab has not heard yet.
    storage.data.set(
      CART_STORAGE_KEY,
      serializeCart([
        { productId: A, slug: "a", quantity: 1 },
        { productId: B, slug: "b", quantity: 1 },
      ]),
    );
    store.add(item(A, "a"));
    expect(store.getSnapshot().lines).toEqual([
      { productId: A, slug: "a", quantity: 2 },
      { productId: B, slug: "b", quantity: 1 },
    ]);
  });

  it("reads storage that throws as an empty cart, and still works", () => {
    const store = createCartStore({
      storage: () => {
        throw new Error("SecurityError: storage is disabled");
      },
    });
    expect(store.getSnapshot()).toEqual({ ready: true, lines: [] });
    store.add(item(A, "a"), 2);
    expect(store.getSnapshot().lines).toEqual([{ productId: A, slug: "a", quantity: 2 }]);
  });

  it("keeps the cart in memory once a write fails, and does not read the stale copy back", () => {
    const storage = memoryStorage({
      [CART_STORAGE_KEY]: serializeCart([{ productId: A, slug: "a", quantity: 1 }]),
    });
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const store = createCartStore({ storage: () => storage });

    store.add(item(B, "b"));
    store.setQuantity(B, 3);

    expect(store.getSnapshot().lines).toEqual([
      { productId: A, slug: "a", quantity: 1 },
      { productId: B, slug: "b", quantity: 3 },
    ]);
  });

  it("reads a damaged cart as what can be saved of it", () => {
    const store = createCartStore({
      storage: () => memoryStorage({ [CART_STORAGE_KEY]: "{damaged" }),
    });
    expect(store.getSnapshot()).toEqual({ ready: true, lines: [] });
    store.add(item(A, "a"));
    expect(store.getSnapshot().lines).toHaveLength(1);
  });
});
