import DOMPurify from "isomorphic-dompurify";

/**
 * HTML sanitisation for scraped product descriptions.
 *
 * Product description HTML originates on a third-party site. It is untrusted
 * input by definition, and it is rendered with `dangerouslySetInnerHTML`, so
 * this function is the only thing standing between the source site and stored
 * XSS on our storefront.
 *
 * The allow-list is deliberately narrow: descriptions are prose, so there is
 * no legitimate reason for them to contain scripts, styles, iframes, forms,
 * event handlers or embedded media.
 */

const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s",
  "ul", "ol", "li",
  "h3", "h4", "h5", "h6",
  "blockquote", "span", "small", "sub", "sup",
  "table", "thead", "tbody", "tr", "th", "td",
  "a",
];

const ALLOWED_ATTR = ["href", "title", "target", "rel", "colspan", "rowspan"];

export interface SanitizeOptions {
  /** Strip links entirely. Used where an outbound link makes no sense. */
  readonly stripLinks?: boolean;
}

export function sanitizeHtml(html: string | null | undefined, options: SanitizeOptions = {}): string {
  if (!html) return "";

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: options.stripLinks ? ALLOWED_TAGS.filter((tag) => tag !== "a") : ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Belt and braces alongside the allow-list.
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "svg", "math"],
    FORBID_ATTR: ["style", "onerror", "onload", "onclick", "srcset", "src"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    // Only http(s) and mailto survive, so `javascript:` cannot slip through.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  });

  // Any surviving link leaves our site, so it must not leak referrer or gain
  // window access.
  return clean.replace(/<a\s+/gi, '<a rel="nofollow noopener noreferrer" target="_blank" ');
}

/** Plain text with all markup removed, for meta descriptions and previews. */
export function htmlToPlainText(html: string | null | undefined, maxLength?: number): string {
  if (!html) return "";
  const stripped = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
    .replace(/\s+/g, " ")
    .trim();
  if (!maxLength || stripped.length <= maxLength) return stripped;
  // Truncate on a word boundary rather than mid-word.
  const cut = stripped.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
