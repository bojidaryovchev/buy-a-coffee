import { type Logger, normalizeLabel, silentLogger } from "@catalog/shared";
import { type ExistingProduct, diffFields, productSnapshot } from "./diff.ts";
import {
  type KeyTiebreaker,
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
 *      the plain key goes back to the product that already holds it, so the
 *      Espresso Bar keeps its key, its id and its slug, and only the Super Bar
 *      is new.
 *
 * What neither step does is guess. Records that share a code and a name but
 * not a price cannot be told apart, so the first is kept, exactly as before,
 * and the run records it as unresolved; so does a stored product at a split
 * address that matches none of the records there while a new one appears.
 * The sync writes every collision to `sync_runs.metadata.keyCollisions`, and
 * the storefront's sync-health check raises the unresolved ones
 * (`duplicate_key_conflict`).
 *
 * Every product that does not share its key is untouched by both steps: its
 * key is the one `resolveProductIdentity` gives it, byte for byte.
 */

/**
 *   - `indistinguishable`  records with one code and one name differ in price
 *                          or availability; the first is kept, as before, and
 *                          which price the shop shows depends on the source's
 *                          order.
 *   - `unmatched`          a product stored under this key is not among the
 *                          records the source lists there now, and one of them
 *                          is new to us. A rename, or one product replacing
 *                          another: the sync does not pick, so the stored one
 *                          goes missing and the new one is created.
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
 * Records that shared one key, and what became of them. Written to
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
 * Snapshot fields that make up the offer. Two records that disagree on one of
 * these and cannot be told apart leave the shop's price to the source's order;
 * records that disagree only on a category or a description do not, and are
 * merged without an alarm — the HTML fallback meets every product listed in
 * two categories that way.
 */
const OFFER_FIELDS: ReadonlySet<string> = new Set([
  "currentPrice",
  "oldPrice",
  "currency",
  "availability",
]);

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const nameKey = (value: unknown): string =>
  typeof value === "string" ? normalizeLabel(value).toLowerCase() : "";

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
 * tie-breaker is the same are one product as far as anything can tell; the
 * first is kept and the rest are dropped. If that leaves one product, it keeps
 * the plain key, exactly as before. If it leaves several, each gets a split
 * key, and they are returned in key order rather than the source's.
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
    record.differsIn.some((field) => OFFER_FIELDS.has(field)),
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
 * same product code when both have one, else the same name. Nothing weaker —
 * this decides which product a key, a slug and an order history belong to.
 */
function sameProduct(stored: ExistingProduct, listed: NormalizedProduct): boolean {
  const storedCode = text(stored.sku);
  const listedCode = text(listed.sku);
  if (storedCode !== null && listedCode !== null) return storedCode === listedCode;
  return nameKey(stored.snapshot.name) === nameKey(listed.name);
}

/**
 * Give split keys back to the products that already hold them.
 *
 * Discovery splits a shared key without knowing what is stored, so none of
 * the products at it keeps the plain key. Here, with the stored catalog in
 * hand:
 *
 *   - a product split in this run that is the one already stored under the
 *     plain key takes that key back. The Espresso Bar was stored as
 *     `/moreno-super-bar-1/#1000g` before the Super Bar was ever kept, and it
 *     stays there: same key, same row, an unchanged product. A product whose
 *     split key is stored already keeps it.
 *   - a product listed alone at an address it once shared, whose stored row
 *     is under a split key, keeps that key — unless it is the product under
 *     the plain key. If the source moves the Espresso Bar to an address of its
 *     own, the Super Bar left behind must not slide into the Espresso Bar's
 *     row.
 *
 * "Is the one" is `sameProduct`: one code, or one name. Two candidates, or
 * none, and nobody takes the plain key: the stored product goes missing, the
 * new one is created, and when that happens beside a new arrival the
 * collision is reported `unmatched`. A product alone that matches nothing
 * keeps the plain key, as every product always has.
 *
 * With nothing stored — a first sync — nothing changes, so both products keep
 * their split keys. Keys outside a collision are never touched.
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

  const members = new Map<string, NormalizedProduct[]>();
  for (const product of discovery.products) {
    const split = parseSplitSourceKey(product.sourceKey);
    if (!split) continue;
    const group = members.get(split.plainKey) ?? [];
    group.push(product);
    members.set(split.plainKey, group);
  }

  const rekeyed = new Map<string, string>();
  const unmatched = new Set<string>();

  for (const [plainKey, group] of members) {
    const holder = stored.get(plainKey);
    if (holder) {
      const claimants = group.filter(
        (product) => !stored.has(product.sourceKey) && sameProduct(holder, product),
      );
      if (claimants.length === 1) {
        rekeyed.set((claimants[0] as NormalizedProduct).sourceKey, plainKey);
      }
    }

    const settled = new Set(
      group.map((product) => rekeyed.get(product.sourceKey) ?? product.sourceKey),
    );
    const vanished = [...(holder ? [holder] : []), ...(splitRows.get(plainKey) ?? [])].filter(
      (row) => row.status !== "removed" && !settled.has(row.sourceKey),
    );
    const arrived = [...settled].filter((key) => !stored.has(key));
    if (vanished.length > 0 && arrived.length > 0) {
      unmatched.add(plainKey);
      logger.warn("catalog.duplicate_key_unmatched", {
        sourceKey: plainKey,
        stored: vanished.map((row) => row.sourceKey),
        arrived,
      });
    }
  }

  for (const product of discovery.products) {
    const rows = splitRows.get(product.sourceKey);
    if (!rows) continue;
    const holder = stored.get(product.sourceKey);
    if (holder && sameProduct(holder, product)) continue;
    const matches = rows.filter((row) => sameProduct(row, product));
    if (matches.length !== 1) continue;
    const to = (matches[0] as ExistingProduct).sourceKey;
    rekeyed.set(product.sourceKey, to);
    logger.info("catalog.split_key_kept", { sourceKey: product.sourceKey, keptKey: to });
  }

  if (rekeyed.size === 0 && unmatched.size === 0) return discovery;

  const settledKey = (key: string): string => rekeyed.get(key) ?? key;
  return {
    ...discovery,
    products: discovery.products.map((product) =>
      rekeyed.has(product.sourceKey)
        ? { ...product, sourceKey: settledKey(product.sourceKey) }
        : product,
    ),
    keyCollisions: discovery.keyCollisions.map((collision) => ({
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
