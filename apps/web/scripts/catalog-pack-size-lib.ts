/**
 * Applying the pack-size rule to products already stored: the reading, the
 * plan and the write.
 *
 * The rule itself is `decidePackSize` in `@catalog/shared`, the same function
 * the sync's normalisation calls; this file only says where a stored row keeps
 * the two things the rule reads, and which columns hold its answer. It has no
 * entry point and opens no connection of its own (`catalog-pack-size.ts` is
 * the command line), so a test can run it against a private database.
 *
 * Nothing here contacts the source. A stored row already holds both of the
 * supplier's statements: its name (`products.name`) and its pack field, kept
 * verbatim in `source_data` by every sync there has ever been.
 */
import { eq, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { products } from "@catalog/db/schema";
import {
  type PackSizeConflict,
  decidePackSize,
  formatDecimal,
  normalizeLabel,
  packServings,
  parseDecimal,
  parsePackSizeConflict,
  parseWeight,
  pricePerServing,
  stripTrailingZeros,
} from "@catalog/shared";

/** The columns the rule decides, as a row holds them or should hold them. */
export interface PackColumns {
  /** `products.weight`: the pack size as text. */
  readonly weight: string | null;
  readonly weightValue: string | null;
  readonly weightUnit: string | null;
  readonly servings: string | null;
  readonly servingsEstimated: boolean | null;
  /** `source_data.weightCanonical`: what the sync's diff and move detection read. */
  readonly weightCanonical: string | null;
  /** `source_data.packSizeConflict`: what the admin's sync page lists. */
  readonly conflict: PackSizeConflict | null;
}

export interface PackSizeChange {
  readonly id: string;
  readonly sourceKey: string;
  /** The supplier's name: what the owner knows the product by. */
  readonly name: string;
  readonly slug: string;
  readonly price: string | null;
  /** The supplier's pack field, verbatim. */
  readonly packField: string | null;
  readonly stored: PackColumns;
  readonly planned: PackColumns;
  /** Price of one cup before and after, at four decimals; null when unknown. */
  readonly pricePerCup: { readonly stored: string | null; readonly planned: string | null };
}

export interface PackSizePlan {
  /** Products read. */
  readonly products: number;
  /** Rows whose stored pack size is not what the rule decides. */
  readonly changes: readonly PackSizeChange[];
  /**
   * Every product whose name and pack field disagree, corrected already or
   * not: what the owner is shown, and what only the supplier can put right.
   */
  readonly conflicts: ReadonlyArray<{
    readonly sourceKey: string;
    readonly name: string;
    readonly conflict: PackSizeConflict;
  }>;
}

/** `numeric` comes back padded ("18.0000"); the rule's own values are not. */
function plain(value: string | null): string | null {
  if (value === null) return null;
  try {
    return stripTrailingZeros(formatDecimal(parseDecimal(value)));
  } catch {
    return value;
  }
}

/**
 * The supplier's pack field, verbatim, from a stored row.
 *
 * `source_data.packField` is where the sync writes it now. A row stored
 * before that still has it: the listing record the sync read is spread into
 * `source_data`, pack field and all (`weight`). Only a row with neither — one
 * seeded for a test, or read from the HTML fallback, which has no pack field
 * of its own — falls back to the column, which until this rule existed held
 * the pack field unchanged.
 *
 * The order matters for running this twice: once a row is corrected, the
 * column holds the decided size, not the supplier's, and must not be read as
 * the supplier's statement again. A corrected row always carries `packField`.
 */
function storedPackField(
  sourceData: Record<string, unknown>,
  column: string | null,
): string | null {
  if (Object.hasOwn(sourceData, "packField")) {
    const recorded = sourceData.packField;
    return typeof recorded === "string" && recorded.trim() ? normalizeLabel(recorded) : null;
  }
  const listed = sourceData.weight;
  if (typeof listed === "string" && listed.trim()) return normalizeLabel(listed);
  return column && column.trim() ? normalizeLabel(column) : null;
}

/** What the rule decides for one stored product. */
export function plannedPackColumns(name: string, packField: string | null): PackColumns {
  const field = parseWeight(packField);
  const decision = decidePackSize(name, field);
  const size = decision.from === "name" ? decision.named : field;
  const servings = packServings(size?.value ?? null, size?.unit ?? null);
  return {
    weight: decision.from === "name" ? decision.label : packField,
    weightValue: size?.value ?? null,
    weightUnit: size?.unit ?? null,
    servings: servings?.exact ?? null,
    servingsEstimated: servings?.estimated ?? null,
    weightCanonical: size?.canonical ?? null,
    conflict: decision.conflict,
  };
}

const sameConflict = (a: PackSizeConflict | null, b: PackSizeConflict | null): boolean =>
  a === null || b === null ? a === b : a.inName === b.inName && a.inPackField === b.inPackField;

function sameColumns(stored: PackColumns, planned: PackColumns): boolean {
  return (
    stored.weight === planned.weight &&
    plain(stored.weightValue) === plain(planned.weightValue) &&
    stored.weightUnit === planned.weightUnit &&
    plain(stored.servings) === plain(planned.servings) &&
    stored.servingsEstimated === planned.servingsEstimated &&
    stored.weightCanonical === planned.weightCanonical &&
    sameConflict(stored.conflict, planned.conflict)
  );
}

const cupPrice = (price: string | null, columns: PackColumns): string | null =>
  pricePerServing(price, packServings(plain(columns.weightValue), columns.weightUnit));

/**
 * Read every product and plan what the rule would change.
 *
 * Every product, whatever its status: a removed product keeps its page, and
 * its page prints a price per cup like any other.
 */
export async function planPackSizes(
  db: Database,
  options: {
    /** Only this source site's products. Tests use it; production has one site. */
    readonly sourceSiteId?: string;
  } = {},
): Promise<PackSizePlan> {
  const rows = await db
    .select({
      id: products.id,
      sourceKey: products.sourceKey,
      name: products.name,
      slug: products.slug,
      price: products.currentPrice,
      weight: products.weight,
      weightValue: products.weightValue,
      weightUnit: products.weightUnit,
      servings: products.servings,
      servingsEstimated: products.servingsEstimated,
      sourceData: products.sourceData,
    })
    .from(products)
    .where(options.sourceSiteId ? eq(products.sourceSiteId, options.sourceSiteId) : undefined)
    .orderBy(products.name, products.sourceKey);

  const changes: PackSizeChange[] = [];
  const conflicts: Array<PackSizePlan["conflicts"][number]> = [];
  for (const row of rows) {
    const sourceData = (row.sourceData ?? {}) as Record<string, unknown>;
    const packField = storedPackField(sourceData, row.weight);
    const canonical = sourceData.weightCanonical;
    const stored: PackColumns = {
      weight: row.weight,
      weightValue: row.weightValue,
      weightUnit: row.weightUnit,
      servings: row.servings,
      servingsEstimated: row.servingsEstimated,
      weightCanonical: typeof canonical === "string" && canonical !== "" ? canonical : null,
      conflict: parsePackSizeConflict(sourceData.packSizeConflict),
    };
    const planned = plannedPackColumns(row.name, packField);
    if (planned.conflict) {
      conflicts.push({ sourceKey: row.sourceKey, name: row.name, conflict: planned.conflict });
    }
    if (sameColumns(stored, planned)) continue;
    changes.push({
      id: row.id,
      sourceKey: row.sourceKey,
      name: row.name,
      slug: row.slug,
      price: row.price,
      packField,
      stored,
      planned,
      pricePerCup: { stored: cupPrice(row.price, stored), planned: cupPrice(row.price, planned) },
    });
  }
  return { products: rows.length, changes, conflicts };
}

/**
 * Write a plan, in one transaction.
 *
 * Exactly the columns the sync's normalisation would have written for the
 * pack size, and the three keys of `source_data` that go with them; the rest
 * of `source_data` is merged over, not replaced.
 *
 * Two things are deliberately left alone. `semantic_hash` is the sync's hash
 * of the listing record and only the sync can compute it, so the first sync
 * after a correction made here records the product once more as updated
 * (field `semanticHash`) and then settles. `last_changed_at` tracks changes
 * at the source, and the source has not changed.
 */
export async function applyPackSizes(db: Database, plan: PackSizePlan): Promise<number> {
  if (plan.changes.length === 0) return 0;
  await db.transaction(async (tx) => {
    for (const change of plan.changes) {
      const { planned } = change;
      const recorded = JSON.stringify({
        weightCanonical: planned.weightCanonical,
        packField: change.packField,
        packSizeConflict: planned.conflict,
      });
      await tx
        .update(products)
        .set({
          weight: planned.weight,
          weightValue: planned.weightValue,
          weightUnit: planned.weightUnit,
          servings: planned.servings,
          servingsEstimated: planned.servingsEstimated,
          sourceData: sql`coalesce(${products.sourceData}, '{}'::jsonb) || ${recorded}::jsonb`,
        })
        .where(eq(products.id, change.id));
    }
  });
  return plan.changes.length;
}
