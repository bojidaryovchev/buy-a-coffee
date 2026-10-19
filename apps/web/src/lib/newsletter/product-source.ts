import "server-only";
import { storeKey } from "@/emails/media";
import {
  listNewProductCards,
  listProductCardsBySlugs,
  listReducedProductCards,
} from "@/lib/catalog/queries";
import { imageSize, type PixelSize } from "./image-size";
import {
  emptySnapshot,
  hasProductBlocks,
  resolveProductBlocks,
  withImageSizes,
  type ProductBlocksSnapshot,
  type ProductSource,
} from "./product-blocks";

/**
 * The catalog, as the newsletter's product blocks read it: the storefront's
 * own queries, which build every card with the storefront's `toCard`.
 *
 * Imported lazily by the preview route, so a draft with no product block — and
 * the route's own tests — never open a database connection.
 */
export const catalogProductSource: ProductSource = {
  bySlugs: (slugs) => listProductCardsBySlugs(slugs),
  newest: ({ since, limit }) => listNewProductCards({ since, limit }),
  reduced: ({ limit }) => listReducedProductCards({ limit }),
};

/** Enough of a file for any of the four formats' header, a JPEG's EXIF included. */
const HEADER_BYTES = 64 * 1024;
const MEASURE_TIMEOUT_MS = 3_000;
/** Sizes already read, by address: a store key names its bytes for good. */
const measured = new Map<string, PixelSize | null>();
const MEASURED_LIMIT = 5_000;

/**
 * A photograph's size, read from the head of the file on our own store —
 * only there: the address came from the catalog, and this server fetches
 * nothing else. A definite answer (a size, or a file that is not one we can
 * read) is remembered for the life of the process, so a preview typed letter
 * by letter reads each photograph once; a timeout or a network error is not,
 * and the next letter asks again.
 */
export async function measureStoreImage(url: string): Promise<PixelSize | null> {
  if (measured.has(url)) return measured.get(url) ?? null;
  if (storeKey(url) === null) return null;
  let size: PixelSize | null;
  try {
    const response = await fetch(url, {
      headers: { range: `bytes=0-${HEADER_BYTES - 1}` },
      signal: AbortSignal.timeout(MEASURE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    size = imageSize(new Uint8Array((await response.arrayBuffer()).slice(0, HEADER_BYTES)));
  } catch {
    return null;
  }
  if (measured.size >= MEASURED_LIMIT) measured.clear();
  measured.set(url, size);
  return size;
}

/** A letter's blocks against the catalog as it stands; no read at all when it asks for none. */
export async function resolveLetterProducts(
  letter: { readonly subject: string; readonly body: string },
  now = new Date(),
): Promise<ProductBlocksSnapshot> {
  if (!hasProductBlocks(letter.body)) return emptySnapshot(letter.subject, now);
  const snapshot = await resolveProductBlocks(letter.body, catalogProductSource, {
    subject: letter.subject,
    now,
  });
  return withImageSizes(snapshot, measureStoreImage);
}
