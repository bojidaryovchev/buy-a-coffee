#!/usr/bin/env tsx
/**
 * Bundle guard: no Node crypto polyfill, and no `Function()` probe, in what
 * the browser loads.
 *
 * When a client module imports `node:crypto`, Turbopack does not refuse it; it
 * bundles Next's crypto-browserify in its place, and that requires Next's
 * `util` polyfill. `util`, and Next's `assert` polyfill, which carries the same
 * code, test for generator functions with `Function("return function*() {}")`,
 * which a CSP without `'unsafe-eval'` reports. On 20 October 2026 the chain was
 * about 107 KB of brotli on every page of buy-a-coffee.com, a third of its
 * JavaScript, and a CSP report on every load: the one thing that kept
 * Lighthouse's Best Practices at 96.
 *
 * `test/client-imports.test.ts` walks our own client modules' imports and
 * fails on any Node built-in, before anything is built. It does not descend
 * into npm packages, so a client dependency that imports `crypto` or `util`
 * would bring a polyfill back past it. This reads what the build wrote, so it
 * sees that too. Run it after `pnpm build`; CI does, in the verify job.
 *
 * A polyfill is recognised by what is in it, not by a chunk's name, which is a
 * hash. Before scanning, the check confirms every marker is still in Next's own
 * copy of the polyfill it stands for, so a Next upgrade that changes one fails
 * here instead of letting a bundle through unseen. Two polyfills are left out
 * on purpose: `process`, which Next's runtime ships on every page, and
 * `buffer`, which `@vercel/blob/client` brings into the admin's newsletter
 * composer, legitimately.
 *
 * It reads the build output and `node_modules/next` only: no database, no
 * network, no environment.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Marker {
  /** What is looked for in each script. */
  readonly text: string;
  /** What it means when found, for the report. */
  readonly means: string;
  /** Next's copies that must contain it; `optional` ones only when installed. */
  readonly in: readonly { readonly module: string; readonly optional?: boolean }[];
}

export const MARKERS: readonly Marker[] = [
  {
    text: "sha224WithRSAEncryption",
    means: "crypto-browserify, Next's stand-in for node:crypto",
    in: [{ module: "next/dist/compiled/crypto-browserify" }],
  },
  {
    text: "return function*() {}",
    means: "a Function() probe for generators (Next's util or assert polyfill), a CSP eval report",
    in: [
      { module: "next/dist/compiled/util/util.js" },
      { module: "next/dist/compiled/assert/assert.js", optional: true },
    ],
  },
];

const WEB = path.resolve(import.meta.dirname, "..");
export const STATIC_DIR = path.join(WEB, ".next", "static");

/** Next's copy of each module a marker names, or null where it is not installed. */
export function nextSources(): ReadonlyMap<string, string | null> {
  const require = createRequire(import.meta.url);
  const modules = MARKERS.flatMap((marker) => marker.in.map((source) => source.module));
  return new Map(
    modules.map((module) => {
      try {
        return [module, readFileSync(require.resolve(module), "utf8")];
      } catch {
        return [module, null];
      }
    }),
  );
}

/** Markers that no longer identify Next's polyfills, so the scan would be blind. */
export function staleMarkers(sources: ReadonlyMap<string, string | null>): string[] {
  return MARKERS.flatMap((marker) =>
    marker.in.flatMap(({ module, optional }) => {
      const source = sources.get(module) ?? null;
      if (source === null) return optional ? [] : [`${module} is not installed`];
      return source.includes(marker.text)
        ? []
        : [`"${marker.text}" is no longer in ${module}; choose a marker that is, in MARKERS`];
    }),
  );
}

export function markersIn(source: string): Marker[] {
  return MARKERS.filter((marker) => source.includes(marker.text));
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
  sources: ReadonlyMap<string, string | null> = nextSources(),
): BundleReport {
  const stale = staleMarkers(sources);
  if (stale.length > 0) return { scanned: 0, problems: stale };
  if (!existsSync(staticDir)) {
    return { scanned: 0, problems: [`no build at ${staticDir}; run \`pnpm build\` first`] };
  }
  const files = scripts(staticDir);
  const problems = files.flatMap((file) => {
    const name = path.relative(staticDir, file).split(path.sep).join("/");
    return markersIn(readFileSync(file, "utf8")).map((marker) => `${name}: ${marker.means}`);
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
    out(
      `check:bundle passed — no Node crypto polyfill or eval probe in ${report.scanned} scripts.`,
    );
    return 0;
  }
  err("check:bundle failed:");
  for (const problem of report.problems) err(`  - ${problem}`);
  err(
    "A client module, or a package one imports, reaches a Node built-in such as `crypto` or `util`.",
  );
  return 1;
}

/**
 * Whether this file is the one Node was asked to run. Both sides are resolved
 * to the real file, so a path through a symbolic link or a junction still
 * counts; compared as typed, it did not, and the check exited 0 unrun.
 */
export function isEntryPoint(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  try {
    return realpathSync.native(argv1) === realpathSync.native(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// Only when run as a script; the tests import the functions above.
if (isEntryPoint(process.argv[1], import.meta.url)) {
  process.exit(run());
}
