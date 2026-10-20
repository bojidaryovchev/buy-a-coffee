import sharp from "sharp";
import { emailImageHeight, isEmailImageKey, isEmailImageWidth } from "@/emails/email-image";
import { mediaStoreBase } from "@/emails/media";

/**
 * A product photograph or cut-out, as a small JPEG for an email card.
 *
 *   GET /email-img/224/cutouts/ab/cd/<sha256>.png
 *   GET /email-img/224/catalog/ab/cd/<sha256>.jpg
 *
 * Fitted into a fixed 2:3 frame on white and re-encoded at quality 80, so a
 * card's picture is a few kilobytes instead of the original's tens or
 * hundreds, and its `width` and `height` attributes are always right (see
 * `emails/email-image.ts` for why this is not `/_next/image`).
 *
 * NO SESSION, because a mail client fetches it - so everything it may be asked
 * for is fixed in advance: a width from a set of two, and a key under
 * `catalog/` or `cutouts/` in safe segments only, read from our own store and
 * nowhere else. No other file can be named and no other size can be made.
 *
 * Cached for a year, immutable, by browsers and by Vercel's CDN: a sent email
 * cannot be re-rendered, so its picture should never change underneath it,
 * and the CDN answers every reader after the first. Store keys are content
 * hashes, so a new photograph is a new address. A failure is cached for a
 * minute only, so a picture that arrives later is not refused for a year.
 *
 * sharp is Next's own image library, a default server-external package, loaded
 * from node_modules at runtime with the native binary for the platform.
 */

const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";
const BRIEF = "public, max-age=60, s-maxage=60";

/** Far larger than any product photograph or cut-out (the largest is ~0.6 MB). */
const SOURCE_MAX_BYTES = 8 * 1024 * 1024;

const refuse = (status: number) =>
  new Response(null, { status, headers: { "cache-control": BRIEF } });

async function readSource(key: string): Promise<Buffer | null> {
  const base = mediaStoreBase();
  if (!base) return null;
  const response = await fetch(`${base.origin}${base.pathname.replace(/\/+$/, "")}/${key}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > SOURCE_MAX_BYTES) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.byteLength > SOURCE_MAX_BYTES ? null : bytes;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ w: string; key: string[] }> },
): Promise<Response> {
  const { w, key: segments } = await context.params;

  const width = Number(w);
  if (!/^\d+$/.test(w) || !isEmailImageWidth(width)) return refuse(404);
  const key = segments.join("/");
  if (!isEmailImageKey(key)) return refuse(404);

  let input: Buffer | null;
  try {
    input = await readSource(key);
  } catch (err) {
    console.error("Снимката за имейла не беше прочетена:", err);
    return refuse(502);
  }
  if (!input) return refuse(404);

  try {
    const jpeg = await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(width, emailImageHeight(width), { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    return new Response(new Uint8Array(jpeg), {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(jpeg.byteLength),
        "cache-control": IMMUTABLE,
      },
    });
  } catch (err) {
    console.error("Снимката за имейла не беше преоразмерена:", err);
    return refuse(422);
  }
}
