#!/usr/bin/env tsx
/**
 * Measure the performance budgets in DESIGN.md, "Budgets".
 *
 *   pnpm --filter @catalog/web measure:budgets -- --base-url http://127.0.0.1:3000
 *   pnpm --filter @catalog/web measure:budgets -- --base-url https://buy-a-coffee.com
 *
 * Mobile LCP under 2.5 s and CLS under 0.1 on the home page, a system listing
 * and a product page, and INP under 200 ms. Each page is loaded `--runs` times
 * (default 5), each time in a fresh browser context — an empty cache, as a
 * first visit — under:
 *
 *  - the Pixel 7 profile (viewport, pixel ratio, touch, user agent);
 *  - network throttling equal to Chrome DevTools' "Fast 4G" preset, through
 *    `Network.emulateNetworkConditions`;
 *  - a 4× CPU slowdown, through `Emulation.setCPUThrottlingRate`.
 *
 * LCP and CLS come from the page's own `PerformanceObserver`
 * (`largest-contentful-paint`, `layout-shift`); CLS is the largest session
 * window, as the Web Vitals definition has it. INP comes from the Event Timing
 * API (`event` entries with an `interactionId`) over a few taps a visitor
 * makes — the menu, and on a product page the quantity stepper — so it is the
 * page's responsiveness to those, not to everything a person might do. The
 * script prints the median and the worst run per page, the element that was
 * the LCP, and the facts needed to explain a miss: time to first byte, first
 * contentful paint, and the LCP image's size and when it finished loading.
 *
 * It measures a server that is already running: a local production build
 * (`next build && next start`), never `next dev`, whose timings mean nothing —
 * or a deployed site, read-only: it only loads pages and taps controls that
 * change nothing on the server. Each page is visited once unthrottled before
 * measuring, so the server's own first render is not counted. These are lab
 * numbers from one machine; they rank changes and catch regressions, they are
 * not field data (Speed Insights has that).
 *
 * Exits 1 when a page's median misses a budget, so it can gate a launch.
 *
 * Options:
 *   --base-url <url>   the server to measure (default http://127.0.0.1:3000)
 *   --runs <n>         loads per page (default 5)
 *   --home <path>      the home page (default /bg; the bare / only redirects there)
 *   --listing <path>   the listing to measure (default /bg/nespresso-kapsuli)
 *   --product <slug>   the product to measure, as a slug or a path
 *                      (default: the listing's first card)
 *   --json <file>      also write every run's numbers to this file
 */
import { writeFile } from "node:fs/promises";
import { chromium, devices, type Browser, type Page } from "@playwright/test";
import {
  BUDGETS,
  CPU_SLOWDOWN,
  FAST_4G,
  cumulativeLayoutShift,
  firstProductPath,
  inpSummary,
  interactionToNextPaint,
  median,
  mostFrequent,
  parseArgs,
  productPath,
  type Shift,
} from "./budget-metrics.ts";

/* --- Measuring ----------------------------------------------------------- */

interface RunResult {
  readonly lcpMs: number | null;
  readonly cls: number;
  /** The slowest interaction of the visit; null when every one took under 16 ms. */
  readonly inpMs: number | null;
  readonly interactions: number;
  /** Taps actually made. Zero means INP was not measured on this visit. */
  readonly taps: number;
  readonly lcpElement: string;
  readonly ttfbMs: number;
  readonly fcpMs: number | null;
  /** For an image LCP: its transfer size and when its download finished. */
  readonly lcpImage: { readonly bytes: number; readonly responseEndMs: number } | null;
  readonly shifts: readonly (Shift & { readonly sources: string })[];
}

/**
 * Installed before any page script runs; collects into `window.__budget`.
 *
 * Plain JavaScript in a string rather than a function: `tsx` compiles
 * functions with helpers (`__name`) that do not exist in the page, and an init
 * script that throws there fails silently, leaving no LCP entry at all.
 */
