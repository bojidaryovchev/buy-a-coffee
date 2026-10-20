import "server-only";
import { createHash } from "node:crypto";
import { cache, createElement } from "react";
import { isLocale, isShipping, type Locale } from "@/i18n/config";
import { pluralize } from "@/lib/catalog/format";
import { cupRangePhrase } from "@/lib/catalog/cup-range";
import { parseCatalogQuery } from "@/lib/catalog/filters";
import { getListingFacts } from "@/lib/catalog/listing-facts";
import { listProducts } from "@/lib/catalog/queries";
import type { CategoryView, ProductDetailView } from "@/lib/catalog/types";
import {
  getBrewingSystem,
  type BrewingSystem,
  type BrewingSystemId,
} from "@/lib/recommend/systems";
import { CARD_SIZE, CARD_TYPE, renderCard } from "./card";
import { ArticleCard, ListingCard, ProductCard } from "./cards";
import { imageDataUri } from "./image-data";

/**
 * What the share-card routes read and draw, in two steps per card.
 *
 *  1. **The facts**: every word, figure and picture address the card shows,
 *     as plain strings, read from the catalog. Cheap — no picture is fetched
 *     — because a page computes them on every render, for its `og:image`.
 *  2. **The drawing**: the pictures read and the card rendered, only when the
 *     card itself is asked for.
 *
 * **The card's address is a hash of its facts** (`cardId`). Networks keep a
 * shared picture by its URL for weeks; with one fixed id, a product shared
 * before a price drop would go on showing the old price. Now a new price, a
 * new name, a new photograph or a product leaving the shelf makes a new URL,
 * the page's `og:image` names it on its next render, and the old URL answers
 * 404. A card can therefore be cached for as long as its facts hold: its URL
 * changes when they do (`renderCard` in `card.tsx` sets that).
 */

/** The locale of a card's URL, or null for one no page is published under. */
export function cardLocale(lang: string): Locale | null {
  return isLocale(lang) && isShipping(lang) ? lang : null;
}

/**
 * A card's read, once per request for the card.
 *
 * The route Next generates for a card asks twice in one request: its
 * `generateImageMetadata`, to check the id in the URL, then the drawing. React
 * `cache` does not reach a route handler, so the read is shared by the one
 * thing both calls are handed: the same params object (the generated route
 * resolves both from one). Should that ever stop being the same object, this
 * stops sharing and nothing else changes. Should Next ever start handing one
 * object to many requests, a read is still kept only for `READ_LIFETIME_MS`,
 * so a card could lag its facts by seconds, never for good.
 */
export function oncePerRequest<P extends object, T>(read: (params: P) => Promise<T>) {
  const reads = new WeakMap<P, { readonly at: number; readonly pending: Promise<T> }>();
  return (params: P): Promise<T> => {
    const kept = reads.get(params);
    if (kept && Date.now() - kept.at < READ_LIFETIME_MS) return kept.pending;
    const pending = read(params);
    reads.set(params, { at: Date.now(), pending });
    return pending;
  };
}

/** Far longer than one card request takes; far shorter than a price stays wrong. */
const READ_LIFETIME_MS = 10_000;

/** `card-` and twelve hex digits of the SHA-256 of the facts as JSON. */
export function cardId(facts: unknown): string {
  return `card-${createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 12)}`;
}

/** The one image a page's `generateImageMetadata` declares, addressed by its facts. */
export const cardImage = (alt: string, facts: unknown) => [
  { id: cardId(facts), alt, size: CARD_SIZE, contentType: CARD_TYPE },
];

/** Whether every picture the facts name arrived: a card missing one is kept briefly. */
const allArrived = (wanted: readonly (string | null | undefined)[], got: readonly unknown[]) =>
  wanted.every((url, index) => !url || got[index] !== null);

const LOCKUP = "/og-lockup.png";

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase("bg") + text.slice(1);

/* --- A product ------------------------------------------------------------ */

export interface ProductCardFacts {
  /** Brand and line: „Lavazza Super Crema“. */
  readonly title: string;
  /** „Кафе на зърна, 1 кг“. */
  readonly detail: string | null;
  readonly brandName: string | null;
  readonly system: { readonly id: BrewingSystemId; readonly name: string } | null;
  readonly price: string | null;
  readonly oldPrice: string | null;
  readonly discountPercent: number | null;
  readonly perCup: string | null;
  /** What stands in for the price when the product cannot be ordered today. */
  readonly notice: string | null;
  /** The photograph's address: content-addressed, so a new photograph is a new address. */
  readonly photo: string | null;
}

export function productCardFacts(product: ProductDetailView): ProductCardFacts {
  const system = getBrewingSystem(product.systemId);
  return {
    title: product.title ?? product.name,
    detail: product.detail ?? null,
    brandName: product.brand?.name ?? null,
    system: system ? { id: system.id, name: system.name } : null,
    price: product.price?.formatted ?? null,
    oldPrice: product.oldPrice?.formatted ?? null,
    // Under one percent rounds to zero: the struck price says it, and a "−0%"
    // badge would only look like a mistake — the product card's rule.
    discountPercent:
      product.discountPercent !== null && product.discountPercent >= 1
        ? product.discountPercent
        : null,
    perCup: product.servingPrice?.formatted ?? null,
    notice:
      product.status !== "active"
        ? "Вече не се предлага"
        : product.availability === "out_of_stock"
          ? "В момента е изчерпан"
          : null,
    photo: product.images[0]?.url ?? product.image?.url ?? null,
  };
}

