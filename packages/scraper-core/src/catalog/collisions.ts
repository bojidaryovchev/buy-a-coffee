import { type Logger, silentLogger } from "@catalog/shared";
import { type ExistingProduct, diffFields, productSnapshot } from "./diff.ts";
import {
  type KeyTiebreaker,
  identityToken,
  parseSplitSourceKey,
  splitDiscriminator,
  splitSourceKey,
} from "./identity.ts";
import type { NormalizedProduct } from "./normalize.ts";

/**
 * Two products at one address.
 *
 * Identity is source path + pack size (`identity.ts`), and the source breaks
 * it once: `/moreno-super-bar-1/` lists two 1 kg products, Moreno Espresso Bar
 * at €20.00 and Moreno Super Bar at €25.00. Both records get the key
 * `/moreno-super-bar-1/#1000g`. The sync used to keep whichever came first and
 * drop the other with a line in the log, which cost the shop a product on
 * every run — and, had the source ever listed the two the other way round,
 * would have handed the Espresso Bar's row, its URL and its order history the
 * Super Bar's name and a 25 % dearer price, as an ordinary update.
 *
 * Two steps put that right. Both are pure.
 *
 *   1. `resolveKeyCollision`, in discovery: records that share a key and are
 *      the same product collapse, as they always did. The rest are told apart
 *      by the source's product code when the listing states a different one
 *      for each, and by name otherwise; each then gets a key of its own,
 *      `/moreno-super-bar-1/#1000g~name:…`. The keys follow from the records
 *      alone, so the order the source lists them in changes nothing.
 *
 *   2. `settleKeyCollisions`, in the sync, once the stored catalog is known:
 *      every product at an address that is, or once was, shared is paired
 *      with the row it already has there — the Espresso Bar with the row under
 *      the plain key, the Super Bar with the row under its own — and takes
 *      that row's key. Keys are sticky: once stored, a product keeps its key
 *      while the source re-spaces its name, swaps the order, adds a product
 *      code, or lists it alone.
 *
 * "The same product" is one test, `identityToken`: one product code when both
 * sides have one, else one name with case, spacing and punctuation set aside —
 * the very normaliser the split key is built with, so a key and a match can
 * never disagree about a name.
 *
 * What neither step does is guess. Records with one code and one name that
 * differ in what the shop shows keep the first, exactly as before. A product
 * that matches no stored row at an address that is or was shared gets a key
 * of its own, never the plain key: an unrecognised product must not slide into
 * the row, the URL and the order history of the one the address belonged to.
 * When that happens while a stored product at the address disappears, the run
 * says so. The sync writes every collision to `sync_runs.metadata.keyCollisions`,
 * and the storefront's sync-health check raises each unresolved one the first
 * time it appears (`duplicate_key_conflict`).
 *
 * Every product at an address that has never been shared is untouched by both
 * steps: its key is the one `resolveProductIdentity` gives it, byte for byte.
 */

/**
 *   - `indistinguishable`  records with one code and one name differ in what
 *                          the shop shows — price, availability, photo,
 *                          description. The first is kept, as before, and the
 *                          shop's page depends on the source's order. Only
 *                          the source can put that right.
 *   - `unmatched`          at an address that is or was shared, a product we
 *                          store is not among the records listed there now,
 *                          and a product new to us is. A rename, or one
 *                          product replacing another: the sync does not pick,
 *                          so the stored one goes missing and the new one is
 *                          created under a key of its own. A person decides,
 *                          and links the two by hand if they are one product.
 */
export type KeyCollisionProblem = "indistinguishable" | "unmatched";

/** One product kept at a shared key, under the key it has after the run. */
export interface KeyCollisionProduct {
  readonly sourceKey: string;
  readonly name: string;
  readonly price: string | null;
}

/** A record dropped because nothing told it apart from a product that was kept. */
export interface KeyCollisionDropped {
  readonly name: string;
  readonly price: string | null;
  /** The product it was taken to be. */
  readonly keptAs: string;
  /** Snapshot fields in which it differs from that product. */
  readonly differsIn: string[];
}

/**
 * Records that shared one key, or a product listed alone at an address it
 * once shared, and what became of them. Written to
 * `sync_runs.metadata.keyCollisions` as is; the storefront reads `sourceKey`
 * and `unresolved` (`lib/sync-health.ts`), so those two keep their names.
 */
export interface KeyCollision {
  /** The key every record had by path and pack size. */
  readonly sourceKey: string;
  /** What told the products apart; null when nothing did and one was kept. */
  readonly tiebreaker: KeyTiebreaker | null;
  readonly products: KeyCollisionProduct[];
  readonly dropped: KeyCollisionDropped[];
  /** Why a person should look. Empty when the run settled it on its own. */
  readonly unresolved: KeyCollisionProblem[];
}

