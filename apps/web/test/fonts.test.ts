import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * The faces (`src/app/fonts.ts`; DESIGN.md, "Typography"). Literata is
 * self-hosted at weight 600 with its optical-size axis, one face per subset,
 * because `next/font/google` would load the whole weight range to get the axis.
 * What this guards: the files really carry the axis, each face matches only its
 * own subset, the faces are listed so that no fallback stands in for a subset
 * still loading, and nothing is preloaded that a Bulgarian page does not draw —
 * Inter's Latin Extended included.
 */

const APP = path.resolve(__dirname, "../src/app");
const fontsSource = readFileSync(path.join(APP, "fonts.ts"), "utf8");
const globals = readFileSync(path.join(APP, "globals.css"), "utf8");

const SUBSETS = ["cyrillic", "latin-ext", "latin"] as const;
const LITERATA = "literata-opsz-600";
const INTER = "inter-wght-400-700";
const file = (subset: string, family = LITERATA) =>
  path.join(APP, "fonts", `${family}-${subset}.woff2`);

/** Each `localFont({ … })` call in fonts.ts for one family, keyed by the subset it loads. */
function localFontCalls(family = LITERATA): Map<string, string> {
  const calls = new Map<string, string>();
  for (const match of fontsSource.matchAll(/localFont\(\{([\s\S]*?)\n\}\);/g)) {
    const src = new RegExp(`src: "\\./fonts/${family}-([a-z-]+)\\.woff2"`).exec(match[1]!);
    if (src) calls.set(src[1]!, match[1]!);
  }
  return calls;
}

const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca",
  "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
  "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
  "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
]; // prettier-ignore

/**
 * The variation axes of a WOFF2 file: its `fvar` table, read from the
 * decompressed table stream (WOFF2 §4–5). `fvar` is never transformed, so its
 * bytes are as in the font.
 */
function woff2Axes(bytes: Buffer): Array<{ tag: string; min: number; max: number }> {
  expect(bytes.toString("latin1", 0, 4)).toBe("wOF2");
  const numTables = bytes.readUInt16BE(12);
  const compressedLength = bytes.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = bytes[at++]!;
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error("bad UIntBase128");
  };
  const tables: Array<{ tag: string; length: number }> = [];
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[at++]!;
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 0x3f) {
      tag = bytes.toString("latin1", at, at + 4);
      at += 4;
    }
    const version = flags >> 6;
    const origLength = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    const length = transformed ? base128() : origLength;
    tables.push({ tag: tag!, length });
  }
  const stream = brotliDecompressSync(bytes.subarray(at, at + compressedLength));
  let offset = 0;
  for (const table of tables) {
    if (table.tag === "fvar") {
      const fvar = stream.subarray(offset, offset + table.length);
      const axesOffset = fvar.readUInt16BE(4);
      const axisCount = fvar.readUInt16BE(8);
      const axisSize = fvar.readUInt16BE(10);
      return Array.from({ length: axisCount }, (_, i) => {
        const a = axesOffset + i * axisSize;
        return {
          tag: fvar.toString("latin1", a, a + 4),
          min: fvar.readInt32BE(a + 4) / 65536,
          max: fvar.readInt32BE(a + 12) / 65536,
        };
      });
    }
    offset += table.length;
  }
  return [];
}

/** Latin Extended's own `unicode-range` (less what it shares with Latin), as Google serves it. */
const LATIN_EXT_ONLY: ReadonlyArray<readonly [number, number]> = [
  [0x0100, 0x02ba], [0x02bd, 0x02c5], [0x02c7, 0x02cc], [0x02ce, 0x02d7], [0x02dd, 0x02ff],
  [0x1d00, 0x1dbf], [0x1e00, 0x1e9f], [0x1ef2, 0x1eff], [0x2020, 0x2020], [0x20a0, 0x20ab],
  [0x20ad, 0x20c4], [0x2113, 0x2113], [0x2c60, 0x2c7f], [0xa720, 0xa7ff],
]; // prettier-ignore

/** Every committed file whose words reach a page: the catalog snapshot, the copy, the frame. */
function pageText(): Array<{ file: string; text: string }> {
  const ROOT = path.resolve(__dirname, "..");
  const roots = [
    path.resolve(ROOT, "../../reference/latest"),
    path.join(ROOT, "content"),
    path.join(ROOT, "src/i18n"),
    path.join(ROOT, "src/components"),
  ];
  const files: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(json|ts|tsx|md|mdx)$/.test(entry.name))
        files.push({ file: path.relative(ROOT, full), text: readFileSync(full, "utf8") });
    }
  };
  roots.forEach(walk);
  return files;
}