const OBSERVE = `
(() => {
  const collected = { lcp: null, shifts: [], interactions: {} };
  window.__budget = collected;
  const describe = (node) => {
    if (!(node instanceof Element)) return "(none)";
    const id = node.id ? "#" + node.id : "";
    const classes = (node.getAttribute("class") || "").split(/\\s+/).filter(Boolean).slice(0, 2);
    const alt = node.getAttribute("alt");
    const text = alt !== null ? alt : (node.textContent || "").trim().slice(0, 60);
    return ("<" + node.tagName.toLowerCase() + id + (classes.length ? "." + classes.join(".") : "") + "> " +
      (text ? JSON.stringify(text) : "")).trim();
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      collected.lcp = { startTime: entry.startTime, element: describe(entry.element), url: entry.url || "" };
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      collected.shifts.push({
        value: entry.value,
        startTime: entry.startTime,
        sources: (entry.sources || []).map((source) => describe(source.node)).join(" | "),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
  // One interaction is several events (pointerdown, pointerup, click); its
  // latency is the longest of them, from input to the next paint.
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.interactionId) continue;
      const previous = collected.interactions[entry.interactionId] || 0;
      collected.interactions[entry.interactionId] = Math.max(previous, entry.duration);
    }
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
})();
`;

/**
 * The taps a visitor makes, on any page: open the menu and close it, and on a
 * product page add a box with the stepper. Each control is tapped only if it
 * is on the page; nothing here submits a form or writes to the server.
 */
const INTERACTIONS: ReadonlyArray<{ readonly selector: string; readonly then?: string }> = [
  { selector: 'header a[role="button"][aria-expanded]', then: "Escape" },
  { selector: 'button[aria-label="Един брой повече"]' },
];

