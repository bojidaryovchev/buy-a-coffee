import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_PNG_SIZE,
  assertLocalTarget,
  brandSlug,
  deterministicId,
  imageKeyFor,
  placeholderPng,
} from "../scripts/reference-seed";

/*
 * The parts of `seed:reference` that need no database: the guards that keep it
 * away from a real catalog, and the deterministic identity and image bytes that
 * make a second run change nothing. The seed itself, against a real server, is
 * `reference-seed.integration.test.ts`.
 */

const LOCAL = "postgres://catalog:catalog@localhost:5433/catalog";

describe("assertLocalTarget: where the seed may run", () => {
  it("accepts a database on this machine", () => {
    for (const url of [
      LOCAL,
      "postgres://u:p@127.0.0.1:5432/x",
      "postgres://u:p@[::1]:5432/x",
      "postgresql://u:p@LOCALHOST/x",
    ]) {
      expect(() => assertLocalTarget(url, {})).not.toThrow();
    }
  });

  it("refuses any other host, with no way around it", () => {
    for (const url of [
      "postgres://u:p@db.example.com:5432/x",
      "postgres://u:p@ep-cool-name.eu-central-1.aws.neon.tech/x",
      "postgres://u:p@10.0.0.5/x",
      // A host that merely starts like a local one.
      "postgres://u:p@localhost.evil.example/x",
      "postgres://u:p@127.0.0.1.nip.io/x",
    ]) {
      expect(() => assertLocalTarget(url, {}), url).toThrow(/only runs against localhost/);
    }
  });

  it("refuses a deployment even when the host is local", () => {
    expect(() => assertLocalTarget(LOCAL, { VERCEL: "1" })).toThrow(/deployment/);
    expect(() => assertLocalTarget(LOCAL, { NODE_ENV: "production" })).toThrow(/deployment/);
  });

  it("refuses to guess when there is no database url, or an unreadable one", () => {
    expect(() => assertLocalTarget(undefined, {})).toThrow(/DATABASE_URL is not set/);
    expect(() => assertLocalTarget("", {})).toThrow(/DATABASE_URL is not set/);
    expect(() => assertLocalTarget("not a url", {})).toThrow(/not a valid URL/);
  });
});

describe("deterministicId", () => {
  it("is stable, distinct per name, and shaped like a UUID", () => {
    const a = deterministicId("product", "/amann-cascada/#500g");
    expect(deterministicId("product", "/amann-cascada/#500g")).toBe(a);
    expect(deterministicId("product", "/amann-sido/#500g")).not.toBe(a);
    expect(deterministicId("brand", "/amann-cascada/#500g")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("does not let two parts run together into one name", () => {
    expect(deterministicId("ab", "c")).not.toBe(deterministicId("a", "bc"));
  });
});

describe("brandSlug", () => {
  it("cleans the stray space the source leaves in one brand's key", () => {
    expect(brandSlug({ rawSlug: " vergnano", name: "VERGNANO" })).toBe("vergnano");
  });

  it("keeps a hyphenated slug and lower-cases it", () => {
    expect(brandSlug({ rawSlug: "Julius-Meinl", name: "JULIUS MEINL" })).toBe("julius-meinl");
  });

  it("falls back to the name when the slug has no usable characters", () => {
    expect(brandSlug({ rawSlug: "  ", name: "Illy" })).toBe("illy");
  });
});

describe("placeholderPng", () => {
  const png = placeholderPng("some-product/0");

  /** Split a PNG into its chunks, verifying each CRC on the way. */
  function chunks(bytes: Buffer): Array<{ type: string; data: Buffer }> {
    const out: Array<{ type: string; data: Buffer }> = [];
    let offset = 8;
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      const stored = bytes.readUInt32BE(offset + 8 + length);
      expect(stored, `${type} CRC`).toBe(crc32(Buffer.concat([Buffer.from(type), data])));
      out.push({ type, data });
      offset += 12 + length;
    }
    return out;
  }

  function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  it("is a PNG: the signature, then IHDR, IDAT and IEND, each with a correct checksum", () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(chunks(png).map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("declares the size it really has, and its pixel data inflates to exactly that", () => {
    const [header, data] = chunks(png);
    const width = header!.data.readUInt32BE(0);
    const height = header!.data.readUInt32BE(4);
    expect([width, height]).toEqual([PLACEHOLDER_PNG_SIZE, PLACEHOLDER_PNG_SIZE]);
    // Truecolour, 8 bit: one filter byte plus three bytes a pixel, per row.
    expect(inflateSync(data!.data).length).toBe(height * (1 + width * 3));
  });

  it("is small enough to commit to nobody's disk budget", () => {
    expect(png.length).toBeLessThan(400);
  });

  it("is the same bytes every time, and different bytes for a different product", () => {
    expect(placeholderPng("some-product/0").equals(png)).toBe(true);
    expect(placeholderPng("another-product/0").equals(png)).toBe(false);
  });

  it("is sniffed as an image by the same rule the storage layer uses", () => {
    // The sync's `sniffImageType`: JPEG, PNG, GIF, WebP, AVIF or SVG by magic bytes.
    expect(png[0]).toBe(0x89);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  });
});

describe("imageKeyFor", () => {
  it("addresses the bytes by their hash, in the layout the sync's storage uses", () => {
    const bytes = placeholderPng("x/0");
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(imageKeyFor(bytes)).toEqual({
      hash,
      key: `catalog/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.png`,
    });
  });

  it("is a relative path of hex segments: no site name, nothing that escapes the storage root", () => {
    const { key } = imageKeyFor(placeholderPng("y/0"));
    expect(key).toMatch(/^catalog\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
  });
});
