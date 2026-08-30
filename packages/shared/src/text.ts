/**
 * Text and HTML normalisation primitives.
 *
 * These exist so that "did this page/product actually change?" is answerable
 * without being fooled by whitespace churn or per-response obfuscation tokens.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  laquo: "\u00ab",
  raquo: "\u00bb",
  ldquo: "\u201c",
  rdquo: "\u201d",
  lsquo: "\u2018",
  rsquo: "\u2019",
  hellip: "\u2026",
  ndash: "\u2013",
  mdash: "\u2014",
  times: "\u00d7",
  rarr: "\u2192",
  larr: "\u2190",
  euro: "\u20ac",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  deg: "\u00b0",
  middot: "\u00b7",
  bull: "\u2022",
  shy: "",
};

/** Decode numeric and common named HTML entities. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const digits = isHex ? body.slice(2) : body.slice(1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      // Lone surrogates are not valid scalar values.
      if (code >= 0xd800 && code <= 0xdfff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * Collapse all Unicode whitespace runs to a single space and trim.
 * Non-breaking spaces are treated as whitespace on purpose: the source site
 * uses them interchangeably with plain spaces.
 *
 * Zero-width JOINER/NON-JOINER are deliberately excluded. They are formatting
 * controls rather than whitespace, and stripping them would tear apart emoji
 * ZWJ sequences and correctly-joined text in other scripts.
 */
export function normalizeWhitespace(input: string): string {
  return input.replace(/[\s\u00a0\u200b\ufeff]+/gu, " ").trim();
}

/** Strip tags, decode entities and normalise whitespace. */
export function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const spaced = withoutScripts
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeEntities(spaced));
}

/**
 * Remove response-scoped noise that changes on every fetch even when the page
 * content is identical.
 *
 * Cloudflare's email obfuscation re-keys `data-cfemail` and the
 * `/cdn-cgi/l/email-protection#<hex>` href on every single response. Without
 * stripping these, every page would hash differently on every crawl and the
 * catalog would report spurious changes forever.
 */
export function stripVolatileMarkup(html: string): string {
  return html
    .replace(/data-cfemail\s*=\s*"[^"]*"/gi, 'data-cfemail=""')
    .replace(/data-cfemail\s*=\s*'[^']*'/gi, 'data-cfemail=""')
    .replace(/\/cdn-cgi\/l\/email-protection#[0-9a-fA-F]*/g, "/cdn-cgi/l/email-protection#")
    .replace(/\bcf[_-]?ray\s*[:=]\s*"?[0-9a-zA-Z-]+"?/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Canonical form of an HTML document for content-change detection.
 * Deliberately lossy: it answers "is this materially the same page?".
 */
export function normalizeHtmlForHash(html: string): string {
  return normalizeWhitespace(stripVolatileMarkup(html));
}

/**
 * Canonical form of a rich-text/description fragment for semantic hashing.
 * Tag soup differences that do not change the rendered text must not count
 * as a product change.
 */
export function normalizeRichTextForHash(html: string | null | undefined): string {
  if (!html) return "";
  return htmlToText(html).toLowerCase();
}

/** Normalise a human label used as a lookup key (brand/category names). */
export function normalizeLabel(input: string | null | undefined): string {
  if (!input) return "";
  return normalizeWhitespace(decodeEntities(input));
}

/**
 * Build a URL-safe slug. Transliterates Cyrillic so Bulgarian names produce
 * readable Latin slugs for our own storefront routes.
 */
const CYRILLIC_MAP: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
};

export function transliterate(input: string): string {
  let out = "";
  for (const ch of input.toLowerCase()) {
    out += CYRILLIC_MAP[ch] ?? ch;
  }
  return out;
}

export function slugify(input: string, options?: { maxLength?: number }): string {
  const maxLength = options?.maxLength ?? 96;
  const base = transliterate(normalizeLabel(input))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= maxLength) return base;
  const cut = base.slice(0, maxLength);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > maxLength * 0.6 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, "");
}
