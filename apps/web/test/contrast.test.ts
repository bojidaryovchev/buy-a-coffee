import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  isDeliberateFailure,
  isOutOfGamut,
  loadContrastTable,
  loadTokens,
  parseColorTokens,
  parseContrastTable,
  resolveColor,
  themeBlock,
  truncate2,
} from "./helpers/contrast";

/**
 * `DESIGN.md` carries a table of measured contrast ratios, "the only pairings
 * allowed", computed from the tokens in `globals.css`. A table that nothing
 * checks is a claim, and the first token edit makes it a false one that still
 * reads as authoritative. This recomputes every row from the stylesheet.
 *
 * Three things can be wrong, and each fails here with the row's line number:
 *
 *  - a sanctioned pairing no longer reaches its required ratio (the token
 *    changed and the pairing is now illegible);
 *  - the documented number is not the computed one (the table is stale);
 *  - a pairing recorded as a deliberate failure now passes (it was fixed, or
 *    the tokens moved, and the "never do this" entry is misleading).
 *
 * Rows marked PROHIBITED or LEGACY fail on purpose and are listed so nobody
 * measures them again. They are asserted to *still fail*; they are never
 * counted as passes.
 */

const tokens = loadTokens();
const rows = loadContrastTable();

/** One unit of the last printed place: truncation can differ from rounding by that much. */
const DRIFT = 0.0101;

describe("the design tokens", () => {
  it("are read from the @theme block", () => {
    expect(tokens.size).toBeGreaterThan(30);
    expect(tokens.has("ink-900")).toBe(true);
    expect(tokens.has("paper")).toBe(true);
    // Not a colour: must not be picked up as one.
    expect(tokens.has("shadow-raise")).toBe(false);
  });

  it("are all inside sRGB, as the document states", () => {
    const clipped = [...tokens].filter(([, color]) => isOutOfGamut(color)).map(([name]) => name);
    expect(clipped, "tokens that are clipped when painted").toEqual([]);
  });
});

describe("the contrast table in DESIGN.md", () => {
  it("is found and complete enough to mean something", () => {
    // A parser that quietly found nothing would let every test below pass.
    expect(rows.length).toBeGreaterThanOrEqual(100);
    expect(rows.some(isDeliberateFailure)).toBe(true);
  });

  it("names only tokens that exist", () => {
    const unknown = rows.flatMap((row) =>
      [row.foreground, row.background].flatMap((spec) =>
        spec
          .split("/")
          .filter((part, index) => (index === 0 || index === 2) && !tokens.has(part))
          .map((part) => `${part} (DESIGN.md:${row.line})`),
      ),
    );
    expect(unknown).toEqual([]);
  });

  it("agrees with itself: each Result follows from its Ratio and Required", () => {
    const inconsistent = rows
      .filter((row) => (row.documented >= row.required ? "pass" : "FAIL") !== row.result)
      .map((row) => `DESIGN.md:${row.line} ${row.foreground} on ${row.background}`);
    expect(inconsistent).toEqual([]);
  });

  describe("every sanctioned pairing", () => {
    const sanctioned = rows.filter((row) => !isDeliberateFailure(row));

    it("is marked as passing", () => {
      expect(
        sanctioned.filter((row) => row.result !== "pass").map((row) => `DESIGN.md:${row.line}`),
        "a failing row that is not marked PROHIBITED or LEGACY",
      ).toEqual([]);
    });

    it("still reaches its required ratio, computed from globals.css", () => {
      const failing = sanctioned
        .map((row) => ({ row, ratio: contrastRatio(row.foreground, row.background, tokens) }))
        .filter(({ row, ratio }) => ratio < row.required)
        .map(
          ({ row, ratio }) =>
            `DESIGN.md:${row.line} ${row.foreground} on ${row.background}: ` +
            `${truncate2(ratio).toFixed(2)} < ${row.required} (${row.use})`,
        );
      expect(failing).toEqual([]);
    });

    it("is documented with the number that is computed, to within rounding", () => {
      const drifted = sanctioned
        .map((row) => ({ row, ratio: contrastRatio(row.foreground, row.background, tokens) }))
        .filter(({ row, ratio }) => Math.abs(ratio - row.documented) > DRIFT)
        .map(
          ({ row, ratio }) =>
            `DESIGN.md:${row.line} ${row.foreground} on ${row.background}: ` +
            `documented ${row.documented.toFixed(2)}, computed ${truncate2(ratio).toFixed(2)}`,
        );
      expect(drifted).toEqual([]);
    });
  });

  describe("every deliberate failure", () => {
    const prohibited = rows.filter(isDeliberateFailure);

    it("is recorded as FAIL, so it cannot be mistaken for a sanctioned pairing", () => {
      expect(
        prohibited.filter((row) => row.result !== "FAIL").map((row) => `DESIGN.md:${row.line}`),
      ).toEqual([]);
    });

    it("still fails its required ratio: it is prohibited, not a pass", () => {
      const nowPasses = prohibited
        .map((row) => ({ row, ratio: contrastRatio(row.foreground, row.background, tokens) }))
        .filter(({ row, ratio }) => ratio >= row.required)
        .map(
          ({ row, ratio }) =>
            `DESIGN.md:${row.line} ${row.foreground} on ${row.background} now measures ` +
            `${truncate2(ratio).toFixed(2)} (>= ${row.required}); update the row`,
        );
      expect(nowPasses).toEqual([]);
    });

    it("is documented with the number that is computed, to within rounding", () => {
      const drifted = prohibited.filter(
        (row) =>
          Math.abs(contrastRatio(row.foreground, row.background, tokens) - row.documented) > DRIFT,
      );
      expect(drifted.map((row) => `DESIGN.md:${row.line}`)).toEqual([]);
    });

    it("is not also listed as a sanctioned pairing elsewhere in the table", () => {
      // The same two colours at the same requirement, once banned and once allowed,
      // would make the table contradict itself.
      const key = (row: { foreground: string; background: string; required: number }) =>
        `${row.foreground}|${row.background}|${row.required}`;
      const allowed = new Set(rows.filter((row) => !isDeliberateFailure(row)).map(key));
      expect(
        prohibited.filter((row) => allowed.has(key(row))).map((row) => `line ${row.line}`),
      ).toEqual([]);
    });
  });
});

