import { readFile } from "node:fs/promises";
import path from "node:path";
import { isAllowedImageUrl, isPlaceholderImage } from "@/lib/catalog/images";

/**
 * A picture for a share card, as a `data:` URI satori can draw with its size,
 * or null.
 *
 * Satori fetches nothing well on its own — a slow image host stalls the whole
 * card — and draws an image only at a size it is told, so every picture is
 * read here first, with a deadline, its size taken from its own header, and
 * handed in whole. Three sources, each the one the rest of the storefront uses:
 *
 *  - a product photograph on the image host (production): fetched, only from
 *    the configured host (`isAllowedImageUrl`, the rule that keeps the source
 *    site's images off this one);
 *  - a product photograph under `/media/` (a laptop with no image host): read
 *    from `STORAGE_LOCAL_DIR`, as the `/media` route reads it;
 *  - a file of our own in `public/` — the lockup, the mark, a brand's logo.
 *
 * Anything else, the placeholder drawing included, is null: a card shows no
 * picture rather than a grey outline posing as one, or a broken image.
 */

export interface CardPicture {
  readonly src: string;
  /** Intrinsic size, in pixels (an SVG: its `viewBox`). */
  readonly width: number;
  readonly height: number;
}

const TYPES: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** A card is drawn on request; a photograph that has not arrived by then is left out. */
const FETCH_DEADLINE_MS = 4000;
const MAX_BYTES = 4 * 1024 * 1024;

/** Width and height from a PNG's, a JPEG's or an SVG's own header; null when unreadable. */
export function intrinsicSize(
  type: string,
  bytes: Buffer,
): { width: number; height: number } | null {
  if (type === "image/png" && bytes.length > 24 && bytes.subarray(1, 4).toString() === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (type === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]!;
      // SOF0 … SOF15 carry the frame size; DHT, JPG and DAC share the range.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
    return null;
  }
  if (type === "image/svg+xml") {
    const head = bytes.subarray(0, 4096).toString("utf8");
    const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
    if (box) return { width: Number(box[1]), height: Number(box[2]) };
    const width = /\swidth\s*=\s*["']([\d.]+)/i.exec(head);
    const height = /\sheight\s*=\s*["']([\d.]+)/i.exec(head);
    if (width && height) return { width: Number(width[1]), height: Number(height[1]) };
  }
  return null;
}

function picture(type: string, bytes: Buffer): CardPicture | null {
  const size = intrinsicSize(type, bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return { src: `data:${type};base64,${bytes.toString("base64")}`, ...size };
}

/** A file under a root, never outside it, however the path is spelled. */
async function readUnder(root: string, relativePath: string): Promise<Buffer | null> {
  const resolved = path.resolve(root, relativePath.replace(/^\/+/, ""));
  const inside = path.relative(root, resolved);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return readFile(resolved).catch(() => null);
}

export async function imageDataUri(url: string | null | undefined): Promise<CardPicture | null> {
  if (!url || isPlaceholderImage(url)) return null;

  if (/^https?:\/\//i.test(url)) {
    if (!isAllowedImageUrl(url)) return null;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_DEADLINE_MS) });
      const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      if (!response.ok || !["image/jpeg", "image/png"].includes(type)) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.length <= MAX_BYTES ? picture(type, bytes) : null;
    } catch {
      return null;
    }
  }

  const type = TYPES[path.extname(url).toLowerCase()];
  if (!type) return null;

  if (url.startsWith("/media/")) {
    // Development only, exactly when the `/media` route itself serves.
    if (process.env.NEXT_PUBLIC_IMAGE_BASE_URL) return null;
    const root = path.resolve(
      /* turbopackIgnore: true */ process.env.STORAGE_LOCAL_DIR ?? ".storage",
    );
    const bytes = await readUnder(root, url.slice("/media/".length));
    return bytes ? picture(type, bytes) : null;
  }

  const bytes = await readUnder(
    path.join(/* turbopackIgnore: true */ process.cwd(), "public"),
    url,
  );
  return bytes ? picture(type, bytes) : null;
}

/** The largest size a picture fits a box at, its proportions kept. */
export function fitWithin(
  picture: Pick<CardPicture, "width" | "height">,
  box: { readonly width: number; readonly height: number },
): { width: number; height: number } {
  const scale = Math.min(box.width / picture.width, box.height / picture.height);
  return {
    width: Math.max(1, Math.floor(picture.width * scale)),
    height: Math.max(1, Math.floor(picture.height * scale)),
  };
}
