#!/usr/bin/env node
/**
 * Brand assets, generated from one file.
 *
 * Everything a browser tab, a phone home screen and a share card need is
 * derived from `public/logo.png`. Run it after the logo changes:
 *
 *   pnpm brand:assets
 *
 * Why a script rather than files exported from a design tool once: the favicon,
 * the touch icon and the maskable icon are the same mark at five sizes with
 * three different amounts of padding, and hand-cut sets drift. When one of them
 * is a year out of date it is always the one nobody looks at.
 *
 * No dependencies. PNG is deflate plus four filter types and ICO is a header
 * and some bitmaps; pulling in an image library for that would be a heavier
 * commitment than the code it takes to do directly. Ported from the same script
 * in the three vend repos, which is where the PNG and ICO encoders come from.
 *
 * ⚠ THE SOURCE IS THE FULL LOCKUP, NOT A SEPARATE ICON FILE. The vend repos are
 * handed a square `logo-icon-only.png` to work from. Here there is one asset -
 * the horizontal lockup of the bean mark beside the word - so the mark is cut
 * out of it automatically: trim to the artwork, find the gap between the mark
 * and the lettering, keep the left of it. That is one fewer file for a brand
 * refresh to forget, and it re-derives if the logo is ever replaced.
 */

import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = process.cwd();
const SOURCE = join(ROOT, "public/logo.png");

/* Straight from src/app/globals.css, converted out of oklch. Values rather
   than tokens: this runs in Node, where there is no CSS to read them from.
   The icons must be the same paper as the page behind them, not a near-white
   that reads as grubby next to it. */
const PAPER = [251, 250, 246]; // --color-paper
const PINE_900 = [0, 44, 29]; // --color-pine-900, the header's utility strip

/* -- PNG ------------------------------------------------------------------ */

