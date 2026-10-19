import type { Metadata } from "next";

/**
 * The `robots` a storefront page declares, in one place.
 *
 * **Why a page must never write `robots: undefined`.** Next merges metadata
 * key by key, and a key that is present replaces the parent's — even when its
 * value is `undefined`. So a page that wrote `robots: indexable ? undefined :
 * {…}`, meaning "inherit the layout's", in fact erased it: the product,
 * category, brand, wizard and vending pages went out with no robots tag at all
 * while indexable, and with no `googleBot` line, so Google fell back to its
 * default image preview instead of `max-image-preview:large` — on the very
 * pages whose packshots are the point (`docs/seo.md` §4: an image pack on 23
 * of 28 result pages).
 *
 * So a page states its directive outright, through `robotsFor`, and the
 * storefront layout declares the same `INDEXABLE` for the pages that state
 * none. `test/robots-meta.test.ts` fails on `robots: undefined` anywhere under
 * the storefront, and on a hand-written directive.
 */

type Robots = NonNullable<Metadata["robots"]>;

/**
 * Index and follow, with the largest previews Google offers.
 *
 * `max-image-preview:large` lets a product's photograph be shown full width in
 * Discover and image results; `max-snippet:-1` and `max-video-preview:-1` lift
 * the other two caps, which is what a shop wants of its own pages.
 */
export const INDEXABLE: Robots = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
};

/**
 * Kept out of the index, links still followed: a filtered or paginated view,
 * a search, an answered wizard, a removed product, an empty listing. Following
 * matters — those pages link to the products, and the crawler should reach
 * them.
 */
export const NOINDEX: Robots = { index: false, follow: true };

/** The directive for a page that is indexable only some of the time. */
export const robotsFor = (indexable: boolean): Robots => (indexable ? INDEXABLE : NOINDEX);
