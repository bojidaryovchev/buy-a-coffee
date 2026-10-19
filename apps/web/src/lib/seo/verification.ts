import type { Metadata } from "next";

/**
 * Search Console and Bing Webmaster Tools ownership tags, from the
 * environment (`GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` in
 * `env.schema.mjs`).
 *
 * Emitted only when set, and only what is set: an empty
 * `<meta name="google-site-verification" content="">` verifies nothing and
 * reads as a mistake to anyone looking at the source. The tokens are the
 * owner's to supply; until then the storefront prints neither tag. Read at
 * build and on each render by the storefront layout, so a token added to the
 * production environment takes effect with the next deployment.
 *
 * A token pasted as the whole tag (`<meta name=… content="…">`) is cut down to
 * its content, because that is the mistake the consoles' instructions invite.
 */

type Verification = NonNullable<Metadata["verification"]>;

function token(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const quoted = /content\s*=\s*["']([^"']+)["']/i.exec(value);
  const bare = (quoted ? quoted[1]! : value).trim();
  // Anything still carrying markup or spaces is not a token.
  return /^[\w.:=+/-]+$/.test(bare) ? bare : null;
}

export function siteVerification(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Verification | undefined {
  const google = token(env.GOOGLE_SITE_VERIFICATION);
  const bing = token(env.BING_SITE_VERIFICATION);
  if (!google && !bing) return undefined;
  return {
    ...(google ? { google } : {}),
    ...(bing ? { other: { "msvalidate.01": bing } } : {}),
  };
}
