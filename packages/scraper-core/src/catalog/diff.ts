import type { NormalizedProduct } from "./normalize.ts";

/**
 * Catalog diffing and reconciliation.
 *
 * Pure functions only: no database, no network, no clock. That is what makes
 * the dangerous behaviour — mass removal — exhaustively testable.
 */

export type ChangeType = "created" | "updated" | "unchanged" | "marked_missing" | "removed" | "restored";

export type ProductStatus = "active" | "missing" | "removed";

/** The subset of stored state the diff needs. */
export interface ExistingProduct {
  readonly id: string;
  readonly sourceKey: string;
  readonly semanticHash: string;
  readonly status: ProductStatus;
  readonly consecutiveMissingCount: number;
  /** Current values, used to describe what changed. */
  readonly snapshot: Record<string, unknown>;
}

export interface ProductChange {
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
}

export interface DiffResult {
  readonly changes: ProductChange[];
  readonly created: ProductChange[];
  readonly updated: ProductChange[];
  readonly unchanged: ProductChange[];
  readonly missing: ProductChange[];
  readonly removed: ProductChange[];
  readonly restored: ProductChange[];
  readonly counts: Record<ChangeType, number>;
}

export interface DiffOptions {
  /** Successful absences needed before a product is marked removed. */
  readonly missingThreshold: number;
}

/** Compare two snapshots and name the fields that differ. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
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
    sku: product.sku,
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
 */
export function diffCatalog(
  discovered: readonly NormalizedProduct[],
  existing: readonly ExistingProduct[],
  options: DiffOptions,
): DiffResult {
  const threshold = Math.max(1, options.missingThreshold);
  const existingByKey = new Map(existing.map((product) => [product.sourceKey, product]));
  const seenKeys = new Set<string>();
  const changes: ProductChange[] = [];

  for (const product of discovered) {
    seenKeys.add(product.sourceKey);
    const previous = existingByKey.get(product.sourceKey);
    const after = productSnapshot(product);

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
    });
  }

  for (const previous of existing) {
    if (seenKeys.has(previous.sourceKey)) continue;
    // Already removed: nothing further to do, and no repeated audit noise.
    if (previous.status === "removed") continue;

    const nextMissingCount = previous.consecutiveMissingCount + 1;
    const shouldRemove = nextMissingCount >= threshold;

    changes.push({
      sourceKey: previous.sourceKey,
      productId: previous.id,
      changeType: shouldRemove ? "removed" : "marked_missing",
      changedFields: ["status", "consecutiveMissingCount"],
      before: { ...previous.snapshot, status: previous.status, consecutiveMissingCount: previous.consecutiveMissingCount },
      after: {
        ...previous.snapshot,
        status: shouldRemove ? "removed" : "missing",
        consecutiveMissingCount: nextMissingCount,
      },
      nextStatus: shouldRemove ? "removed" : "missing",
      nextMissingCount,
      product: null,
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

  return {
    changes,
    created,
    updated,
    unchanged,
    missing,
    removed,
    restored,
    counts: {
      created: created.length,
      updated: updated.length,
      unchanged: unchanged.length,
      marked_missing: missing.length,
      removed: removed.length,
      restored: restored.length,
    },
  };
}
