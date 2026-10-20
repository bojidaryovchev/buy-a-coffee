/**
 * The constants and arithmetic behind `measure-lighthouse.ts`, apart from the
 * browser driving so they can be tested without one.
 */
import { median } from "./budget-metrics.ts";

/**
 * What PageSpeed Insights must show on a phone. Performance is the score PSI
 * prints in the circle; the other three are all-or-nothing on this site,
 * because every audit in them is ours to pass.
 */
export const LIGHTHOUSE_GATES = {
  performance: 90,
  accessibility: 100,
  "best-practices": 100,
  seo: 100,
} as const;

export type GatedCategory = keyof typeof LIGHTHOUSE_GATES;
export const GATED_CATEGORIES = Object.keys(LIGHTHOUSE_GATES) as GatedCategory[];

/**
 * Chrome's flags for a Lighthouse run.
 *
 * The last three are not tuning. On Windows, headless Chrome counts its
 * window as covered by others and throttles the page's rendering to about one
 * frame a second: the page loads in 0.4 s and first paints at 2.5 s, and
 * Lighthouse's simulation, which charges every request made before that
 * paint, adds a second or more to LCP. Measured on 20 October 2026 against
 * this site and nextjs.org alike; `rendererThrottled` below catches it if a
 * Chrome update brings it back by another route.
 */
export const CHROME_FLAGS = [
  "--headless=new",
  "--disable-features=CalculateNativeWinOcclusion",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
] as const;

/** The parts of a Lighthouse result this script reads. */
export interface LighthouseResult {
  readonly categories: Record<string, { readonly score: number | null } | undefined>;
  readonly audits: Record<
    string,
    | {
        readonly id: string;
        readonly title: string;
        readonly score: number | null;
        readonly scoreDisplayMode: string;
        readonly numericValue?: number;
        readonly displayValue?: string;
        readonly details?: { readonly items?: ReadonlyArray<Record<string, unknown>> };
      }
    | undefined
  >;
}

export interface RunSummary {
  readonly scores: Record<GatedCategory, number>;
  readonly fcpMs: number;
  readonly lcpMs: number;
  readonly tbtMs: number;
  readonly cls: number;
  readonly speedIndexMs: number;
  readonly observedFcpMs: number;
  readonly observedLoadMs: number;
  /** Audits that cost points: scored, under 0.9, and not merely informative. */
  readonly failing: readonly string[];
}

const numeric = (result: LighthouseResult, id: string): number =>
  result.audits[id]?.numericValue ?? Number.NaN;

export function summariseRun(result: LighthouseResult): RunSummary {
  const scores = Object.fromEntries(
    GATED_CATEGORIES.map((id) => [id, Math.round((result.categories[id]?.score ?? 0) * 100)]),
  ) as Record<GatedCategory, number>;
  const observed = (result.audits.metrics?.details?.items?.[0] ?? {}) as Record<string, unknown>;
  const failing = Object.values(result.audits)
    .filter(
      (audit): audit is NonNullable<typeof audit> =>
        audit !== undefined &&
        audit.score !== null &&
        audit.score < 0.9 &&
        (audit.scoreDisplayMode === "binary" ||
          audit.scoreDisplayMode === "numeric" ||
          audit.scoreDisplayMode === "metricSavings"),
    )
    .map((audit) => `${audit.id}${audit.displayValue ? ` (${audit.displayValue})` : ""}`);
  return {
    scores,
    fcpMs: numeric(result, "first-contentful-paint"),
    lcpMs: numeric(result, "largest-contentful-paint"),
    tbtMs: numeric(result, "total-blocking-time"),
    cls: numeric(result, "cumulative-layout-shift"),
    speedIndexMs: numeric(result, "speed-index"),
    observedFcpMs: Number(observed.observedFirstContentfulPaint ?? Number.NaN),
    observedLoadMs: Number(observed.observedLoad ?? Number.NaN),
    failing,
  };
}

/**
 * A run whose page loaded long before it first painted was not measuring the
 * page: the renderer was being throttled (see `CHROME_FLAGS`). A second of
 * slack is far more than any real page here needs between the two.
 */
export function rendererThrottled(run: RunSummary): boolean {
  return run.observedFcpMs - run.observedLoadMs > 1000;
}

export interface PageSummary {
  readonly scores: Record<GatedCategory, number>;
  readonly fcpMs: number;
  readonly lcpMs: number;
  readonly tbtMs: number;
  readonly cls: number;
  readonly speedIndexMs: number;
  /** The run whose performance score is the median one, for its failing audits. */
  readonly medianRun: RunSummary;
  readonly missed: readonly GatedCategory[];
}

/**
 * Medians across runs, as PSI's own advice is to read several runs rather
 * than one. A gate is missed when the median score is under it.
 */
export function summarisePage(runs: readonly RunSummary[]): PageSummary {
  if (runs.length === 0) throw new Error("no runs to summarise");
  const scores = Object.fromEntries(
    GATED_CATEGORIES.map((id) => [id, median(runs.map((run) => run.scores[id]))]),
  ) as Record<GatedCategory, number>;
  const byPerformance = [...runs].sort((a, b) => a.scores.performance - b.scores.performance);
  const medianRun = byPerformance[Math.floor((byPerformance.length - 1) / 2)] as RunSummary;
  return {
    scores,
    fcpMs: median(runs.map((run) => run.fcpMs)),
    lcpMs: median(runs.map((run) => run.lcpMs)),
    tbtMs: median(runs.map((run) => run.tbtMs)),
    cls: median(runs.map((run) => run.cls)),
    speedIndexMs: median(runs.map((run) => run.speedIndexMs)),
    medianRun,
    missed: GATED_CATEGORIES.filter((id) => scores[id] < LIGHTHOUSE_GATES[id]),
  };
}
