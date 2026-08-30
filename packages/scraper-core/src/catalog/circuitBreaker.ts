import type { CatalogSourceKind } from "./discover.ts";
import type { DiffResult } from "./diff.ts";

/**
 * Mass-removal protection.
 *
 * The failure this exists to prevent: the source has a bad deploy, a Cloudflare
 * interstitial appears, or a parser breaks; discovery returns 3 products
 * instead of 110; the diff dutifully marks 107 products missing; three runs
 * later the catalog is gone and the storefront is empty.
 *
 * So before any absence is applied, the run is judged against the last healthy
 * baseline. If it looks suspicious the diff is refused *in full* — the
 * creations and updates are still applied, because those are additive and
 * safe, but nothing is marked missing or removed.
 */

export type BreakerReason =
  | "mass_disappearance"
  | "discovery_below_baseline_ratio"
  | "discovery_below_absolute_minimum"
  | "catalog_entry_pages_failed"
  | "parser_confidence_collapsed"
  | "empty_discovery";

export interface BreakerInput {
  /** Distinct products discovered in this run. */
  readonly discoveredCount: number;
  /** Products currently active in our catalog. */
  readonly activeCount: number;
  /** Discovered count from the last healthy run, if any. */
  readonly baselineDiscoveredCount: number | null;
  /** Products this run would mark missing or removed. */
  readonly disappearingCount: number;
  /** 0..1 parser confidence reported by discovery. */
  readonly parserConfidence: number;
  /** Catalog entry pages that failed to fetch. */
  readonly failedEntryPages: number;
  readonly catalogSource: CatalogSourceKind;
}

export interface BreakerThresholds {
  readonly maxDisappearedRatio: number;
  readonly minDiscoveredRatio: number;
  readonly minAbsoluteProducts: number;
  readonly minParserConfidence: number;
}

export interface BreakerDecision {
  readonly tripped: boolean;
  readonly reasons: BreakerReason[];
  /** Human-readable explanation for the run record and the alarm. */
  readonly summary: string;
  readonly detail: Record<string, unknown>;
}

export function evaluateCircuitBreaker(
  input: BreakerInput,
  thresholds: BreakerThresholds,
): BreakerDecision {
  const reasons: BreakerReason[] = [];
  const detail: Record<string, unknown> = { ...input, thresholds };

  // Nothing at all came back, but we do have a catalog: never believe it.
  if (input.discoveredCount === 0 && input.activeCount > 0) {
    reasons.push("empty_discovery");
  }

  if (input.catalogSource === "none" && input.activeCount > 0) {
    reasons.push("catalog_entry_pages_failed");
  }

  if (input.failedEntryPages > 0) {
    reasons.push("catalog_entry_pages_failed");
  }

  if (input.activeCount > 0) {
    const disappearedRatio = input.disappearingCount / input.activeCount;
    detail.disappearedRatio = disappearedRatio;
    if (disappearedRatio > thresholds.maxDisappearedRatio) {
      reasons.push("mass_disappearance");
    }
  }

  if (input.baselineDiscoveredCount !== null && input.baselineDiscoveredCount > 0) {
    const discoveredRatio = input.discoveredCount / input.baselineDiscoveredCount;
    detail.discoveredRatio = discoveredRatio;
    if (discoveredRatio < thresholds.minDiscoveredRatio) {
      reasons.push("discovery_below_baseline_ratio");
    }
  }

  // An absolute floor catches the case where there is no baseline yet.
  if (
    input.activeCount > 0 &&
    input.discoveredCount < thresholds.minAbsoluteProducts &&
    input.disappearingCount > 0
  ) {
    reasons.push("discovery_below_absolute_minimum");
  }

  if (input.parserConfidence < thresholds.minParserConfidence && input.disappearingCount > 0) {
    reasons.push("parser_confidence_collapsed");
  }

  const unique = [...new Set(reasons)];
  return {
    tripped: unique.length > 0,
    reasons: unique,
    summary: unique.length === 0 ? "healthy" : describe(unique, input),
    detail,
  };
}

function describe(reasons: readonly BreakerReason[], input: BreakerInput): string {
  const parts = reasons.map((reason) => {
    switch (reason) {
      case "mass_disappearance":
        return `${input.disappearingCount} of ${input.activeCount} active products would disappear`;
      case "discovery_below_baseline_ratio":
        return `discovered ${input.discoveredCount} vs baseline ${input.baselineDiscoveredCount}`;
      case "discovery_below_absolute_minimum":
        return `only ${input.discoveredCount} products discovered`;
      case "catalog_entry_pages_failed":
        return `${input.failedEntryPages} catalog entry page(s) failed`;
      case "parser_confidence_collapsed":
        return `parser confidence ${input.parserConfidence.toFixed(2)}`;
      case "empty_discovery":
        return "discovery returned no products at all";
      default:
        return reason;
    }
  });
  return `circuit breaker open: ${parts.join("; ")}`;
}

/**
 * Strip absence-driven changes from a diff.
 *
 * Creations, updates and restorations survive: they add or refresh data and
 * cannot empty the catalog. Only `marked_missing` and `removed` are dropped.
 */
export function suppressRemovals(diff: DiffResult): DiffResult {
  const kept = diff.changes.filter(
    (change) => change.changeType !== "marked_missing" && change.changeType !== "removed",
  );
  return {
    ...diff,
    changes: kept,
    missing: [],
    removed: [],
    counts: { ...diff.counts, marked_missing: 0, removed: 0 },
  };
}
