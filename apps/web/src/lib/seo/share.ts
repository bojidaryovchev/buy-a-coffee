import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "@/config/site";
import { OG_LOCALE, SHIPPING_LOCALES, type Locale } from "@/i18n/config";
import { SHARE_CARD } from "./share-card";

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
   * A picture of the page's own subject, as an absolute URL: a product's
   * photograph. Every other page shares the generated card.
   */
  readonly image?: string | null;
  /** Set by an article: its type and its dates, as ISO strings. */
  readonly article?: {
    readonly publishedTime: string;
    readonly modifiedTime: string;
  };
}

type Share = Required<Pick<Metadata, "openGraph" | "twitter">>;

/** The locales a page is also published in; empty while one locale ships. */
const alternateLocales = (locale: Locale): string[] =>
  SHIPPING_LOCALES.filter((other) => other !== locale).map((other) => OG_LOCALE[other]);

/**
 * The image, named explicitly. Setting `openGraph` at all drops the one
 * inherited from `app/opengraph-image.tsx` (see `share-card.ts`), and `undefined`
 * is the one value that must never reach `images`: it shares as a grey box.
 */
const imagesOf = (image?: string | null) => [{ url: image || absoluteUrl(SHARE_CARD) }];

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
  const images = imagesOf(image);
  const common = {
    siteName: siteConfig.name,
    title,
    description,
    // The same URL the canonical names: `absoluteUrl` of the same path.
    url: absoluteUrl(path),
    locale: OG_LOCALE[locale],
    alternateLocale: alternateLocales(locale),
    images,
  };
  return {
    openGraph: article
      ? { type: "article", ...common, ...article }
      : { type: "website", ...common },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
