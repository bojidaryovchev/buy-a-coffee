import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_CARD_PHOTO,
  emailImageHeight,
  emailThumbnailUrl,
  isEmailImageKey,
} from "@/emails/email-image";
import { cardImageHeight, cardImageSrc } from "@/emails/product-cards";
import { PRODUCTION_ORIGIN } from "@/emails/theme";

const route = await import("@/app/email-img/[w]/[...key]/route");

const STORE = "https://j6xpmlta50zfdxeo.public.blob.vercel-storage.com";
const CUTOUT = "cutouts/00/a0/00a07b47dee4fbfa0d33a6000991ef556782e73f66aeaad0c442ff10cc2648fe.png";
const PHOTO = "catalog/0a/82/0a8251d99ef0034db768b947b63d952a6079db8057cc63e8f6e6139bac7a5c0d.jpg";

const env = { NEXT_PUBLIC_IMAGE_BASE_URL: STORE };

describe("which pictures get a thumbnail", () => {
  it("takes product photographs and cut-outs from our store, nothing else", () => {
    expect(isEmailImageKey(CUTOUT)).toBe(true);
    expect(isEmailImageKey(PHOTO)).toBe(true);
    expect(isEmailImageKey("newsletter/abc/picture.png")).toBe(false);
    expect(isEmailImageKey("cutouts/../secret.png")).toBe(false);
    expect(isEmailImageKey("cutouts/ab/.hidden.png")).toBe(false);
    expect(isEmailImageKey("cutouts/ab%2F..%2Fx.png")).toBe(false);
    expect(isEmailImageKey("cutouts/ab/cd/readme.txt")).toBe(false);
    expect(isEmailImageKey("CUTOUTS/ab/cd/x.png")).toBe(false);
  });

  it("writes the thumbnail on the production origin, and leaves the rest alone", () => {
    expect(emailThumbnailUrl(`${STORE}/${CUTOUT}`, env)).toBe(
      `${PRODUCTION_ORIGIN}/email-img/224/${CUTOUT}`,
    );
    expect(emailThumbnailUrl(`${STORE}/newsletter/a/b.png`, env)).toBeNull();
    expect(emailThumbnailUrl("https://images.example.com/catalog/a/b.jpg", env)).toBeNull();
    expect(emailThumbnailUrl(`${STORE}/${CUTOUT}`, {})).toBeNull();
  });

  it("draws a thumbnail at its fixed frame, and anything else at its own shape", () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_BASE_URL", STORE);
    expect(cardImageSrc(`${STORE}/${PHOTO}`)).toBe(`${PRODUCTION_ORIGIN}/email-img/224/${PHOTO}`);
    expect(cardImageHeight({ url: `${STORE}/${PHOTO}`, width: 800, height: 1000 })).toBe(
      EMAIL_CARD_PHOTO.height,
    );
    expect(cardImageSrc(`${STORE}/newsletter/a/b.png`)).toBe(
      `${PRODUCTION_ORIGIN}/media/newsletter/a/b.png`,
    );
    expect(cardImageHeight({ url: `${STORE}/newsletter/a/b.png`, width: 800, height: 1200 })).toBe(
      168,
    );
    expect(emailImageHeight(224)).toBe(336);
  });
});

describe("the thumbnail route", () => {
  let requested: string[] = [];

  beforeEach(async () => {
    requested = [];
    vi.stubEnv("NEXT_PUBLIC_IMAGE_BASE_URL", STORE);
    // A transparent cut-out, 430x660, with a red pack in the middle.
    const source = await sharp({
      create: { width: 430, height: 660, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 200,
              height: 400,
              channels: 4,
              background: { r: 200, g: 0, b: 0, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          top: 130,
          left: 115,
        },
      ])
      .png()
      .toBuffer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);
        return url.endsWith(CUTOUT)
          ? new Response(new Uint8Array(source), {
              status: 200,
              headers: { "content-length": String(source.byteLength) },
            })
          : new Response(null, { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const get = (w: string, key: string) =>
    route.GET(new Request(`http://localhost/email-img/${w}/${key}`), {
      params: Promise.resolve({ w, key: key.split("/") }),
    });

  it("returns a small JPEG in the 2:3 frame, flattened on white, cached for a year", async () => {
    const response = await get("224", CUTOUT);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");
    const bytes = Buffer.from(await response.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 224, height: 336 });
    expect(meta.hasAlpha).toBe(false);
    // A corner, where the cut-out was transparent, is white.
    const { data } = await sharp(bytes)
      .extract({ left: 2, top: 2, width: 1, height: 1 })
      .raw()
      .toBuffer({
        resolveWithObject: true,
      });
    expect([...data].every((channel) => channel > 245)).toBe(true);
    expect(bytes.byteLength).toBeLessThan(20_000);
    expect(requested).toEqual([`${STORE}/${CUTOUT}`]);
  });

  it("refuses any other size, prefix or path, without reading anything", async () => {
    for (const [w, key] of [
      ["300", CUTOUT],
      ["224x", CUTOUT],
      ["224", "newsletter/a/b.png"],
      ["224", "cutouts/../x.png"],
      ["224", "cutouts/ab/cd/readme.txt"],
    ] as const) {
      const response = await get(w, key);
      expect(response.status, `${w} ${key}`).toBe(404);
      expect(response.headers.get("cache-control")).toContain("max-age=60");
    }
    expect(requested).toEqual([]);
  });

  it("says 404, briefly cached, for a picture the store does not have", async () => {
    const response = await get("224", PHOTO);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("max-age=60");
  });
});
