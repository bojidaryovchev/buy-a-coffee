import { PRODUCTION_ORIGIN, mailOrigin } from "./theme";

/**
 * Pictures and files in mail, from the shop's own address.
 *
 * Product photographs and newsletter uploads live in our Vercel Blob store,
 * whose public host is `<store>.public.blob.vercel-storage.com`. A message
 * whose images all come from a domain that is not the sender's is one of the
 * things spam filters count against it, and the owner's newsletters, mostly
 * one picture and a sentence, were landing in "Спам". So in mail every such
 * address is written as `https://buy-a-coffee.com/media/<key>`, and
 * `next.config.ts` proxies `/media/catalog/…` and `/media/newsletter/…` to the
 * store (an external rewrite, which Vercel serves and caches at the edge).
 *
 * Only OUR store, and only those two prefixes — the same two the rewrite
 * names. Our store is `NEXT_PUBLIC_IMAGE_BASE_URL`, the host the storefront
 * already resolves every product photograph against (`lib/catalog/images.ts`)
 * and the one the newsletter uploads go to (the token's store is the same
 * one). Any other address is left exactly as it is: a stranger's image would
 * not be served by our rewrite, and a link the owner typed is the owner's.
 *
 * The production origin, never the deployment's own, for the reason the logo
 * gives (`theme.ts`): a preview deployment sits behind Vercel's login, so its
 * `/media` would be a broken image in every inbox. The store is shared by
 * every deployment, and so is production's proxy in front of it.
 *
 * On a laptop with no image host the storefront serves the photographs from
 * disk through its own `/media` route; such an address is made absolute
 * against the deployment, so the composer's preview still shows them.
 */

/** The store's key prefixes `/media` serves. `next.config.ts` names the same three. */
export const MEDIA_PREFIXES = ["catalog", "cutouts", "newsletter"] as const;

/**
 * The rest of a key, after its prefix, as `next.config.ts` lets it through:
 * plain segments of letters, digits, `.`, `_` and `-`, none starting with a
 * dot. The same pattern, character for character, so an address written here
 * is always one the rewrite serves — and one with `..` or an encoded `%2F`
 * in it is left on the store's own address instead.
 */
const MEDIA_SEGMENT = "[A-Za-z0-9_-][A-Za-z0-9._-]*";
export const MEDIA_KEY = `${MEDIA_SEGMENT}(?:/${MEDIA_SEGMENT})*`;
const SERVED = new RegExp(`^(?:${MEDIA_PREFIXES.join("|")})/${MEDIA_KEY}$`);

type Environment = Readonly<Record<string, string | undefined>>;

/** Our store's public base, as configured, without a trailing slash; null when unset or unreadable. */
export function mediaStoreBase(env: Environment = process.env): URL | null {
  const raw = env.NEXT_PUBLIC_IMAGE_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw.replace(/\/+$/, ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The store key an address names (`catalog/ab/cd.jpg`), if it is ours and one
 * `/media` serves: one of the two prefixes, exactly, in lower case, and a key
 * of plain segments (`MEDIA_KEY`).
 */
export function storeKey(url: string, env: Environment = process.env): string | null {
  const base = mediaStoreBase(env);
  if (!base) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== base.origin) return null;
  const basePath = base.pathname.replace(/\/+$/, "");
  if (!parsed.pathname.startsWith(`${basePath}/`)) return null;
  const key = parsed.pathname.slice(basePath.length + 1);
  return SERVED.test(key) ? key : null;
}

/**
 * The address to put in a message for a picture or a file: ours when the
 * store is ours, otherwise unchanged. The query survives (`?download=1` is
 * what makes Blob send a file as a download).
 */
export function emailMediaUrl(url: string, env: Environment = process.env): string {
  const key = storeKey(url, env);
  if (key !== null) {
    const { search } = new URL(url);
    return `${PRODUCTION_ORIGIN}/media/${key}${search}`;
  }
  // The development route, which reads the local disk (`app/media/[...key]`).
  if (url.startsWith("/media/")) return `${mailOrigin(env)}${url}`;
  return url;
}
