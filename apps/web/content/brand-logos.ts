import { brandLookupKey } from "../src/lib/catalog/brand-display";

/**
 * Brand logos: what a page needs to draw one.
 *
 * A logo is a brand's trademark, shown only to identify the genuine product
 * the shop sells, on the pages where the brand itself is the subject
 * (DESIGN.md, "Brand logo"). Where each file came from, and the check that it
 * matches the packs, is recorded in `brand-logo-provenance.ts`, keyed the same
 * way; a test keeps the two files in step. The record lives apart because
 * this file reaches the browser (the search field draws logos) and nothing on
 * a page renders the provenance.
 *
 * Keyed by the brand's source key in lower-case kebab form, like
 * `brand-names.ts`; lookup is forgiving about separators and case, so a brand
 * whose storefront slug is `3bourbons` still finds `3-bourbons`. A brand with
 * no entry is shown as text: either nobody found a logo we can use (the
 * reasons are in the provenance file), or the sync added it after this file
 * was written.
 *
 * The files live in `public/brands/` and are served from our own origin.
 */

export type BrandLogoGround = "light" | "dark";

export interface BrandLogo {
  /** Path under `public/`, served as is. */
  readonly file: string;
  readonly format: "svg" | "png";
  /** Intrinsic size: pixels for a PNG, the `viewBox` for an SVG. */
  readonly width: number;
  readonly height: number;
  /**
   * The ground the logo was drawn for. `light` sits on the page's own paper;
   * `dark` sits on an `ink-900` tile, because the brand publishes it only in
   * white (or in a colour that disappears on paper) and we never recolour it.
   */
  readonly ground: BrandLogoGround;
  /**
   * The smallest height, in CSS pixels, at which the brand's name in this
   * file (or, for a pure symbol, the symbol) can still be read — judged by eye
   * from renders at 1x. A stacked lockup whose name is a thin line under an
   * emblem needs far more height than a wordmark that fills the file. Below
   * it a placement shows the name in text instead. Absent: the rule's own
   * minimum (`MIN_HEIGHT` in `brand-logo.tsx`).
   */
  readonly minHeight?: number;
}

export const brandLogos: Readonly<Record<string, BrandLogo>> = {
  amann: {
    file: "/brands/amann.png",
    format: "png",
    width: 563,
    height: 267,
    ground: "light",
  },
  biancaffe: {
    file: "/brands/biancaffe.png",
    format: "png",
    width: 1204,
    height: 221,
    ground: "light",
  },
  bianchi: {
    file: "/brands/bianchi.png",
    format: "png",
    width: 464,
    height: 276,
    ground: "light",
    minHeight: 24,
  },
  borbone: {
    file: "/brands/borbone.png",
    format: "png",
    width: 1377,
    height: 474,
    ground: "light",
  },
  caffitaly: {
    file: "/brands/caffitaly.png",
    format: "png",
    width: 563,
    height: 242,
    ground: "light",
  },
  elia: {
    file: "/brands/elia.png",
    format: "png",
    width: 296,
    height: 276,
    ground: "light",
  },
  foodness: {
    file: "/brands/foodness.svg",
    format: "svg",
    width: 140,
    height: 61.3,
    ground: "light",
  },
  illy: {
    file: "/brands/illy.svg",
    format: "svg",
    width: 50,
    height: 50,
    ground: "light",
  },
  "julius-meinl": {
    file: "/brands/julius-meinl.svg",
    format: "svg",
    width: 198.43,
    height: 198.42,
    ground: "light",
    minHeight: 20,
  },
  kimbo: {
    file: "/brands/kimbo.svg",
    format: "svg",
    width: 179,
    height: 56,
    ground: "light",
  },
  lavazza: {
    file: "/brands/lavazza.svg",
    format: "svg",
    width: 4096,
    height: 1032.57,
    ground: "light",
  },
  lollocafe: {
    file: "/brands/lollocafe.png",
    format: "png",
    width: 184,
    height: 80,
    ground: "dark",
    minHeight: 20,
  },
  "rema-caffe": {
    file: "/brands/rema-caffe.png",
    format: "png",
    width: 240,
    height: 63,
    ground: "dark",
  },
  tezzoro: {
    file: "/brands/tezzoro.png",
    format: "png",
    width: 1441,
    height: 405,
    ground: "light",
  },
  vandino: {
    file: "/brands/vandino.png",
    format: "png",
    width: 244,
    height: 150,
    ground: "dark",
    minHeight: 24,
  },
  vergnano: {
    file: "/brands/vergnano.svg",
    format: "svg",
    width: 90.367,
    height: 90.361,
    ground: "light",
    minHeight: 20,
  },
};

const LOGOS = new Map(Object.entries(brandLogos).map(([key, logo]) => [brandLookupKey(key), logo]));

/**
 * The logo for a brand, by its source key or storefront slug; null when there
 * is none (no logo found, or a brand this file has not heard of).
 *
 * Never by display name: names are what we print, and two spellings of one
 * name must not decide whether a trademark appears.
 */
export function brandLogoFor(keyOrSlug: string | null | undefined): BrandLogo | null {
  if (!keyOrSlug) return null;
  return LOGOS.get(brandLookupKey(keyOrSlug)) ?? null;
}
