import { describe, expect, it } from "vitest";
import { parseCopyArgs } from "../src/commands-catalog.ts";

describe("catalog:copy arguments", () => {
  it("plans by default, with the run's limits", () => {
    expect(parseCopyArgs([])).toEqual({
      apply: false,
      limit: 40,
      batchSize: 10,
      slugs: [],
      force: false,
    });
  });

  it("reads every option, in both spellings", () => {
    expect(
      parseCopyArgs([
        "--apply",
        "--limit",
        "5",
        "--batch=3",
        "--slug",
        "a,b",
        "--slug=c",
        "--force",
      ]),
    ).toEqual({ apply: true, limit: 5, batchSize: 3, slugs: ["a", "b", "c"], force: true });
  });

  it("caps a batch at 25 products", () => {
    expect(parseCopyArgs(["--batch", "100"])?.batchSize).toBe(25);
  });

  it("refuses a typo instead of running everything", () => {
    expect(parseCopyArgs(["--limit", "ten"])).toBeNull();
    expect(parseCopyArgs(["--limit", "0"])).toBeNull();
    expect(parseCopyArgs(["--limt", "5"])).toBeNull();
    expect(parseCopyArgs(["--slug"])).toBeNull();
    // --force rewrites only what was named.
    expect(parseCopyArgs(["--force"])).toBeNull();
  });
});
