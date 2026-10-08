import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * WCAG contrast from the design tokens, the way `DESIGN.md` measures it.
 *
 * The method is written down in that document ("Measured contrast") and is
 * reproduced here step for step, because the table is only evidence while the
 * numbers in it can be regenerated:
 *
 *   1. OKLCH -> linear sRGB (Ottosson's matrices);
 *   2. clip to gamut, encode to 8-bit sRGB, and carry on from the 8-bit values,
 *      so the ratio is the one a browser paints and not an idealised one;
 *   3. WCAG 2.x relative luminance and contrast ratio;
 *   4. ratios are *truncated* to two decimals in the document, never rounded up.
 *
 * `a/NN/b` in the document means `a` at NN% alpha composited over `b`.
 */

const ROOT = path.resolve(import.meta.dirname, "../../../..");
export const GLOBALS_CSS = path.join(ROOT, "apps/web/src/app/globals.css");
export const DESIGN_MD = path.join(ROOT, "DESIGN.md");

export type Oklch = readonly [lightness: number, chroma: number, hue: number];

/* --- Reading the stylesheet --------------------------------------------- */

/** The text between the braces of the `@theme` block, comments removed. */
export function themeBlock(source: string): string {
  // Comments first: a brace or a token name inside one is not part of the block.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const start = css.search(/@theme\b[^{]*\{/);
  if (start < 0) throw new Error("globals.css has no @theme block");
  const open = css.indexOf("{", start);

  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("the @theme block in globals.css is never closed");
}

/**
 * Every `--color-<name>: oklch(L C H)` in the `@theme` block, keyed by `<name>`.
 *
 * Only `oklch()` is understood. A token written in any other notation is an
 * error rather than a silent omission, because a pairing that cannot be
 * recomputed cannot be checked.
 */
export function parseColorTokens(css: string): Map<string, Oklch> {
  const tokens = new Map<string, Oklch>();
  for (const [, name, value] of themeBlock(css).matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)) {
    const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(
      (value as string).trim(),
    );
    if (!match) {
      throw new Error(
        `--color-${name} is "${(value as string).trim()}", which is not oklch(L C H)`,
      );
    }
    const lightness = Number(match[1]) / (match[2] === "%" ? 100 : 1);
    tokens.set(name as string, [lightness, Number(match[3]), Number(match[4])]);
  }
  return tokens;
}

/* --- The arithmetic ------------------------------------------------------ */

type Rgb = [number, number, number];

function linearSrgb([lightness, chroma, hue]: Oklch): Rgb {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const encode = (v: number): number =>
  Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
const decode = (byte: number): number => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** The 8-bit sRGB value a browser paints for this colour. */
export function toSrgb8(color: Oklch): Rgb {
  return linearSrgb(color).map((v) => encode(clamp01(v))) as Rgb;
}

/** True when the colour does not fit sRGB and is clipped when painted. */
export function isOutOfGamut(color: Oklch, tolerance = 0.0005): boolean {
  return linearSrgb(color).some((v) => v < -tolerance || v > 1 + tolerance);
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(decode) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const mix = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
  fg.map((v, i) => Math.round(v * alpha + (bg[i] as number) * (1 - alpha))) as Rgb;

/** A colour as the document names it: a token, or `token/NN/under`. */
export function resolveColor(spec: string, tokens: ReadonlyMap<string, Oklch>): Rgb {
  const [name, alpha, under] = spec.split("/");
  const token = (key: string | undefined): Oklch => {
    const value = key ? tokens.get(key) : undefined;
    if (!value) throw new Error(`unknown colour token "${key}" in "${spec}"`);
    return value;
  };
  return alpha
    ? mix(toSrgb8(token(name)), toSrgb8(token(under)), Number(alpha) / 100)
    : toSrgb8(token(name));
}

export function contrastRatio(
  foreground: string,
  background: string,
  tokens: ReadonlyMap<string, Oklch>,
): number {
  const a = luminance(resolveColor(foreground, tokens));
  const b = luminance(resolveColor(background, tokens));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The document truncates; it never rounds a ratio up (4.496 is not 4.50). */
export const truncate2 = (ratio: number): number => Math.floor(ratio * 100) / 100;

/* --- Reading the document ------------------------------------------------ */

export interface ContrastRow {
  readonly foreground: string;
  readonly background: string;
  readonly documented: number;
  readonly required: number;
  readonly result: "pass" | "FAIL";
  readonly use: string;
  /** 1-based line in DESIGN.md, for failure messages. */
  readonly line: number;
}

/** The rows of the table under "Measured contrast". */
export function parseContrastTable(markdown: string): ContrastRow[] {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^#{1,6}\s+Measured contrast\s*$/.test(line));
  if (heading < 0) throw new Error('DESIGN.md has no "Measured contrast" heading');

  const rows: ContrastRow[] = [];
  let inTable = false;
  for (let i = heading + 1; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (/^#{1,6}\s/.test(line)) break;
    if (!line.trimStart().startsWith("|")) {
      if (inTable) break;
      continue;
    }
    inTable = true;

    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 6 || !/^`/.test(cells[0] as string)) continue; // header or separator

    const [foreground, background, ratio, required, result, ...use] = cells;
    const unquote = (cell: string | undefined) => (cell ?? "").replace(/^`|`$/g, "");
    if (result !== "pass" && result !== "FAIL") {
      throw new Error(`DESIGN.md:${i + 1}: Result must be "pass" or "FAIL", not "${result}"`);
    }
    rows.push({
      foreground: unquote(foreground),
      background: unquote(background),
      documented: Number(ratio),
      required: Number(required),
      result,
      use: use.join("|"),
      line: i + 1,
    });
  }
  return rows;
}

/** A row the document records as failing on purpose: a prohibited or legacy use. */
export const isDeliberateFailure = (row: ContrastRow): boolean =>
  /^(PROHIBITED|LEGACY)\b/.test(row.use);

export function loadTokens(): Map<string, Oklch> {
  return parseColorTokens(readFileSync(GLOBALS_CSS, "utf8"));
}

export function loadContrastTable(): ContrastRow[] {
  return parseContrastTable(readFileSync(DESIGN_MD, "utf8"));
}
