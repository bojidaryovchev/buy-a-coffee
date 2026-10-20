import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundleReport, markersIn, polyfillSource, run } from "../scripts/check-bundle.ts";

/*
 * `pnpm check:bundle` reads a build, which a unit test does not have. These
 * hold the parts that decide: that its markers are in the polyfill Next would
 * bundle, and that a chunk carrying one fails the check, wherever it is.
 */

const made: string[] = [];
function staticDir(files: Record<string, string>): string {
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

describe("check:bundle", () => {
  it("recognises Next's crypto-browserify", () => {
    expect(markersIn(polyfillSource())).toContain("sha224WithRSAEncryption");
  });

  it("passes a build without it", () => {
    const report = bundleReport(
      staticDir({ "chunks/a.js": "console.log(1)", "chunks/b.css": "sha224WithRSAEncryption" }),
    );
    expect(report).toEqual({ scanned: 1, problems: [] });
    const out: string[] = [];
    expect(run(report, (line) => out.push(line))).toBe(0);
  });

  it("fails on a chunk that carries it, in any folder", () => {
    const polyfill = `var a={"sha224WithRSAEncryption":{sign:"rsa"}};`;
    const report = bundleReport(
      staticDir({ "chunks/a.js": "console.log(1)", "chunks/app/x/b.js": polyfill }),
    );
    expect(report.problems).toEqual(["chunks/app/x/b.js (sha224WithRSAEncryption)"]);
    const err: string[] = [];
    expect(
      run(
        report,
        () => {},
        (line) => err.push(line),
      ),
    ).toBe(1);
    expect(err.join("\n")).toContain("chunks/app/x/b.js");
  });

  it("fails rather than pass a bundle unseen", () => {
    expect(bundleReport(path.join(os.tmpdir(), "no-such-build")).problems).toHaveLength(1);
    expect(bundleReport(staticDir({}), "a polyfill without the marker").problems[0]).toContain(
      "no longer in Next's crypto-browserify",
    );
  });
});
