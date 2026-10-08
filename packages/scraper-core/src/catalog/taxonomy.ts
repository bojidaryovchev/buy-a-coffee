import { slugify } from "@catalog/shared";

/**
 * Brand and category reconciliation.
 *
 * Brands and categories have the same problem products have: the source
 * renames their slugs. `kapsuli` became `kafe-kapsuli`; `biancafe` became
 * `biancaffe`. Matched on slug alone, each rename would insert a second row,
 * re-point every product and child category at it, and leave the original —
 * with its storefront slug, which is an indexed URL — behind and empty.
 *
 * Unlike products, the source gives every brand and category a stable numeric
 * id. So the match is: source id first, source key second. No fingerprinting
 * and no guessing.
 *
 * Pure: this module decides; `repository.ts` writes what it decided.
 */

export type EntityStatus = "active" | "missing" | "removed";

export interface ExistingEntity {
  readonly id: string;
  readonly sourceKey: string;
  readonly sourceId: string | null;
  readonly slug: string;
  readonly status: EntityStatus;
}

export interface IncomingEntity {
  readonly sourceKey: string;
  readonly sourceId: string | null;
  readonly name: string;
}

export interface EntityAssignment<Incoming extends IncomingEntity> {
  readonly incoming: Incoming;
  /** The row this record continues, or `null` when a row must be inserted. */
  readonly existing: ExistingEntity | null;
  readonly matchedBy: "source_id" | "source_key" | null;
  /** The key the row answered to until now, when the source renamed it. */
  readonly renamedFrom: string | null;
  /** The row's own slug if it has one — never recomputed — else a fresh one. */
  readonly slug: string;
}

export interface EntityKeyConflict {
  readonly sourceId: string;
  readonly sourceKey: string;
  /** Slug of the row that carries the source id but could not take the key. */
  readonly passedOverSlug: string;
  /** Slug of the row that already held the key, and was matched instead. */
  readonly keptSlug: string;
}

export interface EntityPlan<Incoming extends IncomingEntity> {
  readonly assignments: Array<EntityAssignment<Incoming>>;
  /** Live rows nothing in this listing accounts for. */
  readonly absent: ExistingEntity[];
  readonly conflicts: EntityKeyConflict[];
}

/** When two rows carry one source id, the one still listed is the one to continue. */
function byStatus(a: ExistingEntity, b: ExistingEntity): number {
  const rank = (status: EntityStatus): number =>
    status === "active" ? 0 : status === "missing" ? 1 : 2;
  return rank(a.status) - rank(b.status);
}

export function planEntities<Incoming extends IncomingEntity>(
  existing: readonly ExistingEntity[],
  incoming: readonly Incoming[],
): EntityPlan<Incoming> {
  const byKey = new Map(existing.map((row) => [row.sourceKey, row]));
  const bySourceId = new Map<string, ExistingEntity[]>();
  for (const row of existing) {
    if (row.sourceId === null) continue;
    const rows = bySourceId.get(row.sourceId);
    if (rows) rows.push(row);
    else bySourceId.set(row.sourceId, [row]);
  }

  // Every slug already in the table is taken, whether or not its row is in
  // this listing: a new row must never collide with, or displace, an old one.
  const takenSlugs = new Set(existing.map((row) => row.slug));
  const claimed = new Set<string>();
  const seenKeys = new Set<string>();
  const assignments: Array<EntityAssignment<Incoming>> = [];
  const conflicts: EntityKeyConflict[] = [];

  // Two passes, so that a record which matches a row outright always gets it
  // before any record that would merely like to rename one.
  const pending: Incoming[] = [];
  for (const record of incoming) {
    if (seenKeys.has(record.sourceKey)) continue;
    seenKeys.add(record.sourceKey);
    pending.push(record);
  }

  const matches = new Map<
    Incoming,
    { row: ExistingEntity; matchedBy: "source_id" | "source_key" }
  >();

  for (const record of pending) {
    if (record.sourceId === null) continue;
    const candidates = (bySourceId.get(record.sourceId) ?? []).filter(
      (row) => !claimed.has(row.id),
    );
    if (candidates.length === 0) continue;

    const keyHolder = byKey.get(record.sourceKey);
    // Same id and same key: the ordinary, unrenamed case.
    let row = candidates.find((candidate) => candidate.sourceKey === record.sourceKey);
    if (!row) {
      const preferred = [...candidates].sort(byStatus)[0] as ExistingEntity;
      if (keyHolder && keyHolder.id !== preferred.id && !claimed.has(keyHolder.id)) {
        // The key this row should move to is already another row's. The key
        // is unique, so the rename cannot be written; keep the key's holder
        // and say so rather than fail the run.
        conflicts.push({
          sourceId: record.sourceId,
          sourceKey: record.sourceKey,
          passedOverSlug: preferred.slug,
          keptSlug: keyHolder.slug,
        });
        continue;
      }
      row = preferred;
    }
    claimed.add(row.id);
    matches.set(record, { row, matchedBy: "source_id" });
  }

  for (const record of pending) {
    if (matches.has(record)) continue;
    const row = byKey.get(record.sourceKey);
    if (!row || claimed.has(row.id)) continue;
    claimed.add(row.id);
    matches.set(record, { row, matchedBy: "source_key" });
  }

  for (const record of pending) {
    const match = matches.get(record);
    if (match) {
      assignments.push({
        incoming: record,
        existing: match.row,
        matchedBy: match.matchedBy,
        renamedFrom: match.row.sourceKey === record.sourceKey ? null : match.row.sourceKey,
        slug: match.row.slug,
      });
      continue;
    }

    const base = slugify(record.name) || slugify(record.sourceKey) || "item";
    let slug = base;
    for (let attempt = 2; takenSlugs.has(slug); attempt += 1) slug = `${base}-${attempt}`;
    takenSlugs.add(slug);
    assignments.push({
      incoming: record,
      existing: null,
      matchedBy: null,
      renamedFrom: null,
      slug,
    });
  }

  return {
    assignments,
    absent: existing.filter((row) => !claimed.has(row.id) && row.status === "active"),
    conflicts,
  };
}

/** What one reconciliation did, or — on a dry run — would do. */
export interface TaxonomyChanges {
  readonly created: string[];
  readonly renamed: Array<{ from: string; to: string; slug: string }>;
  /** Slugs of rows that were hidden because the source no longer lists them. */
  readonly markedMissing: string[];
  readonly restored: string[];
  readonly conflicts: EntityKeyConflict[];
}

export function summarisePlan<Incoming extends IncomingEntity>(
  plan: EntityPlan<Incoming>,
  options: { readonly markAbsent: boolean },
): TaxonomyChanges {
  return {
    created: plan.assignments.filter((a) => a.existing === null).map((a) => a.incoming.sourceKey),
    renamed: plan.assignments
      .filter((a) => a.renamedFrom !== null)
      .map((a) => ({ from: a.renamedFrom as string, to: a.incoming.sourceKey, slug: a.slug })),
    markedMissing: options.markAbsent ? plan.absent.map((row) => row.slug) : [],
    restored: plan.assignments
      .filter((a) => a.existing !== null && a.existing.status !== "active")
      .map((a) => a.slug),
    conflicts: plan.conflicts,
  };
}
