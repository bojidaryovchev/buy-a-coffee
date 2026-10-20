#!/usr/bin/env tsx
/**
 * Score the home page, a listing and a product page as PageSpeed Insights
 * scores them on a phone.
 *
 *   pnpm --filter @catalog/web measure:lighthouse -- --base-url http://127.0.0.1:3000
 *   pnpm --filter @catalog/web measure:lighthouse -- --base-url https://buy-a-coffee.com
 *
 * Lighthouse with its defaults is what PSI runs: a Moto G Power's screen, a
 * 4× CPU slowdown and a simulated slow 4G link (150 ms round trips, 1.6 Mbit/s
 * down). The simulation is the point. It charges a page for every byte it asks
 * for before its first paint, which `measure:budgets` — a real Fast 4G link,
 * 9 Mbit/s — barely notices: on 20 October 2026 that script put the home
 * page's LCP at 1.5 s, and PSI at 4.8 s, the difference being 107 KB of a
 * Node crypto polyfill and 230 KB of preloaded fonts. The two answer
 * different questions; this one is the score a visitor's search engine sees.
 *
 * Each page is measured `--runs` times (default 5), each in a fresh Chrome,
 * and the median is reported, as PSI's own guidance is to read several runs.
 * Exits 1 when a page's median misses a gate (`LIGHTHOUSE_GATES`): 90 for
 * Performance, 100 for Accessibility, Best Practices and SEO.
 *
 * It only loads pages. Against a local production build (`next build && next
 * start`, never `next dev`) or a deployed site, read-only.
 *
 * Options:
 *   --base-url <url>   the server to measure (default http://127.0.0.1:3000)
 *   --runs <n>         runs per page (default 5)
 *   --home <path>      the home page (default /bg)
 *   --listing <path>   the listing (default /bg/nespresso-kapsuli)
 *   --product <slug>   the product, as a slug or a path (default: the listing's first card)
 *   --json <file>      also write every run's numbers to this file
 *   --header <h: v>    send this header with every request (repeatable), e.g. a
 *                      Vercel protection bypass for a preview
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { firstProductPath, parseArgs, productPath } from "./budget-metrics.ts";
import {
  CHROME_FLAGS,
  GATED_CATEGORIES,
  LIGHTHOUSE_GATES,
  rendererThrottled,
  summarisePage,
  summariseRun,
  type LighthouseResult,
  type RunSummary,
} from "./lighthouse-metrics.ts";

function headers(argv: readonly string[]): Record<string, string> {
  const extra: Record<string, string> = {};
  argv.forEach((arg, index) => {
    if (arg !== "--header") return;
    const raw = argv[index + 1] ?? "";
    const colon = raw.indexOf(":");
    if (colon < 1) throw new Error(`--header wants "Name: value", got ${JSON.stringify(raw)}`);
    extra[raw.slice(0, colon).trim()] = raw.slice(colon + 1).trim();
  });
  return extra;
}

async function firstProduct(
  baseUrl: string,
  listing: string,
  extra: Record<string, string>,
): Promise<string> {
  const response = await fetch(`${baseUrl}${listing}`, { headers: extra });
  const found = firstProductPath(await response.text());
  if (!found) throw new Error(`no product card on ${listing}; pass --product`);
  return found;
}

/**
 * Lighthouse is run as its pinned CLI through npx rather than installed: as a
 * dependency of this app its tree brings `@opentelemetry/api`, an optional
 * peer of drizzle-orm, and pnpm then resolves a second drizzle-orm here whose
 * types do not match the database package's. npx keeps it out of the lockfile.
 */
const LIGHTHOUSE = "lighthouse@13.5.0";

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // One command line through a shell, so Windows finds npx.cmd; the
    // arguments that could hold a space are quoted by the caller.
    const line = [command, ...args].join(" ");
    const child = spawn(line, { shell: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)),
    );
  });
}

/* Nothing quoted here holds a double quote: a URL, a temporary path, the flags. */
const quote = (value: string) => `"${value}"`;

