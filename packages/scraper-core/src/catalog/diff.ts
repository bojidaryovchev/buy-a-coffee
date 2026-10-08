import { type MoveMatch, type MoveSignal, type UnresolvedMove, pairMoves } from "./moves.ts";
import type { NormalizedProduct } from "./normalize.ts";

export type { MoveMatch, MovePair, MoveSignal, UnresolvedMove } from "./moves.ts";

/**
 * Catalog diffing and reconciliation.
 *
 * Pure functions only: no database, no network, no clock. That is what makes
 * the dangerous behaviour — mass removal — exhaustively testable.
 */

export type ChangeType =
  "created" | "updated" | "unchanged" | "marked_missing" | "removed" | "restored" | "moved";

export type ProductStatus = "active" | "missing" | "removed";

/** The subset of stored state the diff needs. */
export interface ExistingProduct {
  readonly id: string;
  readonly sourceKey: string;
  /** Used to recognise a renamed URL. Derived from `sourceKey` when absent. */
  readonly sourcePath?: string | null;
  readonly semanticHash: string;
  readonly status: ProductStatus;
  readonly consecutiveMissingCount: number;
  /**
   * The product code read from the source's product page, if it has been
   * read. Evidence for move detection only: it is not in `snapshot`, because
   * the listing being diffed does not carry it and its absence there is not a
   * change.
   */
  readonly sku?: string | null;
  /** Current values, used to describe what changed. */
  readonly snapshot: Record<string, unknown>;
}

/** Where a moved product came from, and what convinced the diff it is the same one. */
export interface MoveOrigin {
  readonly sourceKey: string;
  readonly matchedBy: MoveMatch;
  readonly decidedBy: MoveSignal | null;
}

export interface ProductChange {
  /** For a `moved` change this is the key the product has now. */
  readonly sourceKey: string;
  readonly productId: string | null;
  readonly changeType: ChangeType;
  readonly changedFields: string[];
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  /** Reconciliation state to write. */
  readonly nextStatus: ProductStatus;
  readonly nextMissingCount: number;
  readonly product: NormalizedProduct | null;
  /** Set on `moved` changes only. */
  readonly movedFrom: MoveOrigin | null;
}

export interface DiffResult {
  readonly changes: ProductChange[];
  readonly created: ProductChange[];
  readonly updated: ProductChange[];
  readonly unchanged: ProductChange[];
  readonly missing: ProductChange[];
  readonly removed: ProductChange[];
  readonly restored: ProductChange[];
  /** Existing rows whose source key changed; they keep their id and slug. */
  readonly moved: ProductChange[];
  /** Possible renames that were too ambiguous to act on. Reported, never applied. */
  readonly unresolvedMoves: UnresolvedMove[];
  readonly counts: Record<ChangeType, number>;
}

export interface DiffOptions {
  /** Successful absences needed before a product is marked removed. */
  readonly missingThreshold: number;
  /**
   * Product codes for discovered products that match no stored key, by source
   * key. Looked up by the caller before diffing (see `enrich.ts`) and handed
   * in as data, so this module stays free of I/O.
   */
  readonly discoveredSkus?: ReadonlyMap<string, string>;
}

/**
 * Serialise with object keys in a fixed order.
 *
 * One side of every comparison has been through a `jsonb` column, which does
 * not keep key order. Without this, `{ decaf, aromas }` and `{ aromas, decaf }`
 * read as a change to `attributes` on every product whose hash moved. Arrays
 * keep their order: there it can carry meaning.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : inner,
  );
}

/** Compare two snapshots and name the fields that differ. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (stableStringify(before[key] ?? null) !== stableStringify(after[key] ?? null)) {
      changed.push(key);
    }
  }
  return changed.sort();
}

/** Business-relevant snapshot stored on both sides of an audit record. */
export function productSnapshot(product: NormalizedProduct): Record<string, unknown> {
  return {
    name: product.name,
    currentPrice: product.currentPrice?.amount ?? null,
    oldPrice: product.oldPrice?.amount ?? null,
    currency: product.currency,
    availability: product.availability,
    brandKey: product.brandKey,
    categoryKeys: [...product.categoryKeys].sort(),
    weight: product.weight?.canonical ?? null,
    // No `sku`: the product code is written by enrichment, not by the listing,
    // so comparing it here would report it as removed on every content change.
    gtin: product.gtin,
    attributes: product.attributes,
    imageUrls: [...product.sourceImageUrls].sort(),
    descriptionText: product.descriptionText,
    semanticHash: product.semanticHash,
  };
}

/**
 * Reconcile discovered products against stored state.
 *
 * Absence never deletes on its own: it increments a counter, and only a run
 * of `missingThreshold` consecutive successful absences promotes a product to
 * `removed`. A product that reappears resets the counter immediately.
 *
 * A product that vanishes under one key while its twin appears under another
 * is one product whose URL was renamed. Those are paired first (see
 * `moves.ts`) and reported as `moved`, so that neither half is counted as an
 * absence or a creation — which is also what keeps a mass rename from looking
 * like a mass removal to the circuit breaker.
 */
