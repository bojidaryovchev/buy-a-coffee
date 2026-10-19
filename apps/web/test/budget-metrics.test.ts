import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  FAST_4G,
  cumulativeLayoutShift,
  firstProductPath,
  inpSummary,
  interactionToNextPaint,
  median,
  mostFrequent,
  parseArgs,
  productPath,
} from "../scripts/budget-metrics";

/* The arithmetic `measure:budgets` reports with; the browser part needs a server. */

describe("cumulativeLayoutShift", () => {
  it("is zero with no shifts", () => {
    expect(cumulativeLayoutShift([])).toBe(0);
  });

  it("sums shifts that arrive within a second of each other", () => {
    expect(
      cumulativeLayoutShift([
        { value: 0.02, startTime: 100 },
        { value: 0.03, startTime: 900 },
        { value: 0.01, startTime: 1800 },
      ]),
    ).toBeCloseTo(0.06);
  });

  it("starts a new window after a gap of more than a second, and keeps the largest", () => {
    expect(
      cumulativeLayoutShift([
        { value: 0.05, startTime: 100 },
        { value: 0.02, startTime: 2000 },
        { value: 0.02, startTime: 2500 },
      ]),
    ).toBeCloseTo(0.05);
  });

  it("caps a window at five seconds even without a gap", () => {
    const shifts = Array.from({ length: 12 }, (_, index) => ({
      value: 0.01,
      startTime: index * 900,
    }));
    // 0 … 4500 ms is one window of six shifts; 5400 ms starts the next.
    expect(cumulativeLayoutShift(shifts)).toBeCloseTo(0.06);
  });

  it("does not depend on the order the entries were collected in", () => {
    const shifts = [
      { value: 0.04, startTime: 3000 },
      { value: 0.04, startTime: 100 },
      { value: 0.04, startTime: 600 },
    ];
    expect(cumulativeLayoutShift(shifts)).toBeCloseTo(0.08);
  });
});

describe("median and mostFrequent", () => {
  it("takes the middle run, or the mean of the two middle ones", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  it("names the element that was the LCP most often", () => {
    expect(mostFrequent(["<img> a", "<h1> b", "<img> a"])).toBe("<img> a");
    expect(mostFrequent(["<h1> b", "<img> a"])).toBe("<h1> b");
  });
});

describe("parseArgs", () => {
  it("defaults to five runs against a local server, on pages that do not redirect", () => {
    expect(parseArgs([])).toEqual({
      baseUrl: "http://127.0.0.1:3000",
      runs: 5,
      home: "/bg",
      listing: "/bg/nespresso-kapsuli",
      product: null,
      json: null,
    });
  });

  it("reads every option and drops a trailing slash from the address", () => {
    expect(
      parseArgs([
        "--base-url",
        "http://127.0.0.1:8813/",
        "--runs",
        "3",
        "--listing",
        "/bg/dolce-gusto-kapsuli",
        "--home",
        "/bg",
        "--product",
        "some-slug",
        "--json",
        "out.json",
      ]),
    ).toEqual({
      baseUrl: "http://127.0.0.1:8813",
      runs: 3,
      home: "/bg",
      listing: "/bg/dolce-gusto-kapsuli",
      product: "some-slug",
      json: "out.json",
    });
  });

  it("refuses a run count that is not a positive integer", () => {
    expect(() => parseArgs(["--runs", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--runs", "many"])).toThrow(/positive integer/);
  });
});

describe("the conditions measured under", () => {
  it("are the budgets DESIGN.md sets", () => {
    expect(BUDGETS).toEqual({ lcpMs: 2500, cls: 0.1, inpMs: 200 });
  });

  it("throttle to DevTools' Fast 4G: about 8 Mbit/s and 165 ms per request", () => {
    expect((FAST_4G.downloadThroughput * 8) / 1e6).toBeCloseTo(8.1);
    expect(FAST_4G.latency).toBe(165);
  });
});

describe("interactionToNextPaint", () => {
  it("is the slowest interaction of a short visit", () => {
    expect(interactionToNextPaint([24, 96, 40])).toBe(96);
  });

  it("sets one outlier aside per fifty interactions", () => {
    const durations = [...Array.from({ length: 59 }, () => 40), 900];
    expect(interactionToNextPaint(durations)).toBe(40);
  });

  it("is null when nothing took 16 ms or more", () => {
    expect(interactionToNextPaint([])).toBeNull();
  });
});

describe("inpSummary", () => {
  it("takes the median of the visits, a tapped visit with no entry counting as 16 ms", () => {
    expect(
      inpSummary([
        { taps: 2, inpMs: 80 },
        { taps: 2, inpMs: null },
        { taps: 2, inpMs: 120 },
      ]),
    ).toEqual({ measured: true, medianMs: 80, worstMs: 120, ok: true });
  });

  it("is not measured, and misses the budget, when a visit made no tap", () => {
    expect(
      inpSummary([
        { taps: 2, inpMs: 80 },
        { taps: 0, inpMs: null },
      ]),
    ).toEqual({ measured: false, medianMs: null, worstMs: null, ok: false });
    expect(inpSummary([]).ok).toBe(false);
  });

  it("misses the budget at 200 ms", () => {
    expect(inpSummary([{ taps: 1, inpMs: 200 }]).ok).toBe(false);
  });
});

describe("finding the product to measure", () => {
  it("takes the first card's link, under the locale", () => {
    const html =
      '<nav><a href="/bg/kafe-kapsuli">Капсули</a></nav>' +
      '<article class="card"><a href="/bg/borbone-crema-classica-kapsuli-dolce-gusto-16-br">x</a></article>' +
      '<article><a href="/bg/second">y</a></article>';
    expect(firstProductPath(html)).toBe("/bg/borbone-crema-classica-kapsuli-dolce-gusto-16-br");
    expect(firstProductPath("<main>no cards</main>")).toBeNull();
  });

  it("accepts a product as a slug or a path", () => {
    expect(productPath("some-slug")).toBe("/bg/some-slug");
    expect(productPath("/bg/some-slug")).toBe("/bg/some-slug");
  });
});
