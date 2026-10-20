import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  MARKERS,
  bundleReport,
  isEntryPoint,
  markersIn,
  nextSources,
  run,
  staleMarkers,
} from "../scripts/check-bundle.ts";

/*
 * `pnpm check:bundle` reads a build, which a unit test does not have. These
 * hold the parts that decide: that its markers are in the polyfills Next would
 * bundle, that a script carrying one fails the check wherever it is, and that
 * the check runs when it is asked to.
 */

const made: string[] = [];
function directory(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "check-bundle-"));
  made.push(root);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

const [CRYPTO, PROBE] = MARKERS as [(typeof MARKERS)[number], (typeof MARKERS)[number]];
const UTIL = "next/dist/compiled/util/util.js";
const ASSERT = "next/dist/compiled/assert/assert.js";

describe("check:bundle", () => {
  it("recognises Next's polyfills: crypto-browserify, and the eval probe in util and assert", () => {
    const sources = nextSources();
    expect(staleMarkers(sources)).toEqual([]);
    expect(markersIn(sources.get("next/dist/compiled/crypto-browserify") ?? "")).toContain(CRYPTO);
    expect(markersIn(sources.get(UTIL) ?? "")).toContain(PROBE);
  });

  it("passes a build without them", () => {
    const report = bundleReport(
      directory({ "chunks/a.js": "console.log(1)", "chunks/b.css": PROBE.text }),
    );
    expect(report).toEqual({ scanned: 1, problems: [] });
    const out: string[] = [];
    expect(run(report, (line) => out.push(line))).toBe(0);
  });

  it("fails on Next's util polyfill, planted in any folder", () => {
    const util = nextSources().get(UTIL) as string;
    const report = bundleReport(
      directory({ "chunks/a.js": "console.log(1)", "chunks/app/x/util.js": util }),
    );
    expect(report.problems).toEqual([`chunks/app/x/util.js: ${PROBE.means}`]);
    const err: string[] = [];
    expect(
      run(
        report,
        () => {},
        (line) => err.push(line),
      ),
    ).toBe(1);
    expect(err.join("\n")).toContain("chunks/app/x/util.js");
  });

  it("fails on crypto-browserify", () => {
    const polyfill = `var a={"sha224WithRSAEncryption":{sign:"rsa"}};`;
    expect(bundleReport(directory({ "chunks/c.js": polyfill })).problems).toEqual([
      `chunks/c.js: ${CRYPTO.means}`,
    ]);
  });

  it("fails rather than pass a bundle unseen", () => {
    expect(bundleReport(path.join(os.tmpdir(), "no-such-build")).problems).toHaveLength(1);

    const sources = new Map(nextSources());
    sources.set(UTIL, "a util polyfill without the probe");
    expect(bundleReport(directory({}), sources).problems).toEqual([
      `"${PROBE.text}" is no longer in ${UTIL}; choose a marker that is, in MARKERS`,
    ]);

    // assert is checked when Next ships it, and not required.
    const withoutAssert = new Map(nextSources());
    withoutAssert.set(ASSERT, null);
    expect(staleMarkers(withoutAssert)).toEqual([]);
    withoutAssert.set(ASSERT, "an assert polyfill without the probe");
    expect(staleMarkers(withoutAssert)).toHaveLength(1);
  });

  it("runs when started through a link", () => {
    const real = directory({ "check.ts": "" });
    const link = path.join(os.tmpdir(), `check-bundle-link-${process.pid}`);
    rmSync(link, { recursive: true, force: true });
    symlinkSync(real, link, "junction");
    made.push(link);
    const moduleUrl = pathToFileURL(path.join(real, "check.ts")).href;

    expect(isEntryPoint(path.join(link, "check.ts"), moduleUrl)).toBe(true);
    expect(isEntryPoint(path.join(real, "check.ts"), moduleUrl)).toBe(true);
    expect(isEntryPoint(path.join(real, "other.ts"), moduleUrl)).toBe(false);
    expect(isEntryPoint(undefined, moduleUrl)).toBe(false);
  });
});