async function measureOnce(url: string, extra: Record<string, string>): Promise<RunSummary> {
  const directory = await mkdtemp(path.join(tmpdir(), "measure-lighthouse-"));
  const output = path.join(directory, "report.json");
  try {
    // Headers go in a file, which Lighthouse also accepts: JSON on a Windows
    // command line is a quoting puzzle not worth solving.
    const headerFile = path.join(directory, "headers.json");
    if (Object.keys(extra).length) await writeFile(headerFile, JSON.stringify(extra));
    await run("npx", [
      "--yes",
      LIGHTHOUSE,
      quote(url),
      "--output=json",
      `--output-path=${quote(output)}`,
      `--only-categories=${GATED_CATEGORIES.join(",")}`,
      `--chrome-flags=${quote(CHROME_FLAGS.join(" "))}`,
      "--quiet",
      ...(Object.keys(extra).length ? [`--extra-headers=${quote(headerFile)}`] : []),
    ]);
    return summariseRun(JSON.parse(await readFile(output, "utf8")) as LighthouseResult);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const ms = (value: number) => `${(value / 1000).toFixed(2)} s`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const extra = headers(argv);
  const product = args.product
    ? productPath(args.product)
    : await firstProduct(args.baseUrl, args.listing, extra);
  const pages = [
    { name: "Home", path: args.home },
    { name: "Listing (a system)", path: args.listing },
    { name: "Product page", path: product },
  ];

  console.log(
    `Scoring ${args.baseUrl} as PageSpeed Insights does on a phone: Lighthouse defaults ` +
      `(Moto G Power, 4× CPU, simulated slow 4G), ${args.runs} runs per page, medians.\n`,
  );

  const report: Array<Record<string, unknown>> = [];
  let missed = false;
  for (const target of pages) {
    const url = `${args.baseUrl}${target.path}`;
    // Unmeasured: the server renders and caches the page first.
    const warm = await fetch(url, { redirect: "manual", headers: extra });
    if (warm.status !== 200) throw new Error(`${url} answered ${warm.status}, not 200`);

    const runs: RunSummary[] = [];
    for (let run = 0; run < args.runs; run += 1) {
      const summary = await measureOnce(url, extra);
      if (rendererThrottled(summary)) {
        throw new Error(
          `${url}: loaded at ${ms(summary.observedLoadMs)} but first painted at ` +
            `${ms(summary.observedFcpMs)} — Chrome throttled the renderer, so this run ` +
            "measured the machine, not the page. See CHROME_FLAGS.",
        );
      }
      runs.push(summary);
    }

    const page = summarisePage(runs);
    missed ||= page.missed.length > 0;
    report.push({ page: target.name, path: target.path, ...page, runs });

    console.log(`${target.name} — ${target.path}`);
    console.log(
      "  " +
        GATED_CATEGORIES.map(
          (id) =>
            `${id} ${page.scores[id]}${page.scores[id] < LIGHTHOUSE_GATES[id] ? ` (UNDER ${LIGHTHOUSE_GATES[id]})` : ""}`,
        ).join(", "),
    );
    console.log(
      `  LCP ${ms(page.lcpMs)}, FCP ${ms(page.fcpMs)}, TBT ${Math.round(page.tbtMs)} ms, ` +
        `CLS ${page.cls.toFixed(3)}, Speed Index ${ms(page.speedIndexMs)}`,
    );
    console.log(`  performance per run: ${runs.map((run) => run.scores.performance).join(", ")}`);
    if (page.medianRun.failing.length > 0)
      console.log(`  costing points: ${page.medianRun.failing.join("; ")}`);
    console.log("");
  }

  if (args.json) {
    await writeFile(args.json, JSON.stringify({ baseUrl: args.baseUrl, report }, null, 2));
    console.log(`Every run written to ${args.json}`);
  }
  if (missed) {
    console.error("A page's median is under a gate.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
