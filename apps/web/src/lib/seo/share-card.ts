import { siteConfig } from "@/config/site";

/**
 * The share card's URL.
 *
 * ⚠ WHY THIS EXISTS AT ALL, since Next is supposed to apply a root
 * `opengraph-image` to every route beneath it by itself: `openGraph` is
 * shallow-merged, not deep-merged. A route that sets `openGraph` to add its own
 * `url` or `title` replaces the parent's whole object, and the image inherited
 * from the file convention goes with it.
 *
 * Every storefront page does exactly that, because every page names its own
 * address and title for sharing. They all do it through `shareMetadata` in
 * `share.ts`, which is the one place the card is named; the layout's default
 * (`shareDefaults`, same file) names it for a page that declares nothing.
 *
 * The unhashed path is deliberate and stable. Next also serves the card at
 * `/opengraph-image?<hash>` for cache-busting, but that hash is not reachable
 * from here and the bare path serves the same bytes.
 */
export const SHARE_CARD = "/opengraph-image";

/** The card's size, as `app/opengraph-image.tsx` draws it. */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

/** What the card shows, for `og:image:alt` and `twitter:image:alt`. */
export const SHARE_CARD_ALT = `${siteConfig.name} — кафе на зърна, капсули и дози, подбрани с грижа`;