/**
 * Fields in which two records with one name may differ and still be one
 * product, merged without an alarm: the spelling of the name — the same name
 * to `identityToken` — and the categories, because the HTML fallback meets
 * every product listed in two categories that way. Any other difference
 * leaves the shop's page to the order the source lists the two in, and is
 * reported.
 */
const QUIET_FIELDS: ReadonlySet<string> = new Set(["name", "categoryKeys", "semanticHash"]);

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const summarise = (product: NormalizedProduct): KeyCollisionProduct => ({
  sourceKey: product.sourceKey,
  name: product.name,
  price: product.currentPrice?.amount ?? null,
});

/**
 * Settle the records discovery found under one key, in the source's order.
 *
 * Returns the products to keep and, when there was more than one distinct
 * record, the collision to report. Identical records collapse silently, as
 * they always have.
 *
 * The tie-breaker is chosen for the whole group, so every product at an
 * address is keyed the same way: the product code when the listing states one
 * for every record and no two are alike, else the name. Records whose
 * tie-breaker is the same are one product as far as anything can tell — the
 * same product typed twice, "150бр." beside "150 бр." — and the first is kept.
 * If that leaves one product, it keeps the plain key, exactly as before. If it
 * leaves several, each gets a split key, and they are returned in key order
 * rather than the source's.
 *
 * Only path-shaped keys split. An `id:` key names the source's own identifier
 * for one product, and two different records under it are a contradiction,
 * not two products.
 */
export function resolveKeyCollision(
  sourceKey: string,
  records: readonly NormalizedProduct[],
): { products: NormalizedProduct[]; collision: KeyCollision | null } {
  const distinct: NormalizedProduct[] = [];
  for (const record of records) {
    if (!distinct.some((kept) => kept.semanticHash === record.semanticHash)) distinct.push(record);
  }
  if (distinct.length <= 1) return { products: distinct, collision: null };

  const codes = distinct.map((record) => text(record.sku));
  const byCode =
    codes.every((code) => code !== null) &&
    new Set(codes.map((code) => splitDiscriminator("code", code as string))).size ===
      distinct.length;
  const tiebreaker: KeyTiebreaker = byCode ? "code" : "name";
  const discriminatorOf = (record: NormalizedProduct): string =>
    byCode
      ? splitDiscriminator("code", text(record.sku) as string)
      : splitDiscriminator("name", record.name);

  const splittable = sourceKey.startsWith("/");
  const clusters = new Map<string, NormalizedProduct[]>();
  for (const record of distinct) {
    const discriminator = splittable ? discriminatorOf(record) : "";
    const cluster = clusters.get(discriminator);
    if (cluster) cluster.push(record);
    else clusters.set(discriminator, [record]);
  }

  const split = clusters.size > 1;
  const groups = [...clusters.entries()].map(([discriminator, [kept, ...rest]]) => ({
    discriminator,
    kept: kept as NormalizedProduct,
    rest,
  }));
  if (split) {
    groups.sort((a, b) =>
      a.discriminator < b.discriminator ? -1 : a.discriminator > b.discriminator ? 1 : 0,
    );
  }

  const products = groups.map(({ discriminator, kept }) =>
    split ? { ...kept, sourceKey: splitSourceKey(sourceKey, discriminator) } : kept,
  );
  const dropped = groups.flatMap(({ kept, rest }, index) =>
    rest.map((record): KeyCollisionDropped => ({
      name: record.name,
      price: record.currentPrice?.amount ?? null,
      keptAs: (products[index] as NormalizedProduct).sourceKey,
      differsIn: diffFields(productSnapshot(kept), productSnapshot(record)).filter(
        (field) => field !== "semanticHash",
      ),
    })),
  );
  const unresolved: KeyCollisionProblem[] = dropped.some((record) =>
    record.differsIn.some((field) => !QUIET_FIELDS.has(field)),
  )
    ? ["indistinguishable"]
    : [];

  return {
    products,
    collision: {
      sourceKey,
      tiebreaker: split ? tiebreaker : null,
      products: products.map(summarise),
      dropped,
      unresolved,
    },
  };
}

export interface KeyedProducts {
  /** One per product, each under a key no other has. */
  readonly products: NormalizedProduct[];
  /** A key once for every record beyond its first, as discovery always reported. */
  readonly duplicateKeys: string[];
  readonly keyCollisions: KeyCollision[];
}

