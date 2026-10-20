#!/usr/bin/env tsx
/**
 * Bundle guard: no crypto-browserify in what the browser loads.
 *
 * When a client module imports `node:crypto`, Turbopack does not refuse it; it
 * bundles Next's crypto-browserify in its place. On 20 October 2026 that was
 * about 107 KB of brotli on every page of buy-a-coffee.com, a third of its
 * JavaScript, and a CSP `'unsafe-eval'` report on every load from a generator
 * check inside it.
 *
 * `test/client-imports.test.ts` walks our own client modules' imports and
 * fails on any Node built-in, before anything is built. It does not descend
 * into npm packages, so a client dependency that imports `crypto` would bring
 * the polyfill back past it. This reads what the build wrote, so it sees that
 * too. Run it after `pnpm build`; CI does, in the verify job.
 *
 * The polyfill is recognised by what is in it, not by a chunk's name, which is
 * a hash: a line of its signature-algorithm table, or the path Next compiles it
 * from. Before scanning, the check confirms the first is still in Next's copy
 * of the polyfill, so a Next upgrade that changes it fails here instead of
 * letting a bundle through unseen.
 *
 * It reads the build output and `node_modules/next` only: no database, no
 * network, no environment.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Strings that only crypto-browserify puts in a chunk. */
export const POLYFILL_MARKERS = [
  "sha224WithRSAEncryption",
  "next/dist/compiled/crypto-browserify/",
] as const;

const WEB = path.resolve(import.meta.dirname, "..");
export const STATIC_DIR = path.join(WEB, ".next", "static");

/** Next's own copy of the polyfill, the one a client bundle would get. */
export function polyfillSource(): string {
  const require = createRequire(import.meta.url);
  return readFileSync(require.resolve("next/dist/compiled/crypto-browserify"), "utf8");
}

export function markersIn(source: string): string[] {
  return POLYFILL_MARKERS.filter((marker) => source.includes(marker));
}

function scripts(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return scripts(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

export interface BundleReport {
  readonly scanned: number;
  /** Each one fails the check. */
  readonly problems: readonly string[];
}

export function bundleReport(
  staticDir: string = STATIC_DIR,
  polyfill: string = polyfillSource(),
): BundleReport {
  if (!polyfill.includes(POLYFILL_MARKERS[0])) {
    return {
      scanned: 0,
      problems: [
        `"${POLYFILL_MARKERS[0]}" is no longer in Next's crypto-browserify; ` +
          "choose a marker that is, in POLYFILL_MARKERS",
      ],
    };
  }
  if (!existsSync(staticDir)) {
    return { scanned: 0, problems: [`no build at ${staticDir}; run \`pnpm build\` first`] };
  }
  const files = scripts(staticDir);
  const problems = files.flatMap((file) => {
    const found = markersIn(readFileSync(file, "utf8"));
    return found.length > 0
      ? [`${path.relative(staticDir, file).split(path.sep).join("/")} (${found.join(", ")})`]
      : [];
  });
  return { scanned: files.length, problems };
}

/** Prints the report and returns the process exit code. */
export function run(
  report: BundleReport = bundleReport(),
  out: (line: string) => void = console.log,
  err: (line: string) => void = console.error,
): number {
  if (report.problems.length === 0) {
    out(`check:bundle passed — no crypto-browserify in ${report.scanned} scripts.`);
    return 0;
  }
  err("check:bundle failed — crypto-browserify is in the browser's JavaScript:");
  for (const problem of report.problems) err(`  - ${problem}`);
  err("A client module, or a package one imports, reaches `crypto` or `node:crypto`.");
  return 1;
}

// Only when run as a script; the tests import the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run());
}