/** Tap what is there; how many taps were actually made. */
async function interact(page: Page): Promise<number> {
  let taps = 0;
  for (const { selector, then } of INTERACTIONS) {
    const control = page.locator(selector).first();
    if (!(await control.isVisible().catch(() => false))) continue;
    const tapped = await control
      .tap({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!tapped) continue;
    taps += 1;
    await page.waitForTimeout(800);
    if (then) {
      await page.keyboard.press(then);
      await page.waitForTimeout(800);
    }
  }
  return taps;
}

async function measureOnce(browser: Browser, url: string): Promise<RunResult> {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  try {
    const page = await context.newPage();
    await page.addInitScript({ content: OBSERVE });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", FAST_4G);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });

    await page.goto(url, { waitUntil: "load", timeout: 120_000 });
    // Let late work land: hydration, lazy components, fonts. A shift from any
    // of them belongs in the number, and LCP can still move until it settles.
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(3000);
    const taps = await interact(page);

    const result = await page.evaluate(() => {
      const collected = (
        window as unknown as {
          __budget: {
            lcp: { startTime: number; element: string; url: string } | null;
            shifts: Array<{ value: number; startTime: number; sources: string }>;
            interactions: Record<string, number>;
          };
        }
      ).__budget;
      const navigation = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const image = collected.lcp?.url
        ? (performance.getEntriesByName(collected.lcp.url)[0] as
            PerformanceResourceTiming | undefined)
        : undefined;
      return {
        lcpMs: collected.lcp ? collected.lcp.startTime : null,
        lcpElement: collected.lcp
          ? `${collected.lcp.element}${collected.lcp.url ? ` ${new URL(collected.lcp.url).pathname}` : ""}`
          : "(no LCP entry)",
        ttfbMs: navigation ? navigation.responseStart : 0,
        fcpMs: fcp ? fcp.startTime : null,
        lcpImage: image
          ? { bytes: image.transferSize || image.encodedBodySize, responseEndMs: image.responseEnd }
          : null,
        shifts: collected.shifts,
        durations: Object.values(collected.interactions),
      };
    });
    const { durations, ...rest } = result;
    return {
      ...rest,
      cls: 0,
      inpMs: interactionToNextPaint(durations),
      interactions: durations.length,
      taps,
    };
  } finally {
    await context.close();
  }
}

async function firstProduct(baseUrl: string, listing: string): Promise<string> {
  const html = await (await fetch(`${baseUrl}${listing}`)).text();
  const path = firstProductPath(html);
  if (!path) throw new Error(`${listing} lists no product to measure; pass --product`);
  return path;
}

const ms = (value: number | null): string => (value === null ? "—" : `${Math.round(value)} ms`);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const product = args.product
    ? productPath(args.product)
    : await firstProduct(args.baseUrl, args.listing);
  const pages = [
    { name: "Home", path: args.home },
    { name: "Listing (a system)", path: args.listing },
    { name: "Product page", path: product },
  ];

  console.log(
    `Measuring ${args.baseUrl}: Pixel 7, Fast 4G (${Math.round((FAST_4G.downloadThroughput * 8) / 1e6)} Mbit/s down, ` +
      `${FAST_4G.latency} ms latency), ${CPU_SLOWDOWN}× CPU slowdown, ${args.runs} cold runs per page.\n` +
      "Lab numbers from this machine, not field data.\n",
  );

  const browser = await chromium.launch();
  const report: Array<Record<string, unknown>> = [];
  let missed = false;
  try {
    for (const target of pages) {
      const url = `${args.baseUrl}${target.path}`;
      // Unthrottled and unmeasured: the server renders and caches the page.
      // `manual`, so an address that redirects is reported, not measured.
      const warm = await fetch(url, { redirect: "manual" });
      if (warm.status !== 200) throw new Error(`${url} answered ${warm.status}, not 200`);

      const runs: RunResult[] = [];
      for (let run = 0; run < args.runs; run += 1) {
        const result = await measureOnce(browser, url);
        runs.push({ ...result, cls: cumulativeLayoutShift(result.shifts) });
      }

      const lcps = runs.map((run) => run.lcpMs ?? Number.POSITIVE_INFINITY);
      const clss = runs.map((run) => run.cls);
      const inp = inpSummary(runs);
      const summary = {
        page: target.name,
        path: target.path,
        lcpMedianMs: median(lcps),
        lcpWorstMs: Math.max(...lcps),
        clsMedian: median(clss),
        clsWorst: Math.max(...clss),
        inpMeasured: inp.measured,
        inpMedianMs: inp.medianMs,
        inpWorstMs: inp.worstMs,
        taps: median(runs.map((run) => run.taps)),
        interactions: median(runs.map((run) => run.interactions)),
        lcpElement: mostFrequent(runs.map((run) => run.lcpElement)),
        ttfbMedianMs: median(runs.map((run) => run.ttfbMs)),
        fcpMedianMs: median(runs.map((run) => run.fcpMs ?? Number.NaN)),
        runs,
      };
      const lcpOk = summary.lcpMedianMs < BUDGETS.lcpMs;
      const clsOk = summary.clsMedian < BUDGETS.cls;
      missed ||= !lcpOk || !clsOk || !inp.ok;
      report.push(summary);

      const image = runs.find((run) => run.lcpImage)?.lcpImage;
      console.log(`${target.name} — ${target.path}`);
      console.log(
        `  LCP  median ${ms(summary.lcpMedianMs)}, worst ${ms(summary.lcpWorstMs)}  ${lcpOk ? "within" : "OVER"} ${BUDGETS.lcpMs} ms`,
      );
      console.log(
        `  CLS  median ${summary.clsMedian.toFixed(3)}, worst ${summary.clsWorst.toFixed(3)}  ${clsOk ? "within" : "OVER"} ${BUDGETS.cls}`,
      );
      console.log(
        inp.measured
          ? `  INP  median ${ms(inp.medianMs)}, worst ${ms(inp.worstMs)}  ${inp.ok ? "within" : "OVER"} ${BUDGETS.inpMs} ms` +
              ` (${summary.taps} taps, ${summary.interactions} interactions of 16 ms or more per visit)`
          : `  INP  not measured: a visit made no tap, so there was nothing to time. Counted as a miss.`,
      );
      console.log(`  LCP element: ${summary.lcpElement}`);
      console.log(
        `  TTFB median ${ms(summary.ttfbMedianMs)}, FCP median ${ms(summary.fcpMedianMs)}` +
          (image
            ? `, LCP image ${(image.bytes / 1024).toFixed(1)} KB loaded at ${ms(image.responseEndMs)}`
            : ""),
      );
      const worstShift = runs.flatMap((run) => run.shifts).sort((a, b) => b.value - a.value)[0];
      if (worstShift && worstShift.value > 0.001) {
        console.log(
          `  largest single shift ${worstShift.value.toFixed(3)} at ${ms(worstShift.startTime)}: ${worstShift.sources || "(no source node)"}`,
        );
      }
      console.log("");
    }
  } finally {
    await browser.close();
  }

  if (args.json) await writeFile(args.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (missed) {
    console.log("At least one page misses its budget (by median).");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