/**
 * Discovery's whole de-duplication: every valid record in, one product per
 * key out.
 *
 * A key with one record — almost all of them — passes through untouched, key
 * and all, in the source's order. A key with several goes through
 * `resolveKeyCollision`, and its products take the place of its first record.
 */
export function resolveDuplicateKeys(records: readonly NormalizedProduct[]): KeyedProducts {
  const byKey = new Map<string, NormalizedProduct[]>();
  const duplicateKeys: string[] = [];
  for (const record of records) {
    const group = byKey.get(record.sourceKey);
    if (group) {
      duplicateKeys.push(record.sourceKey);
      group.push(record);
    } else {
      byKey.set(record.sourceKey, [record]);
    }
  }

  const products: NormalizedProduct[] = [];
  const keyCollisions: KeyCollision[] = [];
  for (const [sourceKey, group] of byKey) {
    if (group.length === 1) {
      products.push(group[0] as NormalizedProduct);
      continue;
    }
    const resolved = resolveKeyCollision(sourceKey, group);
    products.push(...resolved.products);
    if (resolved.collision) keyCollisions.push(resolved.collision);
  }
  return { products, duplicateKeys, keyCollisions };
}

/**
 * The same product, as far as a stored row and a listed record can say: the
 * same product code when both have one, else the same name by
 * `identityToken` — the normaliser the split key itself is built with.
 * Nothing weaker: this decides which product a key, a slug and an order
 * history belong to.
 */
function sameProduct(stored: ExistingProduct, listed: NormalizedProduct): boolean {
  const storedCode = text(stored.sku);
  const listedCode = text(listed.sku);
  if (storedCode !== null && listedCode !== null) {
    return identityToken(storedCode) === identityToken(listedCode);
  }
  const storedName = typeof stored.snapshot.name === "string" ? stored.snapshot.name : "";
  const token = identityToken(storedName);
  return token !== "" && token === identityToken(listed.name);
}

/**
 * Pair the products listed at one address with the rows stored there.
 *
 * A product and a row match when the row's split key is the product's, or
 * `sameProduct` says so; a row still listed outranks one already removed. A
 * pair is made only when it is the single reading: the product matches that
 * row and no other, and no other product matches the row. Anything else is
 * left unpaired, and an unpaired product never takes a stored row's key.
 */
function pairAtAddress(
  listed: readonly NormalizedProduct[],
  rows: readonly ExistingProduct[],
): Map<NormalizedProduct, ExistingProduct> {
  const matches = (product: NormalizedProduct, row: ExistingProduct): boolean =>
    (parseSplitSourceKey(row.sourceKey) !== null && row.sourceKey === product.sourceKey) ||
    sameProduct(row, product);
  const candidates = new Map(
    listed.map((product) => {
      const all = rows.filter((row) => matches(product, row));
      const live = all.filter((row) => row.status !== "removed");
      return [product, live.length > 0 ? live : all] as const;
    }),
  );

  const pairs = new Map<NormalizedProduct, ExistingProduct>();
  for (const product of listed) {
    const rowsFor = candidates.get(product) ?? [];
    if (rowsFor.length !== 1) continue;
    const row = rowsFor[0] as ExistingProduct;
    const rivals = listed.filter(
      (other) => other !== product && (candidates.get(other) ?? []).includes(row),
    );
    if (rivals.length === 0) pairs.set(product, row);
  }
  return pairs;
}

/** The split key a product listed alone would have: by its code when the listing states one. */
function ownKey(plainKey: string, product: NormalizedProduct): string {
  const code = text(product.sku);
  return splitSourceKey(
    plainKey,
    code !== null ? splitDiscriminator("code", code) : splitDiscriminator("name", product.name),
  );
}

/**
 * Give every product at an address that is, or once was, shared the key of
 * the row it already has there.
 *
 * Discovery splits a shared key without knowing what is stored. Here, with the
 * stored catalog in hand, each product at such an address is paired with its
 * row (`pairAtAddress`) — the row under the plain key or one under a split
 * key — and takes that row's key:
 *
 *   - the Espresso Bar, stored under `/moreno-super-bar-1/#1000g` before the
 *     Super Bar was ever kept, stays there: same key, same row, unchanged;
 *   - a product whose name the source re-spaces or re-punctuates, or whose
 *     code the listing starts to state, keeps the key it has;
 *   - a product listed alone at an address it once shared keeps its own key.
 *     If the source moves the Espresso Bar to an address of its own, the Super
 *     Bar left behind stays the Super Bar's row.
 *
 * A product paired with nothing keeps the split key discovery gave it — or, if
 * it is alone at the address, gets one of its own. It never takes the plain
 * key: at an address with a history, an unrecognised product taking the plain
 * key would take the row the address belonged to, live or removed, name,
 * price and all. When a product new to us arrives while a stored one at the
 * address is no longer listed, the collision is reported `unmatched`.
 *
 * With nothing stored — a first sync — both products keep their split keys.
 * Addresses that have never been shared are never touched.
 */
