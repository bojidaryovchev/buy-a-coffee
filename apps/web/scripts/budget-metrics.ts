/**
 * The constants and arithmetic behind `measure-budgets.ts`, apart from the
 * browser driving so they can be tested without one.
 */

export const BUDGETS = { lcpMs: 2500, cls: 0.1 } as const;

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

export interface BudgetArgs {
  readonly baseUrl: string;
  readonly runs: number;
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
    listing: value("listing") ?? "/categories/nespresso",
    product: value("product") ?? null,
    json: value("json") ?? null,
  };
}
