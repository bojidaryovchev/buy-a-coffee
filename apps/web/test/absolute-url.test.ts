import { describe, expect, it } from "vitest";
import { absoluteUrl, siteConfig } from "@/config/site";
import type { ProductDetailView } from "@/lib/catalog/types";
import { productImageUrls, productJsonLd } from "@/lib/seo/json-ld";

/*
 * `absoluteUrl` anchors a path on the site's origin, and leaves a URL that is
 * already absolute alone.
 *
 * The second half is the one that broke. In production a product's photograph
 * is on the Blob store (`NEXT_PUBLIC_IMAGE_BASE_URL`), so the stored image URL
 * arrives absolute; prefixing the origin onto it published
 * `https://buy-a-coffee.com/https://…blob.vercel-storage.com/…` as the Product
 * `image`, `og:image` and `twitter:image` of every product — a 308 to a 404.
 */

const BLOB = "https://j6xpmlta50zfdxeo.public.blob.vercel-storage.com/catalog/ba/11/ba11.jpg";
const origin = siteConfig.url.replace(/\/+$/, "");

describe("absoluteUrl", () => {
  it("anchors a path on the site's origin", () => {
    expect(absoluteUrl("/bg/kafe-kapsuli")).toBe(`${origin}/bg/kafe-kapsuli`);
    expect(absoluteUrl("bg/kafe-kapsuli")).toBe(`${origin}/bg/kafe-kapsuli`);
    expect(absoluteUrl("/")).toBe(`${origin}/`);
    expect(absoluteUrl("/media/catalog/a.jpg")).toBe(`${origin}/media/catalog/a.jpg`);
  });

  it("keeps a query string and a fragment", () => {
    expect(absoluteUrl("/bg/tarsene?q=x#y")).toBe(`${origin}/bg/tarsene?q=x#y`);
  });

  it("returns an absolute URL untouched, whatever its host", () => {
    for (const url of [
      BLOB,
      "http://img.example.com/a.jpg",
      "HTTPS://IMG.EXAMPLE.COM/a.jpg",
      `${origin}/bg`,
    ]) {
      expect(absoluteUrl(url)).toBe(url);
    }
  });

  it("gives a protocol-relative URL the site's scheme and nothing else", () => {
    const scheme = new URL(siteConfig.url).protocol;
    expect(absoluteUrl("//img.example.com/a.jpg")).toBe(`${scheme}//img.example.com/a.jpg`);
  });

  it("never nests one URL inside another", () => {
    expect(absoluteUrl(BLOB)).not.toMatch(/https?:\/\/[^/]+\/https?:/);
  });
});

const image = (url: string) => ({ url, alt: "Пакет", width: 800, height: 1200 });

const product = (images: ProductDetailView["images"]): ProductDetailView => ({
  id: "p1",
  slug: "lavazza-super-crema-kafe-na-zarna-1-kg",
  name: "Lavazza Super Crema — кафе на зърна, 1 кг",
  price: { amount: "25.10", currency: "EUR", formatted: "25,10 €" },
  oldPrice: null,
  discountPercent: null,
  availability: "in_stock",
  weight: "1 кг",
  intensity: null,
  systemId: "beans",
  servingPrice: null,
  brand: { slug: "lavazza", name: "Lavazza" },
  image: null,
  shortDescription: null,
  status: "active",
  unitPrice: null,
  descriptionHtml: null,
  descriptionText: null,
  sku: null,
  gtin: null,
  pack: { value: "1000", unit: "g" },
  arabicaPercent: null,
  origin: null,
  roast: null,
  attributes: {},
  images,
  categories: [],
  updatedAt: null,
});

describe("a product photographed on the image host", () => {
  it("is published at the image host's own URL", () => {
    expect(productImageUrls(product([image(BLOB)]))).toEqual([BLOB]);
    expect(productJsonLd(product([image(BLOB)]), "bg").image).toEqual([BLOB]);
  });

  it("and a photograph served by this site is anchored on it", () => {
    expect(productImageUrls(product([image("/media/catalog/a.jpg")]))).toEqual([
      `${origin}/media/catalog/a.jpg`,
    ]);
  });
});
