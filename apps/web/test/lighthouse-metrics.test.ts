import { describe, expect, it } from "vitest";
import {
  CHROME_FLAGS,
  LIGHTHOUSE_GATES,
  rendererThrottled,
  summarisePage,
  summariseRun,
  type LighthouseResult,
  type RunSummary,
} from "../scripts/lighthouse-metrics";

/* The arithmetic `measure:lighthouse` reports with; the browser part needs a server. */

function result({
  performance = 0.8,
  accessibility = 1,
  lcp = 4000,
  observedFcp = 700,
  observedLoad = 600,
  audits = {},
}: {
  performance?: number;
  accessibility?: number;
  lcp?: number;
  observedFcp?: number;
  observedLoad?: number;
  audits?: LighthouseResult["audits"];
} = {}): LighthouseResult {
  const metric = (id: string, numericValue: number) => ({
    id,
    title: id,
    score: 0.5,
    scoreDisplayMode: "numeric",
    numericValue,
  });
  return {
    categories: {
      performance: { score: performance },
      accessibility: { score: accessibility },
      "best-practices": { score: 1 },
      seo: { score: 1 },
    },
    audits: {
      "first-contentful-paint": { ...metric("first-contentful-paint", 1200), score: 0.95 },
      "largest-contentful-paint": metric("largest-contentful-paint", lcp),
      "total-blocking-time": { ...metric("total-blocking-time", 150), score: 0.95 },
      "cumulative-layout-shift": { ...metric("cumulative-layout-shift", 0), score: 1 },
      "speed-index": { ...metric("speed-index", 1500), score: 0.99 },
      metrics: {
        id: "metrics",
        title: "Metrics",
        score: null,
        scoreDisplayMode: "informative",
        details: {
          items: [{ observedFirstContentfulPaint: observedFcp, observedLoad: observedLoad }],
        },
      },
      ...audits,
    },
  };
}

describe("summariseRun", () => {
  it("reads the four scores as PSI prints them, out of 100", () => {
    expect(summariseRun(result({ performance: 0.814 })).scores).toEqual({
      performance: 81,
      accessibility: 100,
      "best-practices": 100,
      seo: 100,
    });
  });

  it("lists the audits that cost points, and not the informative ones", () => {
    const run = summariseRun(
      result({
        audits: {
          "color-contrast": {
            id: "color-contrast",
            title: "Contrast",
            score: 0,
            scoreDisplayMode: "binary",
          },
          "unused-javascript": {
            id: "unused-javascript",
            title: "Unused JavaScript",
            score: 0,
            scoreDisplayMode: "metricSavings",
            displayValue: "Est savings of 75 KiB",
          },
          diagnostics: { id: "diagnostics", title: "D", score: 0, scoreDisplayMode: "informative" },
          "is-on-https": {
            id: "is-on-https",
            title: "HTTPS",
            score: 1,
            scoreDisplayMode: "binary",
          },
        },
      }),
    );
    expect(run.failing).toContain("color-contrast");
    expect(run.failing).toContain("unused-javascript (Est savings of 75 KiB)");
    expect(run.failing).toContain("largest-contentful-paint");
    expect(run.failing).not.toContain("diagnostics");
    expect(run.failing.some((id) => id.startsWith("is-on-https"))).toBe(false);
  });
});

describe("rendererThrottled", () => {
  it("is false for a page that paints around when it loads", () => {
    expect(rendererThrottled(summariseRun(result({ observedFcp: 780, observedLoad: 640 })))).toBe(
      false,
    );
  });

  it("is true for a page that loaded at 0.4 s and first painted at 2.5 s", () => {
    expect(rendererThrottled(summariseRun(result({ observedFcp: 2500, observedLoad: 400 })))).toBe(
      true,
    );
  });
});

describe("summarisePage", () => {
  const runs: RunSummary[] = [0.88, 0.91, 0.93, 0.79, 0.9].map((performance, index) =>
    summariseRun(result({ performance, lcp: 3000 + index * 100 })),
  );

  it("takes medians across runs", () => {
    const page = summarisePage(runs);
    expect(page.scores.performance).toBe(90);
    expect(page.lcpMs).toBe(3200);
  });

  it("names the run with the median score, for its failing audits", () => {
    expect(summarisePage(runs).medianRun.scores.performance).toBe(90);
  });

  it("misses a gate only when the median is under it", () => {
    expect(summarisePage(runs).missed).toEqual([]);
    const weak = summarisePage(
      [0.8, 0.85, 0.95].map((p) => summariseRun(result({ performance: p }))),
    );
    expect(weak.missed).toEqual(["performance"]);
    const blemished = summarisePage([
      summariseRun(result({ performance: 0.95, accessibility: 0.9 })),
    ]);
    expect(blemished.missed).toEqual(["accessibility"]);
  });

  it("refuses to summarise nothing", () => {
    expect(() => summarisePage([])).toThrow();
  });
});

describe("the gates and the flags", () => {
  it("hold PSI's green line for performance and all-or-nothing for the rest", () => {
    expect(LIGHTHOUSE_GATES).toEqual({
      performance: 90,
      accessibility: 100,
      "best-practices": 100,
      seo: 100,
    });
  });

  it("keep Chrome from throttling a headless window it thinks is covered", () => {
    expect(CHROME_FLAGS).toContain("--disable-features=CalculateNativeWinOcclusion");
  });
});
