import path from "node:path";
import { createElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { absoluteUrl } from "@/config/site";
import { listArticles } from "@/lib/journal";
import { articleCard, articleCardFacts } from "@/lib/seo/og/article-card";
import { renderCard } from "@/lib/seo/og/card";
import { ArticleCard, ListingCard, ProductCard, type ProductCardData } from "@/lib/seo/og/cards";
import { cardId, oncePerRequest, type ProductCardFacts } from "@/lib/seo/og/data";
import { ogFonts } from "@/lib/seo/og/fonts";
import { fitWithin, imageDataUri, intrinsicSize } from "@/lib/seo/og/image-data";

/*
 * The share cards (`lib/seo/og/`), drawn from fixtures with the real faces
 * and the real lockup: every variant a page can hand in comes out as a
 * 1200 × 630 PNG. What they look like was checked by eye on renders of the
 * real catalog; this holds that each one still renders, and the pieces the
 * routes rely on — the faces load, a picture is read with its size.
 */

// The card ids and addresses are pure; the catalog reads beside them are not called.
vi.mock("@/lib/db", () => ({ db: {} }));

const WEB = path.resolve(import.meta.dirname, "..");

beforeAll(() => {
  // The faces and the lockup are read from the app's directory, as on a server.
  vi.spyOn(process, "cwd").mockReturnValue(WEB);
});

async function png(element: Parameters<typeof renderCard>[0]) {
  const response = await renderCard(element);
  expect(response.headers.get("content-type")).toBe("image/png");
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes };
}

const PRODUCT: ProductCardData = {
  lockup: null,
  photo: null,
  title: "Bianchi Irish Cream Aroma Espresso",
  detail: "Капсули за Dolce Gusto, 16 бр.",
  brandName: "Bianchi",
  system: { id: "dolce-gusto", name: "Dolce Gusto" },
  price: "5,60 €",
  oldPrice: null,
  discountPercent: null,
  perCup: "0,35 € на чаша",
  notice: null,
};

describe("the faces", () => {
  it("are Literata and Inter, read from assets/og", async () => {
    const fonts = await ogFonts();
    expect(fonts.map(({ name, weight }) => `${name} ${weight}`)).toEqual([
      "Inter 400",
      "Inter 600",
      "Literata 600",
    ]);
    for (const font of fonts) expect(font.data.length).toBeGreaterThan(30_000);
  });
});

describe("a picture for a card", () => {
  it("is read with its own size, and fitted without distortion", async () => {
    const lockup = await imageDataUri("/og-lockup.png");
    expect(lockup).toMatchObject({ width: 880, height: 224 });
    expect(lockup?.src).toMatch(/^data:image\/png;base64,/);
    expect(fitWithin({ width: 800, height: 1200 }, { width: 400, height: 400 })).toEqual({
      width: 266,
      height: 400,
    });
  });

  it("is nothing for the placeholder, a foreign host or a path outside public", async () => {
    expect(await imageDataUri("/placeholder-product.svg")).toBeNull();
    expect(await imageDataUri("https://images.example.com/img/a.jpg")).toBeNull();
    expect(await imageDataUri("/../package.json")).toBeNull();
    expect(await imageDataUri(null)).toBeNull();
  });

  it("reads the size of an SVG from its viewBox", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80"></svg>');
    expect(intrinsicSize("image/svg+xml", svg)).toEqual({ width: 320, height: 80 });
  });
});

describe("every card", () => {
  it("draws a product at 1200 × 630, with the lockup and its price", async () => {
    const lockup = await imageDataUri("/og-lockup.png");
    const card = await png(createElement(ProductCard, { ...PRODUCT, lockup }));
    expect([card.width, card.height]).toEqual([1200, 630]);
  });

  it("draws a reduced price, one sold on enquiry, and one no longer sold", async () => {
    for (const variant of [
      { oldPrice: "7,00 €", discountPercent: 20 },
      { price: null, perCup: null },
      { notice: "Вече не се предлага" },
    ]) {
      const card = await png(createElement(ProductCard, { ...PRODUCT, ...variant }));
      expect([card.width, card.height]).toEqual([1200, 630]);
    }
  });

  it("draws a listing with packshots and a logo for a dark ground, and one with neither", async () => {
    const mark = await imageDataUri("/logo-icon-only.png");
    const withPictures = await png(
      createElement(ListingCard, {
        lockup: null,
        logo: mark,
        logoGround: "dark",
        heading: "Кафе Bianchi: капсули, дози и разтворимо",
        lines: ["19 продукта", "От ≈ 0,06 € до 0,44 € на чаша"],
        photos: [mark, mark, null],
      }),
    );
    expect([withPictures.width, withPictures.height]).toEqual([1200, 630]);
    const bare = await png(
      createElement(ListingCard, { lockup: null, heading: "Кафе капсули", lines: [], photos: [] }),
    );
    expect([bare.width, bare.height]).toEqual([1200, 630]);
  });

  it("draws an article", async () => {
    const card = await png(
      createElement(ArticleCard, {
        lockup: null,
        mark: null,
        section: "Блог",
        title: "Видове капсули за кафе: коя пасва на вашата машина",
        description: "Капсулите се делят по системи, не по марки.",
        date: "9 октомври 2026 г.",
      }),
    );
    expect([card.width, card.height]).toEqual([1200, 630]);
  });
});

