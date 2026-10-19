/**
 * The constants and arithmetic behind `measure-budgets.ts`, apart from the
 * browser driving so they can be tested without one.
 */

/**
 * LCP and CLS are DESIGN.md's budgets; INP's is the Web Vitals "good"
 * threshold, the third Core Web Vital since March 2024.
 */
export const BUDGETS = { lcpMs: 2500, cls: 0.1, inpMs: 200 } as const;

/**
 * Chrome DevTools' "Fast 4G": 9 Mbit/s down, 1.5 Mbit/s up, 60 ms RTT, with
 * the same adjustments DevTools applies to turn packet-level figures into
 * request-level throttling (90% of the bandwidth, 2.75× the latency).
 */
export const FAST_4G = {
  offline: false,
  downloadThroughput: ((9 * 1000 * 1000) / 8) * 0.9,
  uploadThroughput: ((1.5 * 1000 * 1000) / 8) * 0.9,
  latency: 60 * 2.75,
} as const;

export const CPU_SLOWDOWN = 4;

export interface Shift {
  readonly value: number;
  readonly startTime: number;
}

/**
 * Cumulative Layout Shift as Web Vitals defines it: shifts are grouped into
 * session windows (a gap of more than 1 s, or a window longer than 5 s, starts
 * a new one), and CLS is the largest window's sum.
 */
export function cumulativeLayoutShift(shifts: readonly Shift[]): number {
  let largest = 0;
  let current = 0;
  let windowStart = -Infinity;
  let previous = -Infinity;
  for (const shift of [...shifts].sort((a, b) => a.startTime - b.startTime)) {
    if (shift.startTime - previous > 1000 || shift.startTime - windowStart > 5000) {
      current = 0;
      windowStart = shift.startTime;
    }
    current += shift.value;
    previous = shift.startTime;
    largest = Math.max(largest, current);
  }
  return largest;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** The value seen most often; the first of the most frequent on a tie. */
export function mostFrequent(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0] ?? "";
  for (const [value, count] of counts) if (count > (counts.get(best) ?? 0)) best = value;
  return best;
}

/**
 * Interaction to Next Paint from the interactions of one visit: the slowest,
 * as Web Vitals takes it for a page with fewer than fifty interactions (one
 * outlier is set aside per fifty after that). Null when none was recorded —
 * the Event Timing API reports only interactions of 16 ms or more, so an empty
 * list means every one was faster than that.
 */
export function interactionToNextPaint(durations: readonly number[]): number | null {
  if (durations.length === 0) return null;
  const sorted = [...durations].sort((a, b) => b - a);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))] as number;
}

/** What the Event Timing API reports at least: an interaction under this leaves no entry. */
export const EVENT_TIMING_FLOOR_MS = 16;

export interface InpSummary {
  /** False when some visit made no tap at all: there was nothing to time. */
  readonly measured: boolean;
  readonly medianMs: number | null;
  readonly worstMs: number | null;
  /** Within budget. Never true for a page that was not measured. */
  readonly ok: boolean;
}

/**
 * INP across a page's visits.
 *
 * A visit that made taps and recorded no entry was faster than 16 ms, and
 * counts as 16. A visit that made no tap measured nothing: the control was
 * not on the page, or the tap failed. Then the page's INP is "not measured",
 * and the budget is missed rather than passed on silence.
 */
export function inpSummary(
  runs: ReadonlyArray<{ readonly taps: number; readonly inpMs: number | null }>,
): InpSummary {
  if (runs.length === 0 || runs.some((run) => run.taps === 0)) {
    return { measured: false, medianMs: null, worstMs: null, ok: false };
  }
  const values = runs.map((run) => run.inpMs ?? EVENT_TIMING_FLOOR_MS);
  const medianMs = median(values);
  return { measured: true, medianMs, worstMs: Math.max(...values), ok: medianMs < BUDGETS.inpMs };
}

/** The address of the first product card in a listing's HTML, or null. */
export function firstProductPath(html: string): string | null {
  for (const article of html.matchAll(/<article\b[\s\S]*?<\/article>/g)) {
    const link = /<a\b[^>]*\bhref="(\/bg\/[a-z0-9-]+)"/.exec(article[0]);
    if (link) return link[1] as string;
  }
  return null;
}

/** A product given as a slug or as a path: always a path under the locale. */
export function productPath(product: string): string {
  return product.startsWith("/") ? product : `/bg/${product}`;
}

export interface BudgetArgs {
  readonly baseUrl: string;
  readonly runs: number;
  readonly home: string;
  readonly listing: string;
  readonly product: string | null;
  readonly json: string | null;
}

export function parseArgs(argv: readonly string[]): BudgetArgs {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const runs = Number.parseInt(value("runs") ?? "5", 10);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
  return {
    baseUrl: (value("base-url") ?? "http://127.0.0.1:3000").replace(/\/$/, ""),
    runs,
    /*
     * The pages themselves, not addresses that redirect to them: the bare `/`
     * answers 307 to `/bg`, and `/categories/nespresso` 308 to the listing's
     * landing slug, and a redirect's round trip is not the page's LCP.
     */
    home: value("home") ?? "/bg",
    listing: value("listing") ?? "/bg/nespresso-kapsuli",
    product: value("product") ?? null,
    json: value("json") ?? null,
  };
}
