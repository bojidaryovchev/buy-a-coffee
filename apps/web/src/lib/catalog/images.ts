/**
 * Image URL resolution.
 *
 * This is the enforcement point for the hard rule that the storefront never
 * loads anything from the source domain. Product images live in our own
 * object storage, addressed by content hash.
 *
 * A stored URL that points anywhere other than our configured image host is
 * rejected outright and the caller renders a placeholder instead. Silently
 * hotlinking would be worse than showing no image: it would leak traffic to
 * the source and break the moment they change anything.
 */

const SOURCE_HOST_PATTERN = /(^|\.)kafezona\.com$/i;

function imageBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_IMAGE_BASE_URL ?? "").replace(/\/+$/, "");
}

/** True when a URL is safe for the storefront to render. */
export function isAllowedImageUrl(url: string): boolean {
  if (!url) return false;
  // A bare object key is ours by construction.
  if (!/^https?:\/\//i.test(url)) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (SOURCE_HOST_PATTERN.test(parsed.hostname)) return false;

  const base = imageBaseUrl();
  if (!base) return false;
  try {
    return new URL(base).hostname === parsed.hostname;
  } catch {
    return false;
  }
}

/**
 * Turn a stored object key or URL into something renderable.
 * Returns the local placeholder when the URL is not ours.
 */
export function resolveImageUrl(urlOrKey: string): string {
  if (!urlOrKey) return PLACEHOLDER_IMAGE;

  if (/^https?:\/\//i.test(urlOrKey)) {
    return isAllowedImageUrl(urlOrKey) ? urlOrKey : PLACEHOLDER_IMAGE;
  }

  const base = imageBaseUrl();
  const key = urlOrKey.replace(/^\/+/, "");
  // With no configured host, serve through our own local media route so
  // development works without any object storage at all.
  return base ? `${base}/${key}` : `/media/${key}`;
}

export const PLACEHOLDER_IMAGE = "/placeholder-product.svg";

/** Responsive `sizes` values, matched to the layouts that use them. */
export const IMAGE_SIZES = {
  card: "(min-width: 1180px) 280px, (min-width: 768px) 33vw, 50vw",
  detail: "(min-width: 1024px) 560px, 100vw",
  thumb: "96px",
  hero: "(min-width: 1024px) 50vw, 100vw",
} as const;
