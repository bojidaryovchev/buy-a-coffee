// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { brandLogoFor, brandLogos, brandsWithoutLogo } from "../content/brand-logos";
import {
  AREA_SHARE,
  BrandLogo,
  LOGO_BOXES,
  MIN_HEIGHT,
  brandLogoLayout,
  fitLogo,
  legibleBrandLogo,
  type BrandLogoSize,
} from "@/components/catalog/brand-logo";
import { ProductCard } from "@/components/catalog/product-card";
import { brandLookupKey } from "@/lib/catalog/brand-display";
import type { ProductCardView, ProductDetailView } from "@/lib/catalog/types";
import { brandJsonLd, productJsonLd } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/config/site";

vi.mock("next/image", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef<HTMLImageElement, Record<string, unknown>>(function Img(props, ref) {
      const { fill: _fill, priority: _priority, ...rest } = props;
      return React.createElement("img", { ref, ...rest });
    }),
  };
});

const PUBLIC = path.resolve(import.meta.dirname, "../public");
const SIZES = Object.keys(LOGO_BOXES) as BrandLogoSize[];

const referenceBrands = (
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../../../reference/latest/brands.json"),
      "utf8",
    ),
  ) as { brands: { name: string; sourceKey: string; slug: string }[] }
).brands;

/** Intrinsic size of a file: the PNG header, or the SVG's `viewBox`. */
function intrinsicSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  if (file.endsWith(".png")) {
    expect(bytes.subarray(1, 4).toString("latin1"), file).toBe("PNG");
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  const viewBox = bytes.toString("utf8").match(/viewBox="([^"]+)"/)?.[1];
  expect(viewBox, `${file} has no viewBox`).toBeTruthy();
  const [, , width, height] = (viewBox ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return { width: width ?? 0, height: height ?? 0 };
}

/* --- The data file -------------------------------------------------------- */

