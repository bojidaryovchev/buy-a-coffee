import { describe, expect, it } from "vitest";
import {
  type BreakerInput,
  evaluateCircuitBreaker,
  suppressRemovals,
} from "../src/catalog/circuitBreaker.ts";
import type { DiffResult, ProductChange } from "../src/catalog/diff.ts";

const THRESHOLDS = {
  maxDisappearedRatio: 0.2,
  minDiscoveredRatio: 0.75,
  minAbsoluteProducts: 10,
  minParserConfidence: 0.6,
} as const;

/** A run that mirrors a healthy production sync of this catalog. */
const HEALTHY: BreakerInput = {
  discoveredCount: 110,
  activeCount: 110,
  baselineDiscoveredCount: 110,
  disappearingCount: 0,
  parserConfidence: 1,
  failedEntryPages: 0,
  catalogSource: "filter_init",
};

const evaluate = (overrides: Partial<BreakerInput> = {}) =>
  evaluateCircuitBreaker({ ...HEALTHY, ...overrides }, THRESHOLDS);

describe("evaluateCircuitBreaker", () => {
  it("stays closed for a healthy run", () => {
    const decision = evaluate();
    expect(decision.tripped).toBe(false);
    expect(decision.reasons).toEqual([]);
    expect(decision.summary).toBe("healthy");
  });

  it("allows a small, believable number of removals", () => {
    // 10 of 110 is under the 20% ceiling: real products do get discontinued.
    expect(evaluate({ discoveredCount: 100, disappearingCount: 10 }).tripped).toBe(false);
  });

  it("opens when a large share of the catalog would disappear at once", () => {
    const decision = evaluate({ discoveredCount: 60, disappearingCount: 50 });
    expect(decision.tripped).toBe(true);
    expect(decision.reasons).toContain("mass_disappearance");
    expect(decision.summary).toContain("50 of 110");
  });

  it("opens when discovery collapses relative to the healthy baseline", () => {
    const decision = evaluate({ discoveredCount: 30, disappearingCount: 5 });
    expect(decision.reasons).toContain("discovery_below_baseline_ratio");
  });

  it("opens when discovery returns nothing but we have a catalog", () => {
    const decision = evaluate({ discoveredCount: 0, disappearingCount: 110 });
    expect(decision.tripped).toBe(true);
    expect(decision.reasons).toContain("empty_discovery");
  });

  it("opens when a catalog entry page failed to load", () => {
    // A partial crawl must never be mistaken for a shrinking catalog.
    const decision = evaluate({ failedEntryPages: 1, discoveredCount: 90, disappearingCount: 20 });
    expect(decision.reasons).toContain("catalog_entry_pages_failed");
  });

  it("opens when no catalog source could be used at all", () => {
    const decision = evaluate({ catalogSource: "none", discoveredCount: 0, disappearingCount: 110 });
    expect(decision.reasons).toContain("catalog_entry_pages_failed");
  });

  it("opens when parser confidence collapses", () => {
    const decision = evaluate({ parserConfidence: 0.3, disappearingCount: 4 });
    expect(decision.reasons).toContain("parser_confidence_collapsed");
  });

  it("ignores low confidence when nothing would disappear", () => {
    // Low confidence alone is not dangerous; low confidence plus deletions is.
    expect(evaluate({ parserConfidence: 0.1, disappearingCount: 0 }).tripped).toBe(false);
  });

  it("opens below the absolute floor even with no baseline", () => {
    const decision = evaluate({
      baselineDiscoveredCount: null,
      discoveredCount: 3,
      disappearingCount: 107,
    });
    expect(decision.reasons).toContain("discovery_below_absolute_minimum");
  });

  it("permits the very first run, when nothing is stored yet", () => {
    const decision = evaluate({
      activeCount: 0,
      baselineDiscoveredCount: null,
      discoveredCount: 110,
      disappearingCount: 0,
    });
    expect(decision.tripped).toBe(false);
  });

  it("permits a genuinely tiny catalog on a first run", () => {
    const decision = evaluate({
      activeCount: 0,
      baselineDiscoveredCount: null,
      discoveredCount: 2,
      disappearingCount: 0,
    });
    expect(decision.tripped).toBe(false);
  });

  it("reports every reason that applies, without duplicates", () => {
    const decision = evaluate({
      discoveredCount: 1,
      disappearingCount: 109,
      parserConfidence: 0.1,
      failedEntryPages: 2,
      catalogSource: "none",
    });
    expect(decision.reasons.length).toBe(new Set(decision.reasons).size);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "mass_disappearance",
        "discovery_below_baseline_ratio",
        "catalog_entry_pages_failed",
        "parser_confidence_collapsed",
      ]),
    );
  });

  it("keeps the numbers that justified the decision", () => {
    const decision = evaluate({ discoveredCount: 60, disappearingCount: 50 });
    expect(decision.detail.disappearedRatio).toBeCloseTo(50 / 110, 5);
    expect(decision.detail.discoveredRatio).toBeCloseTo(60 / 110, 5);
  });

  it("respects a relaxed threshold", () => {
    const decision = evaluateCircuitBreaker(
      { ...HEALTHY, discoveredCount: 60, disappearingCount: 50 },
      { ...THRESHOLDS, maxDisappearedRatio: 0.9, minDiscoveredRatio: 0.1 },
    );
    expect(decision.tripped).toBe(false);
  });
});

function change(changeType: ProductChange["changeType"], sourceKey: string): ProductChange {
  return {
    sourceKey,
    productId: "id",
    changeType,
    changedFields: [],
    before: null,
    after: null,
    nextStatus: changeType === "removed" ? "removed" : changeType === "marked_missing" ? "missing" : "active",
    nextMissingCount: 0,
    product: null,
  };
}

describe("suppressRemovals", () => {
  it("drops absence-driven changes but keeps additive ones", () => {
    const diff: DiffResult = {
      changes: [
        change("created", "a"),
        change("updated", "b"),
        change("restored", "c"),
        change("marked_missing", "d"),
        change("removed", "e"),
      ],
      created: [change("created", "a")],
      updated: [change("updated", "b")],
      unchanged: [],
      missing: [change("marked_missing", "d")],
      removed: [change("removed", "e")],
      restored: [change("restored", "c")],
      counts: { created: 1, updated: 1, unchanged: 0, marked_missing: 1, removed: 1, restored: 1 },
    };

    const safe = suppressRemovals(diff);
    expect(safe.changes.map((c) => c.changeType)).toEqual(["created", "updated", "restored"]);
    expect(safe.missing).toEqual([]);
    expect(safe.removed).toEqual([]);
    expect(safe.counts.marked_missing).toBe(0);
    expect(safe.counts.removed).toBe(0);
    // Additive counts are untouched: suppressing deletions must not lose data.
    expect(safe.counts.created).toBe(1);
    expect(safe.counts.updated).toBe(1);
    expect(safe.counts.restored).toBe(1);
  });
});
