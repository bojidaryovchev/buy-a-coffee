/**
 * The share card's URL.
 *
 * ⚠ WHY THIS EXISTS AT ALL, since Next is supposed to apply a root
 * `opengraph-image` to every route beneath it by itself: `openGraph` is
 * shallow-merged, not deep-merged. A route that sets `openGraph` to add its own
 * `url` or `title` replaces the parent's whole object, and the image inherited
 * from the file convention goes with it.
 *
 * Two routes here do exactly that — `(site)/layout.tsx` and the product page —
 * which between them is every public page on the shop. Naming the card in both
 * is what makes the automatic behaviour survive contact with a page that wants
 * a canonical URL of its own.
 *
 * The unhashed path is deliberate and stable. Next also serves the card at
 * `/opengraph-image?<hash>` for cache-busting, but that hash is not reachable
 * from here and the bare path serves the same bytes.
 */
export const SHARE_CARD = "/opengraph-image";
