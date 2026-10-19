import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "@/config/site";
import { OG_LOCALE, SHIPPING_LOCALES, type Locale } from "@/i18n/config";
import { SHARE_CARD, SHARE_CARD_ALT, SHARE_CARD_SIZE } from "./share-card";

/**
 * What a page says about itself when its link is shared: `openGraph` and
 * `twitter`, built from what the page already has.
 *
 * **Why every page calls this.** Next shallow-merges `openGraph` (and
 * `twitter`) across segments: a page that sets none takes the layout's whole
 * object, and a page that sets one replaces the layout's whole object. There
 * is no in-between, so nothing a page says about itself can be "added" to a
 * default. A category that declared no `openGraph` used to share under the
 * home page's address, title and description, because that is what the
 * layout's object described.
 *
 * So the two halves are built here and only here:
 *
 *  - `shareDefaults` is what the storefront layout declares. It carries what
 *    is true of every page (the kind, the shop's name, the locale, the card)
 *    and nothing that is true of one page only: no `url`, no `title`, no
 *    `description`. A page that forgets to call `shareMetadata` therefore
 *    shares with no `og:url` at all, which is honest, and
 *    `e2e/i18n.spec.ts` fails on it.
 *  - `shareMetadata` is what a page declares: the same constants restated,
 *    because the page's object replaces the layout's, plus its own address,
 *    title and description.
 *
 * `title` is the page's own words without the shop's name. `og:site_name`
 * carries the name, and a share preview prints both.
 */

export interface ShareInput {
  readonly locale: Locale;
  /** The page's own title text, before ` | <shop>`. */
  readonly title: string;
  /**
   * The page's meta description. Left out, Next fills `og:description` from
   * the resolved `description`, which for a page with none is the layout's.
   */
  readonly description?: string;
  /**
   * The page's own path in this locale: what its canonical is built from,
   * e.g. `href(locale, routes.contact)` or `categoryHref(locale, category)`.
   */
  readonly path: string;
  /**
   * What the page shares as its picture.
   *
   *  - `"generated"`: the page's own card, drawn by the `opengraph-image.tsx`
   *    beside it — a product, a category, a brand, an article. No `images`
   *    are named here at all, which is what lets Next attach that file with
   *    its width, height, type and `alt`; `twitter:image` follows it.
   *  - an absolute URL, or the picture described in full: one that is already
   *    the right shape — an article's card, which its structured data names
   *    at the same address (`lib/seo/og/article-card.ts`).
   *  - nothing: the shop's card (`app/opengraph-image.tsx`).
   */
  readonly image?: "generated" | string | ShareImage | null;
  /** Set by an article: its type and its dates, as ISO strings. */
  readonly article?: {
    readonly publishedTime: string;
    readonly modifiedTime: string;
  };
}

type Share = Required<Pick<Metadata, "openGraph" | "twitter">>;

/** A picture named with what a preview lays it out by. */
export interface ShareImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly type: string;
}

/** The locales a page is also published in; empty while one locale ships. */
const alternateLocales = (locale: Locale): string[] =>
  SHIPPING_LOCALES.filter((other) => other !== locale).map((other) => OG_LOCALE[other]);

/**
 * The image, named explicitly. Setting `openGraph` at all drops the one
 * inherited from `app/opengraph-image.tsx` (see `share-card.ts`), and `undefined`
 * is the one value that must never reach `images`: it shares as a grey box.
 * The shop's card is named with its size and `alt`, which a network uses to
 * lay the preview out before it has fetched the picture, and a screen reader
 * says.
 */
const imagesOf = (image?: string | ShareImage | null) => [
  typeof image === "object" && image !== null
    ? { ...image }
    : image
      ? { url: image }
      : {
          url: absoluteUrl(SHARE_CARD),
          ...SHARE_CARD_SIZE,
          alt: SHARE_CARD_ALT,
          type: "image/png",
        },
];

/** What the storefront layout declares for every page beneath it. */
export function shareDefaults(locale: Locale): Share {
  return {
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      locale: OG_LOCALE[locale],
      alternateLocale: alternateLocales(locale),
      images: imagesOf(),
    },
    /* X reads `og:image` when there is no `twitter:image`, but the card type
       promises a full-width image and it is cheaper to be explicit than to
       rely on that fallback holding. */
    twitter: { card: "summary_large_image", images: imagesOf() },
  };
}

/** What one page declares: the defaults restated, and what is its own. */
export function shareMetadata({
  locale,
  title,
  description,
  path,
  image,
  article,
}: ShareInput): Share {
  // A generated card is the page segment's own file, which Next attaches only
  // while the page names no `images` of its own: not even an empty list.
  const pictures = image === "generated" ? {} : { images: imagesOf(image) };
  const common = {
    siteName: siteConfig.name,
    title,
    description,
    // The same URL the canonical names: `absoluteUrl` of the same path.
    url: absoluteUrl(path),
    locale: OG_LOCALE[locale],
    alternateLocale: alternateLocales(locale),
    ...pictures,
  };
  return {
    openGraph: article
      ? { type: "article", ...common, ...article }
      : { type: "website", ...common },
    twitter: { card: "summary_large_image", title, description, ...pictures },
  };
}