/** The card's `alt`: what the picture shows, in a sentence a screen reader can say. */
export function productCardAlt(product: ProductDetailView): string {
  const title = product.title ?? product.name;
  const what = product.detail ? `${title}, ${lowerFirst(product.detail)}` : title;
  const price = product.price
    ? `, цена ${[product.price.formatted, product.servingPrice?.formatted].filter(Boolean).join(", ")}`
    : "";
  return `${what}: опаковката${price}`;
}

export async function renderProductCard(facts: ProductCardFacts): Promise<Response> {
  const [photo, lockup] = await Promise.all([imageDataUri(facts.photo), imageDataUri(LOCKUP)]);
  return renderCard(createElement(ProductCard, { ...facts, photo, lockup }), {
    complete: allArrived([facts.photo, LOCKUP], [photo, lockup]),
  });
}

/* --- A listing: a category, a brand, a landing ---------------------------- */

export interface ListingCardFacts {
  readonly heading: string;
  readonly system?: { readonly id: BrewingSystemId; readonly name: string } | null;
  readonly eyebrow?: string | null;
  readonly logo?: { readonly file: string; readonly ground: "light" | "dark" } | null;
  /** „33 продукта“, „От 0,31 € до 0,67 € на чаша“. */
  readonly lines: readonly string[];
  /** Up to three packshots' addresses. */
  readonly photos: readonly string[];
}

/**
 * The addresses of the first three packshots a listing shows. Once per
 * request (React `cache`, keyed by two strings): the page's metadata and the
 * card's both ask.
 */
const listingPhotos = cache(
  async (by: "category" | "brand", slug: string): Promise<readonly string[]> => {
    const result = await listProducts({
      query: parseCatalogQuery({}),
      ...(by === "category" ? { categorySlug: slug } : { brandSlug: slug }),
    });
    return result.items
      .map((item) => item.image?.url)
      .filter((url): url is string => Boolean(url))
      .slice(0, 3);
  },
);

/** „33 продукта“ and the per-cup range, as the listing's own description says them. */
function listingLines(facts: Awaited<ReturnType<typeof getListingFacts>>): string[] {
  const range = cupRangePhrase(facts.cupRange);
  return [
    pluralize(facts.productCount, "продукт", "продукта"),
    ...(range ? [range.charAt(0).toLocaleUpperCase("bg") + range.slice(1)] : []),
  ];
}

export async function categoryCardFacts(
  category: CategoryView,
  heading: string,
  system: BrewingSystem | null,
): Promise<ListingCardFacts> {
  const [facts, photos] = await Promise.all([
    getListingFacts({ kind: "category", slug: category.slug }),
    listingPhotos("category", category.slug),
  ]);
  return {
    heading,
    system: system ? { id: system.id, name: system.name } : null,
    lines: listingLines(facts),
    photos,
  };
}

export async function brandCardFacts(
  brand: { readonly slug: string },
  heading: string,
  logo: { readonly file: string; readonly ground: "light" | "dark" } | null,
): Promise<ListingCardFacts> {
  const [facts, photos] = await Promise.all([
    getListingFacts({ kind: "brand", slug: brand.slug }),
    listingPhotos("brand", brand.slug),
  ]);
  return {
    heading,
    logo: logo ? { file: logo.file, ground: logo.ground } : null,
    eyebrow: logo ? null : "Марка",
    lines: listingLines(facts),
    photos,
  };
}

export async function renderListingCard(facts: ListingCardFacts): Promise<Response> {
  const wanted = [LOCKUP, facts.logo?.file ?? null, ...facts.photos];
  const [lockup, logo, ...photos] = await Promise.all(wanted.map((url) => imageDataUri(url)));
  return renderCard(
    createElement(ListingCard, {
      lockup: lockup ?? null,
      logo: logo ?? null,
      logoGround: facts.logo?.ground ?? "light",
      system: facts.system ?? null,
      // A logo that did not arrive leaves its place to the word.
      eyebrow: facts.eyebrow ?? (facts.logo && !logo ? "Марка" : null),
      heading: facts.heading,
      lines: facts.lines,
      photos,
    }),
    { complete: allArrived(wanted, [lockup, logo, ...photos]) },
  );
}

/* --- An article ------------------------------------------------------------ */

export interface ArticleCardFacts {
  readonly section: string;
  readonly title: string;
  readonly description: string;
  readonly date: string;
}

const MARK = "/logo-icon-only.png";

export async function renderArticleCard(facts: ArticleCardFacts): Promise<Response> {
  const [lockup, mark] = await Promise.all([imageDataUri(LOCKUP), imageDataUri(MARK)]);
  return renderCard(createElement(ArticleCard, { ...facts, lockup, mark }), {
    complete: allArrived([LOCKUP, MARK], [lockup, mark]),
  });
}