describe("a card's address", () => {
  const FACTS: ProductCardFacts = {
    title: PRODUCT.title,
    detail: PRODUCT.detail,
    brandName: PRODUCT.brandName,
    system: PRODUCT.system,
    price: PRODUCT.price,
    oldPrice: null,
    discountPercent: null,
    perCup: PRODUCT.perCup,
    notice: null,
    photo: "/media/products/bianchi-irish-cream-0a1b2c3d.webp",
  };

  it("is the same for the same facts, and new when anything the card shows changes", () => {
    const id = cardId(FACTS);
    expect(id).toMatch(/^card-[0-9a-f]{12}$/);
    expect(cardId({ ...FACTS })).toBe(id);
    const changes: Partial<ProductCardFacts>[] = [
      { price: "4,90 €" },
      { oldPrice: "5,60 €", discountPercent: 13 },
      { notice: "Вече не се предлага" },
      { title: "Bianchi Irish Cream" },
      { photo: "/media/products/bianchi-irish-cream-9f8e7d6c.webp" },
    ];
    const ids = changes.map((change) => cardId({ ...FACTS, ...change }));
    expect(new Set([id, ...ids]).size).toBe(changes.length + 1);
  });

  it("is, for an article, the address Next gives the card beside it", () => {
    const summary = listArticles()[0]!;
    const card = articleCard(summary, "bg");
    // Absolute, on the site's own origin, with no query: the same string in `Article.image`.
    expect(card.url.startsWith(absoluteUrl("/"))).toBe(true);
    expect(new URL(card.url).pathname).toMatch(
      new RegExp(`^/bg/blog/${summary.slug}/opengraph-image-[a-z0-9]+/card-[0-9a-f]{12}$`),
    );
    expect(new URL(card.url).search).toBe("");
    expect(card.url.endsWith(`/${cardId(articleCardFacts(summary, "bg"))}`)).toBe(true);
    expect([card.width, card.height, card.type]).toEqual([1200, 630, "image/png"]);
    // A revised article is a new card.
    expect(articleCard({ ...summary, modifiedAt: "2099-01-01" }, "bg").url).not.toBe(card.url);
  });
});

describe("how long a card is kept", () => {
  const element = createElement(ArticleCard, {
    lockup: null,
    mark: null,
    section: "Блог",
    title: "Кафе",
    description: "",
    date: "",
  });

  it("is a week at the edge for a complete card, whose address changes with its facts", async () => {
    const response = await renderCard(element);
    expect(response.headers.get("cache-control")).toContain("s-maxage=604800");
  });

  it("is a minute for one drawn without a picture it should have had", async () => {
    const response = await renderCard(element, { complete: false });
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=60, must-revalidate",
    );
  });
});

describe("a card's read", () => {
  it("is made once for the metadata and the drawing of one request, and again for the next", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async ({ slug }: { slug: string }) => slug.length);
      const card = oncePerRequest(read);
      const params = { slug: "lavazza" };
      expect(await card(params)).toBe(7);
      expect(await card(params)).toBe(7);
      expect(read).toHaveBeenCalledTimes(1);
      // Another request is another params object.
      await card({ slug: "lavazza" });
      expect(read).toHaveBeenCalledTimes(2);
      // And the same object, were it ever reused, is read again within seconds.
      vi.advanceTimersByTime(10_000);
      await card(params);
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a reduction under one percent", () => {
  /* The product card's rule (`product-card.tsx`): the struck price says it,
     and a "−0%" badge would only look like a mistake. A promotion of 1% on a
     product whose 30-day lowest was a cent under its price comes to that. */
  it("is struck through on the share card, with no badge", async () => {
    const { productCardFacts } = await import("@/lib/seo/og/data");
    const facts = productCardFacts({
      name: "Bianchi Irish Cream Aroma Espresso — капсули за Dolce Gusto, 16 бр.",
      title: "Bianchi Irish Cream Aroma Espresso",
      detail: "Капсули за Dolce Gusto, 16 бр.",
      brand: { slug: "bianchi", name: "Bianchi" },
      systemId: "dolce-gusto",
      price: { amount: "5.55", currency: "EUR", formatted: "5,55 €" },
      oldPrice: { amount: "5.56", currency: "EUR", formatted: "5,56 €" },
      discountPercent: 0,
      servingPrice: null,
      status: "active",
      availability: "in_stock",
      images: [],
      image: null,
    } as unknown as Parameters<typeof productCardFacts>[0]);
    expect(facts).toMatchObject({ oldPrice: "5,56 €", discountPercent: null });

    const { renderToStaticMarkup } = await import("react-dom/server");
    const slight = renderToStaticMarkup(
      createElement(ProductCard, { ...PRODUCT, oldPrice: "5,56 €", discountPercent: 0 }),
    );
    expect(slight).toContain("line-through");
    expect(slight).toContain("5,56 €");
    expect(slight).not.toContain("−0%");
    const reduced = renderToStaticMarkup(
      createElement(ProductCard, { ...PRODUCT, oldPrice: "7,00 €", discountPercent: 20 }),
    );
    expect(reduced).toContain("−20%");
  });
});