describe("the contrast checker itself", () => {
  const fixture = parseColorTokens(`
    @theme static {
      /* a comment mentioning --color-ghost: oklch(0 0 0); must not count */
      --color-black: oklch(0 0 0);
      --color-white: oklch(1 0 0);
      --color-mid: oklch(0.6 0 0);
      --font-sans: system-ui;
      --shadow-raise: 0 1px 2px oklch(0.2 0 0 / 0.1);
    }
    .elsewhere { --color-leaked: oklch(0.5 0 0); }
  `);

  it("reads colour tokens from the @theme block only", () => {
    expect([...fixture.keys()].sort()).toEqual(["black", "mid", "white"]);
  });

  it("refuses a token it cannot recompute, instead of skipping it", () => {
    expect(() => parseColorTokens("@theme { --color-x: #ff0000; }")).toThrow(/not oklch/);
  });

  it("computes the textbook extremes: black on white is 21:1", () => {
    expect(contrastRatio("black", "white", fixture)).toBeCloseTo(21, 5);
    expect(contrastRatio("white", "black", fixture)).toBeCloseTo(21, 5);
    expect(contrastRatio("white", "white", fixture)).toBeCloseTo(1, 5);
  });

  it("composites a colour at partial alpha over the colour named after it", () => {
    const [r, g, b] = resolveColor("black/50/white", fixture);
    expect([r, g, b]).toEqual([128, 128, 128]);
  });

  it("truncates and never rounds a ratio up", () => {
    expect(truncate2(4.496)).toBe(4.49);
    expect(truncate2(4.5)).toBe(4.5);
  });

  it("notices when an edit to a token drags a pairing under its requirement", () => {
    const edited = new Map(tokens);
    // Lighten the body ink until it is almost the paper.
    edited.set("ink-900", [0.9, 0.01, 60]);
    const row = rows.find((r) => r.foreground === "ink-900" && r.background === "paper");
    expect(row).toBeDefined();
    expect(contrastRatio("ink-900", "paper", edited)).toBeLessThan(row!.required);
    expect(contrastRatio("ink-900", "paper", tokens)).toBeGreaterThanOrEqual(row!.required);
  });

  it("parses the document's table, and rejects a Result that is neither pass nor FAIL", () => {
    const table = [
      "### Measured contrast",
      "",
      "| Foreground | Background | Ratio | Required | Result | Use |",
      "| --- | --- | --- | --- | --- | --- |",
      "| `ink-900` | `paper` | 16.11 | 4.5 | pass | body |",
      "| `gold-500` | `paper` | 2.85 | 4.5 | FAIL | PROHIBITED: gold text |",
      "",
      "## Next",
    ].join("\n");
    const parsed = parseContrastTable(table);
    expect(parsed.map((row) => [row.foreground, row.documented, row.result])).toEqual([
      ["ink-900", 16.11, "pass"],
      ["gold-500", 2.85, "FAIL"],
    ]);
    expect(isDeliberateFailure(parsed[1]!)).toBe(true);
    expect(isDeliberateFailure(parsed[0]!)).toBe(false);
    expect(() => parseContrastTable(table.replace("| pass |", "| ok |"))).toThrow(/Result/);
  });

  it("finds the whole @theme block even though it contains nested-looking braces in comments", () => {
    expect(themeBlock("@theme static { /* } */ --color-a: oklch(0 0 0); }")).toContain("--color-a");
  });
});