describe("Inter", () => {
  const calls = localFontCalls(INTER);

  it("is one self-hosted face per subset, no longer from next/font/google", () => {
    expect([...calls.keys()].sort()).toEqual([...SUBSETS].sort());
    expect(fontsSource).not.toMatch(/from "next\/font\/google"/);
  });

  it.each(SUBSETS)("%s: carries the weight axis, limited to 400–700", (subset) => {
    const axes = woff2Axes(readFileSync(file(subset, INTER)));
    expect(axes.map((axis) => axis.tag)).toEqual(["wght"]);
    expect(axes[0]).toMatchObject({ min: 400, max: 700 });
    expect(calls.get(subset)).toContain('weight: "400 700"');
  });

  it("gives each face its own unicode-range, Google's", () => {
    for (const subset of SUBSETS) {
      expect(calls.get(subset), subset).toMatch(/prop: "unicode-range"/);
    }
    expect(calls.get("cyrillic")).toContain("U+0400-045F");
    expect(calls.get("latin")).toContain("U+0000-00FF");
  });

  it("preloads Cyrillic and Latin; Latin Extended is declared but fetched on demand", () => {
    expect(calls.get("latin-ext")).toContain("preload: false");
    expect(calls.get("cyrillic")).not.toContain("preload: false");
    expect(calls.get("latin")).not.toContain("preload: false");
  });

  it("puts the size-adjusted Arial on the last face only", () => {
    expect(calls.get("cyrillic")).toContain("adjustFontFallback: false");
    expect(calls.get("latin-ext")).toContain("adjustFontFallback: false");
    expect(calls.get("latin")).toContain('adjustFontFallback: "Arial"');
  });

  it("is listed Cyrillic, Latin Extended, Latin in --font-sans, before the system faces", () => {
    const sans = /--font-sans:([^;]+);/.exec(globals)?.[1]?.replace(/\s+/g, " ").trim();
    expect(sans).toBe(
      "var(--font-inter-cyrillic), var(--font-inter-latin-ext), var(--font-inter-latin), ui-sans-serif, system-ui, -apple-system, sans-serif",
    );
  });

  /* The premise of not preloading Latin Extended. If this fails, a page now
     draws it: the face still loads when needed, but decide whether it should
     be preloaded again (85 KB cost half a second of PSI's mobile LCP). */
  it("Latin Extended is not drawn by any text the shop ships", () => {
    const found: string[] = [];
    for (const { file: name, text } of pageText()) {
      for (const char of text) {
        const code = char.codePointAt(0)!;
        if (LATIN_EXT_ONLY.some(([from, to]) => code >= from && code <= to))
          found.push(`${name}: ${char} (U+${code.toString(16).toUpperCase()})`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe("Literata", () => {
  const calls = localFontCalls();

  it("is one self-hosted face per subset, no longer from next/font/google", () => {
    expect([...calls.keys()].sort()).toEqual([...SUBSETS].sort());
    expect(fontsSource).not.toMatch(/\bLiterata\(\{/);
  });

  it.each(SUBSETS)("%s: carries the optical-size axis, at weight 600 only", (subset) => {
    const axes = woff2Axes(readFileSync(file(subset)));
    expect(axes.map((axis) => axis.tag)).toEqual(["opsz"]);
    expect(axes[0]).toMatchObject({ min: 7, max: 72 });
    expect(calls.get(subset)).toContain('weight: "600"');
  });

  it("gives each face its own unicode-range, so a page fetches only what it draws", () => {
    for (const subset of SUBSETS) {
      expect(calls.get(subset), subset).toMatch(/prop: "unicode-range"/);
    }
    expect(calls.get("cyrillic")).toContain("U+0400-045F");
    expect(calls.get("latin")).toContain("U+0000-00FF");
  });

  it("preloads Cyrillic and Latin, never Latin Extended", () => {
    expect(calls.get("latin-ext")).toContain("preload: false");
    expect(calls.get("cyrillic")).not.toContain("preload: false");
    expect(calls.get("latin")).not.toContain("preload: false");
  });

  it("puts the size-adjusted fallback on the last face only", () => {
    expect(calls.get("cyrillic")).toContain("adjustFontFallback: false");
    expect(calls.get("latin-ext")).toContain("adjustFontFallback: false");
    expect(calls.get("latin")).toContain('adjustFontFallback: "Times New Roman"');
  });

  it("is listed Cyrillic, Latin Extended, Latin in --font-display, before Georgia", () => {
    const display = /--font-display:([^;]+);/.exec(globals)?.[1]?.replace(/\s+/g, " ").trim();
    expect(display).toBe(
      'var(--font-literata-cyrillic), var(--font-literata-latin-ext), var(--font-literata-latin), Georgia, "Times New Roman", serif',
    );
  });
});
