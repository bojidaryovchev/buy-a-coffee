/**
 * A picture's pixel size, read from the first bytes of its file: JPEG, PNG,
 * GIF and WebP, the formats the catalog's photographs and the newsletter's
 * uploads come in.
 *
 * Why it is needed: the catalog stores no sizes for its photographs (the sync
 * never wrote them), and a card in a letter wants one — Outlook shows no
 * images until the reader allows them, and an `<img>` without a height then
 * collapses, so the row jumps when the picture arrives (`product-cards.tsx`).
 * The size is read once per address, when a letter's products are resolved
 * (`product-source.ts`), and kept in the send's snapshot.
 *
 * Pure: bytes in, size or null out. Null for anything it does not recognise
 * or that is cut short; a card without a size is still a card.
 */

export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

const valid = (width: number, height: number): PixelSize | null =>
  width > 0 && height > 0 ? { width, height } : null;

const u16be = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
const u16le = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8);
const u24le = (bytes: Uint8Array, at: number) =>
  bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
const u32be = (bytes: Uint8Array, at: number) =>
  ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/** Start-of-frame markers, which carry the size: every SOFn but DHT, JPG and DAC. */
const JPEG_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpeg(bytes: Uint8Array): PixelSize | null {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    // Markers that stand alone, without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    if (JPEG_FRAME.has(marker)) {
      if (at + 9 > bytes.length) return null;
      return valid(u16be(bytes, at + 7), u16be(bytes, at + 5));
    }
    at += 2 + u16be(bytes, at + 2);
  }
  return null;
}

function webp(bytes: Uint8Array): PixelSize | null {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return valid(u24le(bytes, 24) + 1, u24le(bytes, 27) + 1);
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return valid(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return null;
}

export function imageSize(bytes: Uint8Array): PixelSize | null {
  if (bytes.length >= 24 && u32be(bytes, 0) === 0x89504e47 && ascii(bytes, 12, 4) === "IHDR") {
    return valid(u32be(bytes, 16), u32be(bytes, 20));
  }
  if (bytes.length >= 10 && ascii(bytes, 0, 4) === "GIF8") {
    return valid(u16le(bytes, 6), u16le(bytes, 8));
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  if (bytes.length >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return webp(bytes);
  }
  return null;
}
