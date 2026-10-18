// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { brandLogoFor, brandLogos } from "../content/brand-logos";
import { brandLogoProvenance, brandsWithoutLogo } from "../content/brand-logo-provenance";
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
import { ActiveFilterChips, FilterPanel } from "@/components/catalog/filter-panel";
import { ProductCard } from "@/components/catalog/product-card";
import { RecommendationCard } from "@/components/wizard/recommendation-card";
import { parseCatalogQuery } from "@/lib/catalog/filters";
import { brandLookupKey } from "@/lib/catalog/brand-display";
import type { CatalogFacets, ProductCardView, ProductDetailView } from "@/lib/catalog/types";
import type { ScoredRecommendation } from "@/lib/recommend/score";
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

  it("holds twenty logos and three recorded absences", () => {
    expect(entries).toHaveLength(20);
    expect(Object.keys(brandsWithoutLogo).sort()).toEqual(["eurocaf", "excelsior", "molini"]);
  });

  it("accounts for the brands the sync added on 16 October", () => {
    // Their key and stored slug, as the catalog holds them; the reference
    // snapshot above may not list them yet.
    for (const [key, slug] of [
      ["cafe-moreno", "moreno"],
      ["ristora", "ristora"],
    ]) {
      expect(brandLogoFor(key), key).not.toBeNull();
      // Pages look a logo up by stored slug: Moreno's is not a spelling of its key.
      expect(brandLogoFor(slug), slug).toBe(brandLogoFor(key));
    }
    expect(brandLogoFor("excelsior")).toBeNull();
    expect(brandsWithoutLogo.excelsior).toBeDefined();
  });

  it("serves every logo from our own origin, from a file that exists, named by its key", () => {
    for (const [key, logo] of entries) {
      expect(logo.file, key).toBe(`/brand-logos/${key}.${logo.format}`);
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

  it("keeps a provenance record for every logo, and a logo for every record", () => {
    expect(Object.keys(brandLogoProvenance).sort()).toEqual(Object.keys(brandLogos).sort());
    // A brand is shown with a logo or recorded without one, never both.
    for (const key of Object.keys(brandsWithoutLogo)) {
      expect(brandLogos[key], key).toBeUndefined();
      expect(brandLogoProvenance[key], key).toBeUndefined();
    }
  });

  it("records complete provenance for every logo", () => {
    for (const [key, provenance] of Object.entries(brandLogoProvenance)) {
      expect(
        ["official-site", "official-press-kit", "owner-company", "official-social", "wikimedia"],
        key,
      ).toContain(provenance.sourceType);
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
    expect(brandLogoFor("lavazza")?.file).toBe("/brand-logos/lavazza.svg");
    expect(brandLogoFor("Julius_Meinl")?.file).toBe("/brand-logos/julius-meinl.svg");
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

/** The boxes every logo in the catalogue can be read in. */
const LEGIBLE_EVERYWHERE: readonly BrandLogoSize[] = [
  "tile",
  "header",
  "line",
  "suggestion",
  "card",
  "facet",
];

/** Stacked lockups whose name is a thin line under an emblem. */
const STACKED = ["bianchi", "lollocafe", "vandino", "3-bourbons", "este"];

describe("brand logos: legibility", () => {
  it("shows every logo in every box 40 px tall or more", () => {
    for (const key of Object.keys(brandLogos)) {
      for (const size of LEGIBLE_EVERYWHERE) {
        expect(LOGO_BOXES[size].height, size).toBeGreaterThanOrEqual(40);
        expect(legibleBrandLogo(key, size), `${key} ${size}`).not.toBeNull();
      }
    }
  });

  it("gives up on a logo whose name would be too small to read, and only then", () => {
    // A chip is 36 px tall; the 24 px box inside it is too small for these.
    for (const key of STACKED) expect(legibleBrandLogo(key, "chip"), key).toBeNull();
    for (const key of Object.keys(brandLogos).filter((key) => !STACKED.includes(key))) {
      expect(legibleBrandLogo(key, "chip"), key).not.toBeNull();
    }
    expect(legibleBrandLogo("moreno", "chip")).not.toBeNull();
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
    expect(img?.getAttribute("src")).toBe("/brand-logos/lavazza.svg");
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
        size: "chip",
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

  it("gives way in a tight line only when asked to", () => {
    const frame = (shrink: boolean) =>
      render(
        createElement(BrandLogo, {
          brand: { slug: "biancaffe", name: "Biancaffè" },
          size: "card",
          inline: true,
          shrink,
        }),
      ).firstElementChild as HTMLElement;
    expect(frame(true).className).toContain("min-w-0");
    expect(frame(true).className).not.toContain("shrink-0");
    expect(frame(false).className).toContain("shrink-0");
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

/* --- Where a brand is named, and structured data -------------------------- */

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

const brandLogoImages = (root: Element) =>
  Array.from(root.querySelectorAll<HTMLImageElement>("img[src^='/brand-logos/']"));

/** The 8 px square that marks a brewing system. */
const SYSTEM_SQUARE = "[class~='bg-(--system)']";

describe("brand logos: on a product card", () => {
  const card = (brand: ProductCardView["brand"]) =>
    render(createElement(ProductCard, { locale: "bg", product: { ...cardProduct, brand } }));

  it("draws the brand's logo in place of its name, named by its alt", () => {
    const root = card({ slug: "lavazza", name: "Lavazza" });
    const [logo, ...rest] = brandLogoImages(root);
    expect(rest).toHaveLength(0);
    expect(logo?.getAttribute("src")).toBe("/brand-logos/lavazza.svg");
    expect(logo?.getAttribute("alt")).toBe("Lavazza");
    const expected = brandLogoLayout(brandLogos.lavazza!, "card").image;
    expect(logo?.getAttribute("height")).toBe(String(expected.height));
    // The line is the `card` box's height, so cards with and without a logo align.
    expect(logo?.closest("p")?.className).toContain("h-10");
    expect(LOGO_BOXES.card.height).toBe(40);
  });

  it("draws a stacked lockup too, which the card box is tall enough for", () => {
    for (const [slug, name] of [
      ["lollocafe", "Lollo Caffè"],
      ["bianchi", "Bianchi"],
      ["3bourbons", "3 Bourbons"],
    ] as const) {
      expect(brandLogoImages(card({ slug, name }))[0]?.getAttribute("alt"), slug).toBe(name);
    }
  });

  it("writes the name in the same line for a brand with no logo", () => {
    const root = card({ slug: "molini", name: "Molini" });
    expect(brandLogoImages(root)).toHaveLength(0);
    expect(root.querySelector("[data-brand-logo='text']")?.textContent).toBe("Molini");
  });

  it("draws nothing for a product with no brand", () => {
    expect(card(null).querySelector("[data-brand-logo]")).toBeNull();
  });

  it("does the same on a wizard result", () => {
    const entry = {
      product: {
        ...cardProduct,
        attributes: {},
        pricePerServing: null,
        servings: null,
        servingsEstimated: false,
      },
      score: 1,
      reasons: [],
      caveat: null,
    } as unknown as ScoredRecommendation;
    const root = render(createElement(RecommendationCard, { locale: "bg", entry }));
    expect(brandLogoImages(root).map((img) => img.getAttribute("alt"))).toEqual(["Lavazza"]);
  });
});

/* The filters and their chips. A system keeps its coloured square and never
   gets a logo: most capsules are third-party, and a system owner's logo beside
   them would claim an endorsement (PRODUCT.md). Caffitaly is both a system
   and a brand, which is the case that matters. */

const facets: CatalogFacets = {
  systems: [
    { value: "caffitaly", label: "Caffitaly", count: 9 },
    { value: "dolce-gusto", label: "Dolce Gusto", count: 35 },
  ],
  brands: [
    { value: "lavazza", label: "Lavazza", count: 10 },
    { value: "caffitaly", label: "Caffitaly", count: 9 },
    { value: "lollocafe", label: "Lollo Caffè", count: 17 },
    { value: "molini", label: "Molini", count: 7 },
  ],
  strengths: [],
  decaf: [],
  aromas: [],
  categories: [],
};

describe("brand logos: in the filters", () => {
  const panel = render(
    createElement(FilterPanel, {
      basePath: "/bg/kafe-kapsuli",
      query: parseCatalogQuery({}),
      facets,
    }),
  );
  const rows = (key: string) =>
    Array.from(panel.querySelectorAll<HTMLAnchorElement>(`a[href*='${key}=']`));

  it("puts each brand's logo before its name, decorative, the name kept", () => {
    const brands = rows("brand");
    expect(brands.map((row) => row.textContent)).toEqual([
      "Lavazza10",
      "Caffitaly9",
      "Lollo Caffè17",
      "Molini7",
    ]);
    for (const row of brands.slice(0, 3)) {
      const logos = brandLogoImages(row);
      expect(logos, row.textContent ?? "").toHaveLength(1);
      expect(logos[0]?.getAttribute("alt")).toBe("");
    }
    // The `facet` box is tall enough for Lollo's stacked lockup.
    expect(brandLogoImages(brands[2]!)[0]?.getAttribute("src")).toBe("/brand-logos/lollocafe.png");
  });

  it("keeps an empty box where a brand has no logo, so the names line up", () => {
    const blank = rows("brand")[3]!.querySelector<HTMLElement>("[data-brand-logo='none']");
    expect(blank?.style.width).toBe(`${LOGO_BOXES.facet.width}px`);
    expect(blank?.getAttribute("aria-hidden")).toBe("true");
  });

  it("gives a system its square and never a logo", () => {
    const systems = rows("system");
    expect(systems).toHaveLength(2);
    for (const row of systems) {
      expect(row.getAttribute("data-system")).toBeTruthy();
      expect(row.querySelector("[data-brand-logo]")).toBeNull();
      expect(row.querySelector(SYSTEM_SQUARE)).not.toBeNull();
    }
  });
});

describe("brand logos: in the active-filter chips", () => {
  const chips = render(
    createElement(ActiveFilterChips, {
      basePath: "/bg/kafe-kapsuli",
      query: parseCatalogQuery({
        brand: "lavazza,vandino,molini",
        system: "caffitaly",
        strength: "strong",
      }),
      facets: {
        ...facets,
        brands: [...facets.brands, { value: "vandino", label: "Vandino", count: 4 }],
      },
    }),
  );
  const chip = (label: string) =>
    Array.from(chips.querySelectorAll("a")).find((link) => link.textContent?.startsWith(label));

  it("puts a brand's logo before its name, decorative, where it can be read", () => {
    const lavazza = chip("Lavazza");
    expect(brandLogoImages(lavazza!).map((img) => img.getAttribute("alt"))).toEqual([""]);
    expect(lavazza?.textContent).toBe("Lavazza— премахни филтъра");
  });

  it("names the brand alone where the logo would be too small, or there is none", () => {
    for (const label of ["Vandino", "Molini"]) {
      expect(chip(label), label).toBeDefined();
      expect(chip(label)?.querySelector("[data-brand-logo]"), label).toBeNull();
    }
  });

  it("gives a system chip its square and never a logo", () => {
    const caffitaly = chips.querySelector("a[data-system='caffitaly']");
    expect(caffitaly?.querySelector("[data-brand-logo]")).toBeNull();
    expect(caffitaly?.querySelector(SYSTEM_SQUARE)).not.toBeNull();
  });
});

describe("brand logos: structured data", () => {
  it("adds the logo, as an absolute URL, to a Brand that has one", () => {
    expect(brandJsonLd({ slug: "lavazza", name: "Lavazza" })).toEqual({
      "@type": "Brand",
      name: "Lavazza",
      logo: absoluteUrl("/brand-logos/lavazza.svg"),
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
    expect(productJsonLd(product, "bg").brand).toEqual({
      "@type": "Brand",
      name: "Rema Caffè",
      logo: absoluteUrl("/brand-logos/rema-caffe.png"),
    });
  });
});