export function diffCatalog(
  discovered: readonly NormalizedProduct[],
  existing: readonly ExistingProduct[],
  options: DiffOptions,
): DiffResult {
  const threshold = Math.max(1, options.missingThreshold);
  const existingByKey = new Map(existing.map((product) => [product.sourceKey, product]));
  const seenKeys = new Set(discovered.map((product) => product.sourceKey));
  const changes: ProductChange[] = [];

  const pairing = pairMoves(
    existing.filter((product) => !seenKeys.has(product.sourceKey)),
    discovered.filter((product) => !existingByKey.has(product.sourceKey)),
    options.discoveredSkus ? { discoveredSkus: options.discoveredSkus } : {},
  );
  const moveByNewKey = new Map(pairing.pairs.map((pair) => [pair.product.sourceKey, pair]));
  const movedIds = new Set(pairing.pairs.map((pair) => pair.existing.id));

  for (const product of discovered) {
    const previous = existingByKey.get(product.sourceKey);
    const after = productSnapshot(product);

    const move = previous ? undefined : moveByNewKey.get(product.sourceKey);
    if (move) {
      const origin = move.existing;
      const wasAbsent = origin.status !== "active" || origin.consecutiveMissingCount > 0;
      const contentChanged = origin.semanticHash !== product.semanticHash;
      // A rename and an edit can land in the same run. The row moves, and
      // whatever else changed is recorded on the same audit record.
      const changedFields = new Set(["sourceKey"]);
      if (contentChanged) {
        for (const field of diffFields(origin.snapshot, after)) changedFields.add(field);
      }
      if (wasAbsent) changedFields.add("status");

      changes.push({
        sourceKey: product.sourceKey,
        productId: origin.id,
        changeType: "moved",
        changedFields: [...changedFields].sort(),
        before: {
          ...origin.snapshot,
          sourceKey: origin.sourceKey,
          ...(wasAbsent ? { status: origin.status } : {}),
        },
        after: {
          ...after,
          sourceKey: product.sourceKey,
          ...(wasAbsent ? { status: "active" } : {}),
          move: { matchedBy: move.matchedBy, decidedBy: move.decidedBy },
        },
        nextStatus: "active",
        nextMissingCount: 0,
        product,
        movedFrom: {
          sourceKey: origin.sourceKey,
          matchedBy: move.matchedBy,
          decidedBy: move.decidedBy,
        },
      });
      continue;
    }

    if (!previous) {
      changes.push({
        sourceKey: product.sourceKey,
        productId: null,
        changeType: "created",
        changedFields: Object.keys(after).sort(),
        before: null,
        after,
        nextStatus: "active",
        nextMissingCount: 0,
        product,
        movedFrom: null,
      });
      continue;
    }

    const wasAbsent = previous.status !== "active" || previous.consecutiveMissingCount > 0;
    const contentChanged = previous.semanticHash !== product.semanticHash;

    if (wasAbsent) {
      // Reappearing outranks "changed": the important event is that the
      // product is back, and the field diff rides along with it.
      changes.push({
        sourceKey: product.sourceKey,
        productId: previous.id,
        changeType: "restored",
        changedFields: contentChanged ? diffFields(previous.snapshot, after) : [],
        before: previous.snapshot,
        after,
        nextStatus: "active",
        nextMissingCount: 0,
        product,
        movedFrom: null,
      });
      continue;
    }

    if (contentChanged) {
      changes.push({
        sourceKey: product.sourceKey,
        productId: previous.id,
        changeType: "updated",
        changedFields: diffFields(previous.snapshot, after),
        before: previous.snapshot,
        after,
        nextStatus: "active",
        nextMissingCount: 0,
        product,
        movedFrom: null,
      });
      continue;
    }

    changes.push({
      sourceKey: product.sourceKey,
      productId: previous.id,
      changeType: "unchanged",
      changedFields: [],
      before: previous.snapshot,
      after,
      nextStatus: "active",
      nextMissingCount: 0,
      product,
      movedFrom: null,
    });
  }

  for (const previous of existing) {
    if (seenKeys.has(previous.sourceKey)) continue;
    // Paired with a product that appeared under a new key: not an absence.
    if (movedIds.has(previous.id)) continue;
    // Already removed: nothing further to do, and no repeated audit noise.
    if (previous.status === "removed") continue;

    const nextMissingCount = previous.consecutiveMissingCount + 1;
    const shouldRemove = nextMissingCount >= threshold;

    changes.push({
      sourceKey: previous.sourceKey,
      productId: previous.id,
      changeType: shouldRemove ? "removed" : "marked_missing",
      changedFields: ["status", "consecutiveMissingCount"],
      before: {
        ...previous.snapshot,
        status: previous.status,
        consecutiveMissingCount: previous.consecutiveMissingCount,
      },
      after: {
        ...previous.snapshot,
        status: shouldRemove ? "removed" : "missing",
        consecutiveMissingCount: nextMissingCount,
      },
      nextStatus: shouldRemove ? "removed" : "missing",
      nextMissingCount,
      product: null,
      movedFrom: null,
    });
  }

  const byType = (type: ChangeType): ProductChange[] =>
    changes.filter((change) => change.changeType === type);

  const created = byType("created");
  const updated = byType("updated");
  const unchanged = byType("unchanged");
  const missing = byType("marked_missing");
  const removed = byType("removed");
  const restored = byType("restored");
  const moved = byType("moved");

  return {
    changes,
    created,
    updated,
    unchanged,
    missing,
    removed,
    restored,
    moved,
    unresolvedMoves: pairing.unresolved,
    counts: {
      created: created.length,
      updated: updated.length,
      unchanged: unchanged.length,
      marked_missing: missing.length,
      removed: removed.length,
      restored: restored.length,
      moved: moved.length,
    },
  };
}
