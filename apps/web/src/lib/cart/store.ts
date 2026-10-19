import { useSyncExternalStore } from "react";
import {
  CART_STORAGE_KEY,
  addToCart,
  canAdd,
  parseCart,
  removeFromCart,
  serializeCart,
  setLineQuantity,
  type CartLine,
} from "./cart";

/**
 * The cart in the browser: `localStorage`, read and written, and told to React.
 *
 * Why `localStorage`: the shop has no accounts and promises no cookies (the
 * cookie policy), and a cart has to survive a closed tab. It holds product ids
 * and quantities — nothing about the person — and is only created when they
 * add something, and removed once the order is sent.
 *
 * Three things this has to get right:
 *
 *  - **Hydration.** The server has no cart. Every page is rendered with an
 *    empty one (`ready: false`), and the browser's is read after hydration, so
 *    the HTML the server sent and the first render in the browser agree.
 *    `useSyncExternalStore` does that switch; a component that must not say
 *    "your cart is empty" before it knows waits for `ready`.
 *  - **Other tabs.** Adding in one tab updates the count in every other: the
 *    browser fires `storage` there, and the store re-reads.
 *  - **Storage that is not there.** A private window, a full quota, a browser
 *    with storage switched off: reads come back empty and writes throw. The
 *    cart then lives in memory for as long as the page does, and nothing a
 *    customer does ever fails because of it.
 */

/** What the store needs of `localStorage`; a test passes its own. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Where `storage` events arrive: the window, or a test's stand-in. */
export interface StorageEvents {
  addEventListener(type: "storage", listener: (event: { key: string | null }) => void): void;
  removeEventListener(type: "storage", listener: (event: { key: string | null }) => void): void;
}

export interface CartSnapshot {
  /** False until the browser's cart has been read: on the server, and during hydration. */
  readonly ready: boolean;
  readonly lines: readonly CartLine[];
}

/** A product just added, for the notice that says so (`components/cart/cart-notice.tsx`). */
export interface AddedEvent {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  /** False when the cart had no room left and nothing was added. */
  readonly added: boolean;
}

export interface CartStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): CartSnapshot;
  add(item: { productId: string; slug: string; name: string }, quantity?: number): AddedEvent;
  setQuantity(productId: string, quantity: number): void;
  remove(productId: string): void;
  clear(): void;
  /** Hears every `add`, so one notice can serve every button on the page. */
  onAdded(listener: (event: AddedEvent) => void): () => void;
}

/** The server's snapshot, and the one every render sees until the cart is read. */
export const SERVER_SNAPSHOT: CartSnapshot = Object.freeze({ ready: false, lines: [] });

export function createCartStore(options: {
  /** Called on each use, so a storage that throws on access is caught every time. */
  storage: () => StorageLike | null;
  events?: StorageEvents | null;
}): CartStore {
  const listeners = new Set<() => void>();
  const addedListeners = new Set<(event: AddedEvent) => void>();
  let snapshot: CartSnapshot | null = null;
  /*
   * Set once a write has failed. From then on storage is not read either: it
   * holds an older cart than the one in memory, and reading it back would undo
   * what the customer just did.
   */
  let memoryOnly = false;

  /** The cart in storage, or null when there is no storage to read. */
  const read = (): CartSnapshot | null => {
    if (memoryOnly) return null;
    try {
      const storage = options.storage();
      if (!storage) return null;
      return { ready: true, lines: parseCart(storage.getItem(CART_STORAGE_KEY)) };
    } catch {
      // Unreadable storage is an empty cart, not a broken page.
      return null;
    }
  };

  /** The snapshot React sees: the same object until the cart changes. */
  const current = (): CartSnapshot => (snapshot ??= read() ?? { ready: true, lines: [] });

  /** The newest cart, before a change: another tab may have written since this one looked. */
  const latest = (): readonly CartLine[] => {
    const fresh = read();
    if (fresh) snapshot = fresh;
    return current().lines;
  };

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const write = (lines: CartLine[]) => {
    snapshot = { ready: true, lines };
    try {
      const storage = options.storage();
      // An empty cart leaves nothing behind: the key exists only while it holds something.
      if (lines.length === 0) storage?.removeItem(CART_STORAGE_KEY);
      else storage?.setItem(CART_STORAGE_KEY, serializeCart(lines));
    } catch {
      // Kept in memory for this page; see the note on storage above.
      memoryOnly = true;
    }
    emit();
  };

  const onStorage = (event: { key: string | null }) => {
    // `null` is another tab clearing all storage for the site.
    if (event.key !== null && event.key !== CART_STORAGE_KEY) return;
    const fresh = read();
    if (!fresh) return;
    snapshot = fresh;
    emit();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) options.events?.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) options.events?.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot: current,
    add(item, quantity = 1) {
      const lines = latest();
      const added = canAdd(lines, item.productId);
      if (added) write(addToCart(lines, { productId: item.productId, slug: item.slug }, quantity));
      const event: AddedEvent = { productId: item.productId, name: item.name, quantity, added };
      for (const listener of addedListeners) listener(event);
      return event;
    },
    setQuantity(productId, quantity) {
      write(setLineQuantity(latest(), productId, quantity));
    },
    remove(productId) {
      write(removeFromCart(latest(), productId));
    },
    clear() {
      write([]);
    },
    onAdded(listener) {
      addedListeners.add(listener);
      return () => addedListeners.delete(listener);
    },
  };
}

/* -- the page's one store -------------------------------------------------- */

const browserStorage = (): StorageLike | null =>
  typeof window === "undefined" ? null : window.localStorage;

/** The store every component on the page shares. Inert on the server. */
export const cartStore: CartStore = createCartStore({
  storage: browserStorage,
  events: typeof window === "undefined" ? null : window,
});

const getServerSnapshot = () => SERVER_SNAPSHOT;

/** The cart, for a component. `ready` is false on the server and while hydrating. */
export function useCart(store: CartStore = cartStore): CartSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
}

const noSubscription = () => () => {};

/**
 * True once the component is hydrated in a browser; false on the server and in
 * the hydrating render. For a control that is a link without JavaScript and a
 * button with it.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
