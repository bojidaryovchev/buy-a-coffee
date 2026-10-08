import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_HEALTH_THRESHOLDS,
  SYNC_CONDITIONS,
  evaluateSyncHealth,
  type SyncCondition,
  type SyncRunSnapshot,
} from "@/lib/sync-health";

const NOW = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

/** A healthy, finished, real run that started `h` hours ago. */
function run(h: number, over: Partial<SyncRunSnapshot> = {}): SyncRunSnapshot {
  return {
    status: "succeeded",
    dryRun: false,
    startedAt: hoursAgo(h),
    completedAt: hoursAgo(h - 0.1),
    circuitBreakerTripped: false,
    catalogSource: "filter_init",
    parserConfidence: "1.000",
    imagesFailed: 0,
    ...over,
  };
}

const conditions = (runs: SyncRunSnapshot[], now = NOW): SyncCondition[] =>
  evaluateSyncHealth(runs, now).map((f) => f.condition);

describe("evaluateSyncHealth", () => {
  it("reports nothing for a healthy history", () => {
    expect(conditions([run(1), run(7), run(13)])).toEqual([]);
  });

  describe("no_recent_success", () => {
    it("holds for an empty history", () => {
      const findings = evaluateSyncHealth([], NOW);
      expect(findings.map((f) => f.condition)).toEqual(["no_recent_success"]);
      expect(findings[0]?.summary).toMatch(/нито една/);
    });

    it("holds when the last success is older than two intervals plus slack", () => {
      // 6h x 2 + 2h slack = 14h
      expect(conditions([run(14.5)])).toEqual(["no_recent_success"]);
    });

    it("does not hold just inside the window", () => {
      expect(conditions([run(13)])).toEqual([]);
    });

    it("allows one late run: a success 11 hours ago is fine", () => {
      expect(conditions([run(11)])).toEqual([]);
    });

    it("does not count a failed, partial or breaker-tripped run as a success", () => {
      expect(
        conditions([
          run(1, { status: "failed" }),
          run(2, { status: "partial" }),
          run(3, { circuitBreakerTripped: true }),
        ]),
      ).toContain("no_recent_success");
    });

    it("does not count a dry run, however recent", () => {
      expect(conditions([run(1, { dryRun: true }), run(30)])).toEqual(["no_recent_success"]);
    });

    it("does not count a run still in progress", () => {
      expect(conditions([run(0.5, { status: "running", completedAt: null }), run(30)])).toEqual([
        "no_recent_success",
      ]);
    });

    it("measures from completion, falling back to start", () => {
      expect(conditions([run(20, { completedAt: hoursAgo(5) })])).toEqual([]);
      expect(conditions([run(20, { completedAt: null })])).toEqual(["no_recent_success"]);
    });

    it("honours thresholds passed in", () => {
      const tight = { ...DEFAULT_SYNC_HEALTH_THRESHOLDS, slackMs: 0, missedIntervals: 1 };
      expect(evaluateSyncHealth([run(7)], NOW, tight).map((f) => f.condition)).toEqual([
        "no_recent_success",
      ]);
    });
  });

  it("latest_failed: the latest real run failed", () => {
    expect(conditions([run(1, { status: "failed" }), run(5)])).toEqual(["latest_failed"]);
  });

  it("latest_failed: an aborted run counts as failed", () => {
    expect(conditions([run(1, { status: "aborted" }), run(5)])).toEqual(["latest_failed"]);
  });

  it("latest_failed: not raised once a later run succeeded", () => {
    expect(conditions([run(1), run(7, { status: "failed" })])).toEqual([]);
  });

  it("latest_failed: a dry run that failed is not the latest run", () => {
    expect(conditions([run(1, { status: "failed", dryRun: true }), run(2)])).toEqual([]);
  });

  it("latest_partial: the latest real run was partial", () => {
    expect(conditions([run(1, { status: "partial" }), run(7)])).toEqual(["latest_partial"]);
  });

  it("breaker_open: the latest run tripped the breaker", () => {
    expect(conditions([run(1, { circuitBreakerTripped: true }), run(7)])).toEqual(["breaker_open"]);
  });

  it("breaker_open and latest_partial together, as the sync really records a trip", () => {
    expect(
      conditions([run(1, { status: "partial", circuitBreakerTripped: true }), run(7)]),
    ).toEqual(["latest_partial", "breaker_open"]);
  });

  it("source_fallback: catalog_source other than filter_init", () => {
    const findings = evaluateSyncHealth([run(1, { catalogSource: "listing_html" })], NOW);
    expect(findings.map((f) => f.condition)).toEqual(["source_fallback"]);
    expect(findings[0]?.summary).toContain("listing_html");
  });

  it("source_fallback: a run that never got as far as a source is not a fallback", () => {
    expect(conditions([run(1, { catalogSource: null }), run(5)])).toEqual([]);
  });

  it("low_confidence: below the threshold, from the stored text", () => {
    expect(conditions([run(1, { parserConfidence: "0.700" })])).toEqual(["low_confidence"]);
  });

  it("low_confidence: at the threshold is fine; a number works; junk is ignored", () => {
    expect(conditions([run(1, { parserConfidence: "0.900" })])).toEqual([]);
    expect(conditions([run(1, { parserConfidence: 0.5 })])).toEqual(["low_confidence"]);
    expect(conditions([run(1, { parserConfidence: "n/a" })])).toEqual([]);
    expect(conditions([run(1, { parserConfidence: null })])).toEqual([]);
  });

  it("image_failed: any failed image in the latest run", () => {
    const findings = evaluateSyncHealth([run(1, { imagesFailed: 3 })], NOW);
    expect(findings.map((f) => f.condition)).toEqual(["image_failed"]);
    expect(findings[0]?.summary).toContain("3");
  });

  it("only the latest run is judged for its own conditions", () => {
    expect(
      conditions([
        run(1),
        run(7, { imagesFailed: 9, catalogSource: "listing_html", parserConfidence: "0.2" }),
      ]),
    ).toEqual([]);
  });

  it("does not depend on the order rows arrive in", () => {
    const rows = [run(7), run(1, { status: "failed" }), run(13)];
    expect(conditions([...rows].reverse())).toEqual(conditions(rows));
    expect(conditions(rows)).toEqual(["latest_failed"]);
  });

  it("returns each condition once, in a fixed order", () => {
    const found = conditions([
      run(1, {
        status: "partial",
        circuitBreakerTripped: true,
        catalogSource: "listing_html",
        parserConfidence: "0.5",
        imagesFailed: 2,
      }),
      run(40, { status: "failed" }),
    ]);
    expect(found).toEqual([
      "no_recent_success",
      "latest_partial",
      "breaker_open",
      "source_fallback",
      "low_confidence",
      "image_failed",
    ]);
    expect(new Set(found).size).toBe(found.length);
    for (const c of found) expect(SYNC_CONDITIONS).toContain(c);
  });

  it("ignores columns it does not know about", () => {
    const withExtra = { ...run(1), movedCount: 4, somethingNew: "x" } as SyncRunSnapshot;
    expect(conditions([withExtra])).toEqual([]);
  });
});
