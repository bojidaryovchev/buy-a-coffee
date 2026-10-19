import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { siteConfig } from "@/config/site";

/*
 * The web app manifest (`app/manifest.ts`), held to what Chrome needs for its
 * install sheet and to the files it names: every icon and screenshot exists in
 * `public/`, at the size the manifest says.
 */

const PUBLIC = path.resolve(import.meta.dirname, "../public");
const data = manifest();

/** Width and height of a PNG or a JPEG, read from its header. */
function dimensions(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  if (bytes.subarray(1, 4).toString("ascii") === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) throw new Error(`${file}: not a JPEG marker at ${offset}`);
      const marker = bytes[offset + 1]!;
      const length = bytes.readUInt16BE(offset + 2);
      // SOF0 … SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  throw new Error(`${file}: neither a PNG nor a JPEG`);
}

const sized = (sizes: string | undefined) => {
  const [width, height] = (sizes ?? "").split("x").map(Number);
  return { width: width!, height: height! };
};

describe("the manifest", () => {
  it("names the shop, with a short name a launcher will not cut", () => {
    expect(data.name).toContain(siteConfig.name);
    expect([...(data.short_name ?? "")].length).toBeLessThanOrEqual(12);
    expect(data.lang).toBe("bg");
  });

  it("is installable: an identity, a start inside its scope, standalone, colours", () => {
    expect(data.id).toBe("/");
    expect(data.scope).toBe("/");
    expect(data.start_url).toBe("/bg");
    expect(data.display).toBe("standalone");
    expect(data.theme_color).toBe("#002c1d");
    expect(data.background_color).toBe("#faf6ee");
  });

  it("has a 192 and a 512 icon, and a maskable one of its own", () => {
    const icons = data.icons ?? [];
    for (const size of ["192x192", "512x512"]) {
      expect(icons.some((icon) => icon.sizes === size && icon.purpose === "any")).toBe(true);
    }
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      const file = path.join(PUBLIC, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      expect(dimensions(file), icon.src).toEqual(sized(icon.sizes));
    }
  });

  it("shows a phone and a desktop screenshot on the install sheet", () => {
    const shots = data.screenshots ?? [];
    expect(shots.some((shot) => shot.form_factor === "narrow")).toBe(true);
    expect(shots.some((shot) => shot.form_factor === "wide")).toBe(true);
  });

  it.each((data.screenshots ?? []).map((shot) => [shot.src, shot] as const))(
    "%s: exists, at its declared size, in proportions Chrome accepts",
    (src, shot) => {
      const file = path.join(PUBLIC, src);
      expect(existsSync(file), `${src}: run scripts/pwa-screenshots.ts`).toBe(true);
      const { width, height } = dimensions(file);
      expect({ width, height }).toEqual(sized(shot.sizes));
      // Chrome: each side 320 to 3840 px, the long one at most 2.3 × the short.
      for (const side of [width, height]) {
        expect(side).toBeGreaterThanOrEqual(320);
        expect(side).toBeLessThanOrEqual(3840);
      }
      expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(2.3);
      // A narrow one stands, a wide one lies down.
      expect(shot.form_factor === "narrow" ? height > width : width > height).toBe(true);
      expect(shot.label?.length).toBeGreaterThan(10);
      expect(readFileSync(file).length).toBeLessThan(600_000);
    },
  );

  it("offers shortcuts into the shop under the locale", () => {
    for (const shortcut of data.shortcuts ?? []) expect(shortcut.url).toMatch(/^\/bg\//);
  });
});