describe("brand logos: the data file", () => {
  const entries = Object.entries(brandLogos);

  it("holds sixteen logos and four recorded absences", () => {
    expect(entries).toHaveLength(16);
    expect(Object.keys(brandsWithoutLogo).sort()).toEqual([
      "3-bourbons",
      "este",
      "eurocaf",
      "molini",
    ]);
  });

  it("serves every logo from our own origin, from a file that exists, named by its key", () => {
    for (const [key, logo] of entries) {
      expect(logo.file, key).toBe(`/brands/${key}.${logo.format}`);
      expect(existsSync(path.join(PUBLIC, logo.file)), `${logo.file} is missing`).toBe(true);
    }
  });

  it("states each file's real intrinsic size", () => {
    for (const [key, logo] of entries) {
      const size = intrinsicSize(path.join(PUBLIC, logo.file));
      expect(size.width, key).toBeCloseTo(logo.width, 2);
      expect(size.height, key).toBeCloseTo(logo.height, 2);
    }
  });

  it("records complete provenance for every logo", () => {
    for (const [key, { provenance }] of entries) {
      expect(["official-site", "official-press-kit", "wikimedia"], key).toContain(
        provenance.sourceType,
      );
      expect(provenance.sourcePage, key).toMatch(/^https:\/\/\S+$/);
      expect(provenance.assetUrl, key).toMatch(/^https:\/\/\S+$/);
      expect(provenance.retrievedAt, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(provenance.packagingCheck.length, key).toBeGreaterThan(40);
    }
    for (const [key, absence] of Object.entries(brandsWithoutLogo)) {
      expect(absence.reason.length, key).toBeGreaterThan(40);
      expect(absence.checkedAt, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("accounts for every brand in the reference snapshot: a logo, or a reason there is none", () => {
    expect(referenceBrands.length).toBeGreaterThan(0);
    const withLogo = new Set(Object.keys(brandLogos).map(brandLookupKey));
    const without = new Set(Object.keys(brandsWithoutLogo).map(brandLookupKey));
    for (const brand of referenceBrands) {
      const key = brandLookupKey(brand.sourceKey);
      expect(withLogo.has(key) !== without.has(key), `${brand.sourceKey}`).toBe(true);
      // Pages look the logo up by storefront slug, so the slug must find it too.
      expect(brandLogoFor(brand.slug) !== null, brand.slug).toBe(withLogo.has(key));
    }
  });

  it("finds a logo by key or slug, forgivingly, and nothing for an unknown brand", () => {
    expect(brandLogoFor("lavazza")?.file).toBe("/brands/lavazza.svg");
    expect(brandLogoFor("Julius_Meinl")?.file).toBe("/brands/julius-meinl.svg");
    expect(brandLogoFor("molini")).toBeNull();
    expect(brandLogoFor("a-brand-added-tomorrow")).toBeNull();
    expect(brandLogoFor(null)).toBeNull();
    expect(brandLogoFor("")).toBeNull();
  });

  it("keeps every SVG inert and self-contained", () => {
    for (const [key, logo] of entries.filter(([, logo]) => logo.format === "svg")) {
      const svg = readFileSync(path.join(PUBLIC, logo.file), "utf8");
      expect(svg, key).not.toMatch(/<\s*(script|foreignObject|iframe|embed|object|image|a)\b/i);
      expect(svg, key).not.toMatch(/\son[a-z]+\s*=/i);
      expect(svg, key).not.toMatch(/<!DOCTYPE|<!ENTITY|@import|javascript:|data:/i);
      // Every reference stays inside the file.
      for (const [, value] of svg.matchAll(/href\s*=\s*["']([^"']*)["']/gi)) {
        expect(value, key).toMatch(/^#/);
      }
      for (const [, value] of svg.matchAll(/url\(\s*['"]?([^'")]*)/gi)) {
        expect(value, key).toMatch(/^#/);
      }
    }
  });
});

/* --- The optical sizing rule --------------------------------------------- */

describe("brand logos: the optical sizing rule", () => {
  const box = { width: 160, height: 56 };

  it("gives a square mark and a wide wordmark about the same area", () => {
    const square = fitLogo({ width: 50, height: 50 }, box);
    const wide = fitLogo({ width: 400, height: 100 }, box);
    const area = (size: { width: number; height: number }) => size.width * size.height;
    expect(area(square) / area(wide)).toBeGreaterThan(0.9);
    expect(area(square) / area(wide)).toBeLessThan(1.1);
    // The square is taller, the wordmark wider: neither is a speck.
    expect(square.height).toBeGreaterThan(wide.height * 1.8);
    expect(wide.width).toBeGreaterThan(square.width * 1.8);
    expect(square.height).toBe(Math.round(Math.sqrt(AREA_SHARE) * box.height));
  });

  it("keeps the logo's own proportions", () => {
    for (const intrinsic of [
      { width: 4096, height: 1032.57 },
      { width: 296, height: 276 },
      { width: 1204, height: 221 },
    ]) {
      const fitted = fitLogo(intrinsic, box);
      const aspect = intrinsic.width / intrinsic.height;
      // Integers can be off by half a pixel either way, never more.
      expect(Math.abs(fitted.height * aspect - fitted.width)).toBeLessThanOrEqual(aspect / 2 + 0.5);
    }
  });

  it("never exceeds the box, however extreme the shape", () => {
    for (const aspect of [0.2, 0.5, 1, 2, 4, 8, 20]) {
      const fitted = fitLogo({ width: aspect * 100, height: 100 }, box);
      expect(fitted.width).toBeLessThanOrEqual(box.width);
      expect(fitted.height).toBeLessThanOrEqual(box.height);
    }
    // A tall mark is limited by the height, a very wide one by the width.
    expect(fitLogo({ width: 20, height: 100 }, box).height).toBe(box.height);
    expect(fitLogo({ width: 2000, height: 100 }, box).width).toBe(box.width);
  });

  it("holds a minimum height until the box width forbids it", () => {
    const small = { width: 200, height: 20 };
    expect(fitLogo({ width: 600, height: 100 }, small).height).toBe(MIN_HEIGHT);
    expect(fitLogo({ width: 3000, height: 100 }, small).width).toBe(200);
  });

  it("never draws a raster logo larger than its own pixels", () => {
    const tiny = { width: 184, height: 80 };
    const header = { width: 400, height: 160 };
    expect(fitLogo(tiny, header, { raster: true }).height).toBeLessThanOrEqual(80);
    expect(fitLogo(tiny, header).height).toBeGreaterThan(80);
  });

  it("fits every logo in the catalogue inside every box, dark tile and all", () => {
    for (const [key, logo] of Object.entries(brandLogos)) {
      for (const size of SIZES) {
        const { image, padding } = brandLogoLayout(logo, size);
        const outer = {
          width: image.width + 2 * (padding?.x ?? 0),
          height: image.height + 2 * (padding?.y ?? 0),
        };
        expect(outer.width, `${key} ${size}`).toBeLessThanOrEqual(LOGO_BOXES[size].width);
        expect(outer.height, `${key} ${size}`).toBeLessThanOrEqual(LOGO_BOXES[size].height);
        expect(image.height, `${key} ${size}`).toBeGreaterThanOrEqual(MIN_HEIGHT - 1);
        if (logo.format === "png") expect(image.height).toBeLessThanOrEqual(logo.height);
        expect(padding !== null, `${key} ${size}`).toBe(logo.ground === "dark");
      }
    }
  });
});

describe("brand logos: legibility", () => {
  it("shows every logo in a tile and on its brand page", () => {
    for (const key of Object.keys(brandLogos)) {
      expect(legibleBrandLogo(key, "tile"), key).not.toBeNull();
      expect(legibleBrandLogo(key, "header"), key).not.toBeNull();
    }
  });

  it("gives up on a logo whose name would be too small to read, and only then", () => {
    // Stacked lockups whose name is a thin line under an emblem.
    for (const key of ["bianchi", "lollocafe", "vandino"]) {
      expect(legibleBrandLogo(key, "line"), key).toBeNull();
    }
    for (const key of ["lavazza", "illy", "rema-caffe", "kimbo", "vergnano"]) {
      expect(legibleBrandLogo(key, "line"), key).not.toBeNull();
    }
    expect(legibleBrandLogo("molini", "tile")).toBeNull();
  });

  it("records a legibility floor only where it is above the rule's own minimum", () => {
    for (const [key, logo] of Object.entries(brandLogos)) {
      if (logo.minHeight !== undefined) expect(logo.minHeight, key).toBeGreaterThan(MIN_HEIGHT);
    }
  });
});

/* --- The component -------------------------------------------------------- */

function render(element: Parameters<typeof renderToStaticMarkup>[0]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

describe("BrandLogo", () => {
  it("draws the logo as an image named by the brand, with its size stated", () => {
    const root = render(
      createElement(BrandLogo, { brand: { slug: "lavazza", name: "Lavazza" }, size: "tile" }),
    );
    const img = root.querySelector("img");
    const expected = brandLogoLayout(brandLogos.lavazza!, "tile").image;
    expect(img?.getAttribute("src")).toBe("/brands/lavazza.svg");
    expect(img?.getAttribute("alt")).toBe("Lavazza");
    expect(img?.getAttribute("width")).toBe(String(expected.width));
    expect(img?.getAttribute("height")).toBe(String(expected.height));
    expect(img?.getAttribute("loading")).toBe("lazy");
    // The box is reserved whatever the logo's shape.
    const frame = root.firstElementChild as HTMLElement;
    expect(frame.style.width).toBe(`${LOGO_BOXES.tile.width}px`);
    expect(frame.style.height).toBe(`${LOGO_BOXES.tile.height}px`);
    expect(frame.className).not.toContain("bg-ink-900");
  });

  it("puts a white-only logo on a dark tile with padding", () => {
    const root = render(
      createElement(BrandLogo, {
        brand: { slug: "rema-caffe", name: "Rema Caffè" },
        size: "tile",
      }),
    );
    const img = root.querySelector("img");
    const tile = img?.parentElement;
    expect(img?.getAttribute("alt")).toBe("Rema Caffè");
    expect(tile?.className).toContain("bg-ink-900");
    expect(tile?.style.padding).toMatch(/^\d+px \d+px$/);
    expect(root.querySelector("[data-brand-logo='dark']")).not.toBeNull();
  });

  it("writes the name in the same box when the brand has no logo", () => {
    const root = render(
      createElement(BrandLogo, { brand: { slug: "molini", name: "Molini" }, size: "tile" }),
    );
    expect(root.querySelector("img")).toBeNull();
    const frame = root.querySelector<HTMLElement>("[data-brand-logo='text']");
    expect(frame?.textContent).toBe("Molini");
    expect(frame?.style.width).toBe(`${LOGO_BOXES.tile.width}px`);
    expect(frame?.style.height).toBe(`${LOGO_BOXES.tile.height}px`);
    expect(frame?.getAttribute("aria-hidden")).toBeNull();
  });

  it("writes the name instead of a logo too small to read", () => {
    const root = render(
      createElement(BrandLogo, {
        brand: { slug: "vandino", name: "Vandino" },
        size: "line",
        inline: true,
      }),
    );
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toBe("Vandino");
  });

  it("does the same for a brand nobody has looked up yet", () => {
    const root = render(
      createElement(BrandLogo, {
        brand: { slug: "nuova-marca", name: "Nuova Marca" },
        size: "tile",
      }),
    );
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toBe("Nuova Marca");
  });

  it("takes an empty alt, and hides the fallback name, where the name is printed beside it", () => {
    const logo = render(
      createElement(BrandLogo, {
        brand: { slug: "illy", name: "illy" },
        size: "suggestion",
        decorative: true,
      }),
    );
    expect(logo.querySelector("img")?.getAttribute("alt")).toBe("");
    const text = render(
      createElement(BrandLogo, {
        brand: { slug: "molini", name: "Molini" },
        size: "tile",
        decorative: true,
      }),
    );
    expect(text.querySelector("[data-brand-logo='text']")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("can reserve an empty box, or render nothing, instead of the name", () => {
    const blank = render(
      createElement(BrandLogo, {
        brand: { slug: "molini", name: "Molini" },
        size: "suggestion",
        fallback: "blank",
      }),
    );
    expect(blank.textContent).toBe("");
    expect(blank.querySelector<HTMLElement>("[data-brand-logo='none']")?.style.width).toBe(
      `${LOGO_BOXES.suggestion.width}px`,
    );
    const none = renderToStaticMarkup(
      createElement(BrandLogo, {
        brand: { slug: "molini", name: "Molini" },
        size: "header",
        fallback: "none",
      }),
    );
    expect(none).toBe("");
  });

  it("hugs the logo instead of reserving the box when inline, and loads eagerly when asked", () => {
    const root = render(
      createElement(BrandLogo, {
        brand: { slug: "illy", name: "illy" },
        size: "header",
        inline: true,
        eager: true,
      }),
    );
    const frame = root.firstElementChild as HTMLElement;
    expect(frame.style.width).toBe("");
    expect(root.querySelector("img")?.getAttribute("loading")).toBe("eager");
  });
});

/* --- Where it must not appear, and structured data ------------------------ */

const cardProduct: ProductCardView = {
  id: "p1",
  slug: "kafe-lavazza-crema-e-gusto",
  name: "Кафе на зърна Lavazza Crema e Gusto 1 кг",
  price: { amount: "19.90", currency: "EUR", formatted: "19,90 €" },
  oldPrice: null,
  discountPercent: null,
  availability: "in_stock",
  weight: "1 кг",
  intensity: null,
  systemId: "beans",
  servingPrice: null,
  brand: { slug: "lavazza", name: "Lavazza" },
  image: { url: "/media/catalog/a.jpg", alt: "Пакет Lavazza", width: 800, height: 800 },
  shortDescription: null,
};

describe("brand logos: where they do not appear", () => {
  it("a product card names the brand in text and draws no logo", () => {
    const root = render(createElement(ProductCard, { product: cardProduct }));
    expect(root.textContent).toContain("Lavazza");
    expect(root.querySelector("[data-brand-logo]")).toBeNull();
    for (const img of root.querySelectorAll("img")) {
      expect(img.getAttribute("src")).not.toMatch(/^\/brands\//);
    }
  });
});

describe("brand logos: structured data", () => {
  it("adds the logo, as an absolute URL, to a Brand that has one", () => {
    expect(brandJsonLd({ slug: "lavazza", name: "Lavazza" })).toEqual({
      "@type": "Brand",
      name: "Lavazza",
      logo: absoluteUrl("/brands/lavazza.svg"),
    });
    expect(String(brandJsonLd({ slug: "illy", name: "illy" }).logo)).toMatch(/^https?:\/\//);
  });

  it("leaves a Brand without a logo as a name alone", () => {
    expect(brandJsonLd({ slug: "molini", name: "Molini" })).toEqual({
      "@type": "Brand",
      name: "Molini",
    });
  });

  it("carries the logo into the Product's brand", () => {
    const product = {
      ...cardProduct,
      brand: { slug: "rema-caffe", name: "Rema Caffè" },
      images: [],
      descriptionText: null,
      sku: null,
      gtin: null,
      price: null,
    } as unknown as ProductDetailView;
    expect(productJsonLd(product).brand).toEqual({
      "@type": "Brand",
      name: "Rema Caffè",
      logo: absoluteUrl("/brands/rema-caffe.png"),
    });
  });
});
