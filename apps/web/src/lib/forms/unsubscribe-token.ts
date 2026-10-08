/**
 * Token hygiene that needs no database: what a token may look like, and how an
 * address is shown on a page that only proves the visitor holds the link.
 */

/** Ours are 64 hex characters; accept any URL-safe string of a sane length so
    a later change of generator does not strand links already sent. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,128}$/;

export function isPlausibleToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_SHAPE.test(token);
}

/**
 * "pe***@gmail.com". Enough for the person to recognise their own address, not
 * enough for someone who was forwarded the link to learn it.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const shown = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${shown}***${email.slice(at)}`;
}