function decodePng(file) {
  const buf = readFileSync(file);
  const idat = [];
  let pos = 8;
  let width, height, depth, colorType;

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    pos += 12 + len;
  }

  if (depth !== 8) throw new Error(`${file}: bit depth ${depth}, expected 8`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`${file}: colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let p = 0;

  /* Undo the per-scanline filters. Paeth is the only fiddly one. */
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const guess = a + b - c;
        const da = Math.abs(guess - a);
        const db = Math.abs(guess - b);
        const dc = Math.abs(guess - c);
        v += da <= db && da <= dc ? a : db <= dc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }

  /* Normalise everything to RGBA so the rest of the script has one case. */
  if (channels === 4) return { width, height, data: out };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    const grey = channels <= 2;
    rgba[i * 4] = out[j];
    rgba[i * 4 + 1] = grey ? out[j] : out[j + 1];
    rgba[i * 4 + 2] = grey ? out[j] : out[j + 2];
    rgba[i * 4 + 3] = channels === 2 ? out[j + 1] : channels === 4 ? out[j + 3] : 255;
  }
  return { width, height, data: rgba };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter 0; these are flat graphics, not photos
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -- cutting the lockup up ------------------------------------------------ */

/** Which columns and rows carry any artwork at all. */
function occupancy(img) {
  const { width, height, data } = img;
  const cols = new Uint32Array(width);
  const rows = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      /* Alpha alone: the source is transparent-ground RGBA, so anything drawn
         is opaque and anything else is not there. A colour-distance test would
         also have to guess at a background that does not exist. */
      if (data[(y * width + x) * 4 + 3] > 16) {
        cols[x]++;
        rows[y]++;
      }
    }
  }
  return { cols, rows };
}

function crop(img, x0, y0, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    img.data.copy(out, y * w * 4, ((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x0 + w) * 4);
  }
  return { width: w, height: h, data: out };
}

/** Everything outside the artwork removed. */
function trim(img) {
  const { cols, rows } = occupancy(img);
  const first = (arr) => arr.findIndex((n) => n > 0);
  const last = (arr) => arr.length - 1 - [...arr].reverse().findIndex((n) => n > 0);
  const x0 = first(cols);
  const y0 = first(rows);
  if (x0 < 0) throw new Error("logo.png is entirely transparent");
  return crop(img, x0, y0, last(cols) - x0 + 1, last(rows) - y0 + 1);
}

/**
 * The bean mark, cut out of the lockup.
 *
 * The mark and the lettering are separated by a wider run of empty columns than
 * anything inside the lettering, so the widest gap is the cut. On the current
 * artwork that is 56px against 16px for the widest inter-letter gap.
 *
 * A fixed fraction of the width was tried first and is the wrong tool: 5% is
 * 79px here, which is larger than the gap it was meant to find. The comparison
 * that matters is against the other gaps in this image, not against its width.
 *
 * The 1.5x margin below is the sanity check. A lockup whose widest gap is not
 * clearly wider than its second widest has no obvious cut - most likely because
 * it is the mark on its own, with no lettering to separate from - and guessing
 * at one would silently produce a cropped icon.
 */
function extractMark(lockup) {
  const { cols } = occupancy(lockup);

  const gaps = [];
  let run = 0;
  for (let x = 0; x < lockup.width; x++) {
    if (cols[x] === 0) {
      run++;
    } else {
      if (run > 0) gaps.push({ endsAt: x, width: run });
      run = 0;
    }
  }

  if (gaps.length === 0) return trim(lockup);

  const sorted = [...gaps].sort((a, b) => b.width - a.width);
  const widest = sorted[0];
  const runnerUp = sorted[1]?.width ?? 0;

  if (widest.width < runnerUp * 1.5) {
    throw new Error(
      `no clear gap in public/logo.png - widest ${widest.width}px against ` +
        `${runnerUp}px. Is it already the mark on its own?`,
    );
  }

  return trim(crop(lockup, 0, 0, widest.endsAt - widest.width, lockup.height));
}

/** Centre an image on a transparent square, so nothing is ever distorted. */
function square(img) {
  const size = Math.max(img.width, img.height);
  const out = Buffer.alloc(size * size * 4);
  const dx = Math.round((size - img.width) / 2);
  const dy = Math.round((size - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    img.data.copy(out, ((y + dy) * size + dx) * 4, y * img.width * 4, (y + 1) * img.width * 4);
  }
  return { width: size, height: size, data: out };
}

/* -- pixels --------------------------------------------------------------- */

/**
 * Area-average downscale, alpha premultiplied.
 *
 * Premultiplying matters: averaging the colour of a transparent pixel in with
 * its neighbours drags a dark halo around every edge, which at 16px is most of
 * the icon.
 */
function resize(img, width, height = width) {
  const { width: sw, height: sh, data } = img;
  const out = Buffer.alloc(width * height * 4);
  const sx = sw / width;
  const sy = sh / height;

  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;

      for (let py = y0; py < Math.min(y1, sh); py++) {
        for (let px = x0; px < Math.min(x1, sw); px++) {
          const i = (py * sw + px) * 4;
          const al = data[i + 3] / 255;
          r += data[i] * al;
          g += data[i + 1] * al;
          b += data[i + 2] * al;
          a += al;
          n++;
        }
      }

      const d = (y * width + x) * 4;
      const alpha = a / n;
      out[d] = alpha > 0 ? Math.round(r / n / alpha) : 0;
      out[d + 1] = alpha > 0 ? Math.round(g / n / alpha) : 0;
      out[d + 2] = alpha > 0 ? Math.round(b / n / alpha) : 0;
      out[d + 3] = Math.round(alpha * 255);
    }
  }
  return { width, height, data: out };
}

/** The mark centred on an opaque square, filling `fill` of the width. */
function plate(mark, size, fill, background) {
  const scale = Math.min((size * fill) / mark.width, (size * fill) / mark.height);
  const w = Math.max(1, Math.round(mark.width * scale));
  const h = Math.max(1, Math.round(mark.height * scale));
  const scaled = resize(mark, w, h);
  const dx = Math.round((size - w) / 2);
  const dy = Math.round((size - h) / 2);
  const out = Buffer.alloc(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    out[i * 4] = background[0];
    out[i * 4 + 1] = background[1];
    out[i * 4 + 2] = background[2];
    out[i * 4 + 3] = 255;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const alpha = scaled.data[s + 3] / 255;
      if (alpha === 0) continue;
      const d = ((y + dy) * size + (x + dx)) * 4;
      for (let c = 0; c < 3; c++) {
        out[d + c] = Math.round(scaled.data[s + c] * alpha + out[d + c] * (1 - alpha));
      }
    }
  }
  return { width: size, height: size, data: out };
}

/* -- ICO ------------------------------------------------------------------ */

/**
 * A multi-size .ico, in BMP rather than PNG entries.
 *
 * PNG-in-ICO is smaller and every browser released this decade reads it, but
 * .ico is the format that exists precisely for the things that are not modern
 * browsers - the Windows taskbar, a pinned tile, whatever an intranet is
 * running. BMP entries cost a few KB and never surprise anyone.
 */
function encodeIco(images) {
  const bodies = [];

  for (const img of images) {
    const { width: w, height: h, data } = img;
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(w, 4);
    header.writeInt32LE(h * 2, 8); // XOR bitmap plus the AND mask below it
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    header.writeUInt32LE(w * h * 4, 20);

    /* Bottom-up BGRA, the way BMP has always wanted it. */
    const pixels = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((h - 1 - y) * w + x) * 4;
        const d = (y * w + x) * 4;
        pixels[d] = data[s + 2];
        pixels[d + 1] = data[s + 1];
        pixels[d + 2] = data[s];
        pixels[d + 3] = data[s + 3];
      }
    }

    /* Every pixel is opaque, so the 1bpp mask is all zeros - but it has to be
       there, padded to four-byte rows, or the icon renders as garbage. */
    const maskStride = Math.ceil(w / 32) * 4;
    const mask = Buffer.alloc(maskStride * h);

    bodies.push(Buffer.concat([header, pixels, mask]));
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = 6 + directory.length;

  images.forEach((img, i) => {
    const at = i * 16;
    directory[at] = img.width === 256 ? 0 : img.width;
    directory[at + 1] = img.height === 256 ? 0 : img.height;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(bodies[i].length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += bodies[i].length;
  });

  return Buffer.concat([header, directory, ...bodies]);
}

/* -- what gets written ---------------------------------------------------- */

function write(path, buffer, note) {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, buffer);
  console.log(
    `  ${path.padEnd(34)} ${String((buffer.length / 1024).toFixed(1) + "KB").padStart(8)}  ${note}`,
  );
}

const source = decodePng(SOURCE);
const lockup = trim(source);
const mark = square(extractMark(lockup));

console.log(
  `\nFrom public/logo.png (${source.width}x${source.height})` +
    `\n  lockup ${lockup.width}x${lockup.height}, mark ${mark.width}x${mark.height}\n`,
);

/**
 * The lockup with its transparent margin removed.
 *
 * The source carries roughly 240px of empty space above and below the artwork,
 * which is invisible until something tries to size it: a header that sets a
 * height gets a wordmark occupying half of it, sitting off-centre. The header
 * uses this one.
 */
write("public/logo-lockup.png", encodePng(lockup), "header wordmark");

/** The mark on its own. Every icon below is cut from this. */
write("public/logo-icon-only.png", encodePng(mark), "the bean, squared");

/* Browsers. Fill climbs as the size drops, because a 16px icon needs
   proportionally less padding than a 512px one - at 16px the padding IS the
   icon. Values run a little higher than the vend repos' because this mark is
   tall and narrow, so it carries less visual weight at the same fill. */
write(
  "src/app/favicon.ico",
  encodeIco([
    plate(mark, 16, 0.96, PAPER),
    plate(mark, 32, 0.92, PAPER),
    plate(mark, 48, 0.9, PAPER),
  ]),
  "16/32/48, tab and taskbar",
);

write("src/app/icon.png", encodePng(plate(mark, 192, 0.84, PAPER)), "PNG icon");

/* iOS ignores transparency and applies its own rounded mask, so this one keeps
   well clear of the corners. */
write(
  "src/app/apple-icon.png",
  encodePng(plate(mark, 180, 0.78, PAPER)),
  "iPhone home screen",
);

/* The manifest cannot point at Next's hashed /icon route, so its icons live in
   public/ under stable names. */
write("public/icon-192.png", encodePng(plate(mark, 192, 0.84, PAPER)), "manifest");
write("public/icon-512.png", encodePng(plate(mark, 512, 0.84, PAPER)), "manifest");

/* Android crops maskable icons to whatever shape the launcher likes. The
   guaranteed area is the middle 80% circle, which a square only fits inside at
   about 56% of the width. Anything bigger loses corners on some phones. */
write(
  "public/icon-maskable-512.png",
  encodePng(plate(mark, 512, 0.56, PAPER)),
  "Android, with crop margin",
);

/**
 * For the share card.
 *
 * Deliberately small and in `public/`. `opengraph-image.tsx` inlines it as a
 * data URI into a budget it shares with everything else on the card, and it has
 * to be somewhere the deployed server can actually read - a `readFile` at
 * request time is not something Next can trace, and only `public/` is
 * guaranteed to ship.
 */
write(
  "public/og-lockup.png",
  encodePng(resize(lockup, 880, Math.round((880 / lockup.width) * lockup.height))),
  "for opengraph-image",
);

console.log(`\nDone. Paper ${PAPER.join(",")}, pine ${PINE_900.join(",")}.\n`);
