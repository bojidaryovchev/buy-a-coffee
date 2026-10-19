import { readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * The faces (`src/app/fonts.ts`; DESIGN.md, "Typography"). Literata is
 * self-hosted at weight 600 with its optical-size axis, one face per subset,
 * because `next/font/google` would load the whole weight range to get the axis.
 * What this guards: the files really carry the axis, each face matches only its
 * own subset, the faces are listed so that no fallback stands in for a subset
 * still loading, and nothing is preloaded that a Bulgarian page does not draw.
 */

const APP = path.resolve(__dirname, "../src/app");
const fontsSource = readFileSync(path.join(APP, "fonts.ts"), "utf8");
const globals = readFileSync(path.join(APP, "globals.css"), "utf8");

const SUBSETS = ["cyrillic", "latin-ext", "latin"] as const;
const file = (subset: string) => path.join(APP, "fonts", `literata-opsz-600-${subset}.woff2`);

/** Each `localFont({ … })` call in fonts.ts, keyed by the file it loads. */
function localFontCalls(): Map<string, string> {
  const calls = new Map<string, string>();
  for (const match of fontsSource.matchAll(/localFont\(\{([\s\S]*?)\n\}\);/g)) {
    const src = /src: "\.\/fonts\/literata-opsz-600-([a-z-]+)\.woff2"/.exec(match[1]!);
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

describe("Inter", () => {
  it("keeps Latin Extended: dropping it was measured and made the first paint later", () => {
    expect(fontsSource).toMatch(/Inter\(\{\s*subsets: \["latin", "latin-ext", "cyrillic"\],/);
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