export function settleKeyCollisions<
  T extends { readonly products: NormalizedProduct[]; readonly keyCollisions: KeyCollision[] },
>(discovery: T, existing: readonly ExistingProduct[], logger: Logger = silentLogger): T {
  const stored = new Map(existing.map((row) => [row.sourceKey, row]));
  const splitRows = new Map<string, ExistingProduct[]>();
  for (const row of existing) {
    const split = parseSplitSourceKey(row.sourceKey);
    if (!split) continue;
    const rows = splitRows.get(split.plainKey) ?? [];
    rows.push(row);
    splitRows.set(split.plainKey, rows);
  }

  const atAddress = new Map<string, NormalizedProduct[]>();
  for (const product of discovery.products) {
    const plainKey = parseSplitSourceKey(product.sourceKey)?.plainKey ?? product.sourceKey;
    const listed = atAddress.get(plainKey) ?? [];
    listed.push(product);
    atAddress.set(plainKey, listed);
  }

  const rekeyed = new Map<string, string>();
  const unmatched = new Set<string>();
  const recorded = new Set(discovery.keyCollisions.map((collision) => collision.sourceKey));
  const alone: KeyCollision[] = [];

  for (const [plainKey, listed] of atAddress) {
    const history = splitRows.get(plainKey) ?? [];
    const split = listed.some((product) => parseSplitSourceKey(product.sourceKey) !== null);
    if (!split && history.length === 0) continue;

    const holder = stored.get(plainKey);
    const rows = holder ? [holder, ...history] : history;
    const pairs = pairAtAddress(listed, rows);
    const keys = listed.map((product) => {
      const row = pairs.get(product);
      if (row) return row.sourceKey;
      return split ? product.sourceKey : ownKey(plainKey, product);
    });

    if (new Set(keys).size !== keys.length) {
      // Two products settling on one key: no reading of the evidence is safe.
      // Left as discovery keyed them, and a person is told.
      unmatched.add(plainKey);
      logger.warn("catalog.duplicate_key_unsettled", { sourceKey: plainKey, keys });
      continue;
    }
    listed.forEach((product, index) => {
      const key = keys[index] as string;
      if (key !== product.sourceKey) rekeyed.set(product.sourceKey, key);
    });

    const paired = new Set(pairs.values());
    const vanished = rows.filter((row) => row.status !== "removed" && !paired.has(row));
    const arrived = keys.filter((key) => !stored.has(key));
    if (vanished.length > 0 && arrived.length > 0) {
      unmatched.add(plainKey);
      logger.warn("catalog.duplicate_key_unmatched", {
        sourceKey: plainKey,
        stored: vanished.map((row) => row.sourceKey),
        arrived,
      });
    }

    const only = listed[0] as NormalizedProduct;
    if (!split && !recorded.has(plainKey) && keys[0] !== plainKey) {
      const settledAs = { ...summarise(only), sourceKey: keys[0] as string };
      alone.push({
        sourceKey: plainKey,
        tiebreaker: parseSplitSourceKey(settledAs.sourceKey)?.tiebreaker ?? null,
        products: [settledAs],
        dropped: [],
        unresolved: [],
      });
      logger.info("catalog.split_key_kept", { sourceKey: plainKey, keptKey: settledAs.sourceKey });
    }
  }

  if (rekeyed.size === 0 && unmatched.size === 0 && alone.length === 0) return discovery;

  const settledKey = (key: string): string => rekeyed.get(key) ?? key;
  return {
    ...discovery,
    products: discovery.products.map((product) =>
      rekeyed.has(product.sourceKey)
        ? { ...product, sourceKey: settledKey(product.sourceKey) }
        : product,
    ),
    keyCollisions: [...discovery.keyCollisions, ...alone].map((collision) => ({
      ...collision,
      products: collision.products.map((product) => ({
        ...product,
        sourceKey: settledKey(product.sourceKey),
      })),
      dropped: collision.dropped.map((record) => ({
        ...record,
        keptAs: settledKey(record.keptAs),
      })),
      unresolved:
        unmatched.has(collision.sourceKey) && !collision.unresolved.includes("unmatched")
          ? [...collision.unresolved, "unmatched"]
          : collision.unresolved,
    })),
  };
}

/** The collisions a person has to look at. */
export const unresolvedKeyCollisions = (collisions: readonly KeyCollision[]): KeyCollision[] =>
  collisions.filter((collision) => collision.unresolved.length > 0);
