import { afterEach, describe, expect, it, vi } from "vitest";
import { newsletterProductsFixture } from "@/emails/fixtures";
import { imageSize } from "@/lib/newsletter/image-size";
import { withImageSizes, type ProductBlocksSnapshot } from "@/lib/newsletter/product-blocks";

/**
 * A photograph's size, read from the head of its file: the catalog stores no
 * sizes, and a card in a letter needs one to keep its height in a client that
 * blocks images. The four formats the store holds, read from bytes built
 * here; the snapshot filled in from them; and the server reading only from
 * our own store.
 */

vi.mock("@/lib/catalog/queries", () => ({}));

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );
const be32 = (value: number) => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];
const be16 = (value: number) => [(value >>> 8) & 255, value & 255];
const le16 = (value: number) => [value & 255, (value >>> 8) & 255];
const le24 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255];

const PNG = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], be32(13), "IHDR", be32(800), be32(1200));
const GIF = bytes("GIF89a", le16(640), le16(480));
const JPEG = bytes(
  [0xff, 0xd8],
  // APP0 (JFIF), 16 bytes long, to be skipped
  [0xff, 0xe0],
  be16(16),
  "JFIF",
  [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
  // A fill byte, then the baseline frame: precision, height, width
  [0xff, 0xff, 0xc0],
  be16(17),
  [8],
  be16(1200),
  be16(800),
  [3],
);
const WEBP = bytes(
  "RIFF",
  [0, 0, 0, 0],
  "WEBP",
  "VP8X",
  be32(10).reverse(),
  [0, 0, 0, 0],
  le24(799),
  le24(599),
);

describe("reading a picture's size", () => {
  it("reads PNG, GIF, JPEG and WebP headers", () => {
    expect(imageSize(PNG)).toEqual({ width: 800, height: 1200 });
    expect(imageSize(GIF)).toEqual({ width: 640, height: 480 });
    expect(imageSize(JPEG)).toEqual({ width: 800, height: 1200 });
    expect(imageSize(WEBP)).toEqual({ width: 800, height: 600 });
  });

  it("answers nothing for what it does not recognise, or a file cut short", () => {
    expect(imageSize(bytes("%PDF-1.7 and so on"))).toBeNull();
    expect(imageSize(new Uint8Array())).toBeNull();
    expect(imageSize(JPEG.subarray(0, 24))).toBeNull();
    expect(
      imageSize(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], be32(13), "IHDR", be32(0), be32(5))),
    ).toBeNull();
  });
});

describe("a snapshot's photographs", () => {
  const unsized = (): ProductBlocksSnapshot => {
    const snapshot = structuredClone(newsletterProductsFixture.products!);
    for (const block of snapshot.blocks) {
      for (const product of block.products) {
        if (product.image) product.image = { ...product.image, width: null, height: null };
      }
    }
    // One that already has its size keeps it, unasked.
    snapshot.blocks[0]!.products[0]!.image = {
      ...snapshot.blocks[0]!.products[0]!.image!,
      width: 800,
      height: 1200,
    };
    return snapshot;
  };

  it("get a size for each photograph without one, each address asked once and all at once", async () => {
    const measure = vi.fn(async (url: string) =>
      url.includes("e2df") ? null : { width: 800, height: 800 },
    );
    const sized = await withImageSizes(unsized(), measure);
    const images = sized.blocks.flatMap((block) => block.products.map((product) => product.image));
    expect(images[0]).toMatchObject({ width: 800, height: 1200 });
    // Molini Torino's photograph could not be read: no size, and no harm.
    expect(images.find((image) => image?.url.includes("e2df"))).toMatchObject({
      width: null,
      height: null,
    });
    expect(images.filter((image) => image?.width === 800 && image.height === 800)).toHaveLength(3);
    const asked = measure.mock.calls.map(([url]) => url);
    expect(new Set(asked).size).toBe(asked.length);
    expect(asked).not.toContain(images[0]!.url);
  });

  it("leaves a snapshot whose photographs all have sizes as it is", async () => {
    const measure = vi.fn();
    const snapshot = newsletterProductsFixture.products!;
    expect(await withImageSizes(snapshot, measure)).toBe(snapshot);
    expect(measure).not.toHaveBeenCalled();
  });

  it("does not let a failed read take the letter down", async () => {
    const sized = await withImageSizes(unsized(), async () => {
      throw new Error("timeout");
    });
    expect(sized.blocks[2]!.products[0]!.image).toMatchObject({ width: null, height: null });
  });
});

describe("measuring on the server", () => {
  const STORE = "https://j6xpmlta50zfdxeo.public.blob.vercel-storage.com";

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads only from our own store, the head of the file, and remembers the answer", async () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_BASE_URL", STORE);
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JPEG, { status: 206 }),
    );
    vi.stubGlobal("fetch", fetch);
    const { measureStoreImage } = await import("@/lib/newsletter/product-source");

    const url = `${STORE}/catalog/ab/cd/remembered.jpg`;
    expect(await measureStoreImage(url)).toEqual({ width: 800, height: 1200 });
    expect(await measureStoreImage(url)).toEqual({ width: 800, height: 1200 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![1]).toMatchObject({ headers: { range: "bytes=0-65535" } });

    for (const elsewhere of [
      "https://example.com/catalog/a.jpg",
      `${STORE}/private/a.jpg`,
      "/media/catalog/a.jpg",
    ]) {
      expect(await measureStoreImage(elsewhere), elsewhere).toBeNull();
    }
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("asks again after a network failure, rather than remember it", async () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_BASE_URL", STORE);
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response(PNG, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { measureStoreImage } = await import("@/lib/newsletter/product-source");
    const url = `${STORE}/catalog/ab/cd/flaky.png`;
    expect(await measureStoreImage(url)).toBeNull();
    expect(await measureStoreImage(url)).toEqual({ width: 800, height: 1200 });
  });
});
