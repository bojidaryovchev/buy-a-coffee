import sanitizeHtmlLib from "sanitize-html";
import { decodeEntities } from "@catalog/shared";

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
 *
 * ⚠ WAS `isomorphic-dompurify`, AND IT TOOK EVERY PRODUCT PAGE DOWN IN
 * PRODUCTION. That package needs a DOM on the server, so it pulls in `jsdom`,
 * and jsdom's dependency chain does a CommonJS `require()` of
 * `@exodus/bytes/encoding-lite.js`, which is ESM-only. Under a local
 * `next start` it resolves; inside Vercel's bundle it throws
 * `ERR_REQUIRE_ESM`, and the only route that calls this file is the product
 * detail page — so all 110 product pages returned 500 while every other route
 * served fine. The logs read:
 *
 *   Failed to load external module jsdom-...: Error [ERR_REQUIRE_ESM]:
 *   require() of ES Module .../@exodus/bytes/encoding-lite.js
 *
 * `serverExternalPackages` was not the answer — the message says "external
 * module", so it was already being left unbundled and still could not load.
 *
 * `sanitize-html` parses with `htmlparser2` and needs no DOM at all, which
 * removes the whole class of problem rather than working around it. The
 * allow-list below is the same one, expressed in that library's shape.
 */

const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s",
  "ul", "ol", "li",
  "h3", "h4", "h5", "h6",
  "blockquote", "span", "small", "sub", "sup",
  "table", "thead", "tbody", "tr", "th", "td",
  "a",
];

/**
 * Attributes, per tag rather than as one flat list.
 *
 * `sanitize-html` scopes attributes to the tags that may carry them, which is
 * strictly tighter than the flat allow-list this replaced: `colspan` on an
 * anchor is now impossible rather than merely pointless.
 */
const ALLOWED_ATTRIBUTES: sanitizeHtmlLib.IOptions["allowedAttributes"] = {
  a: ["href", "title", "target", "rel"],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
  "*": ["title"],
};

export interface SanitizeOptions {
  /** Strip links entirely. Used where an outbound link makes no sense. */
  readonly stripLinks?: boolean;
}

export function sanitizeHtml(
  html: string | null | undefined,
  options: SanitizeOptions = {},
): string {
  if (!html) return "";

  const allowedTags = options.stripLinks
    ? ALLOWED_TAGS.filter((tag) => tag !== "a")
    : ALLOWED_TAGS;

  return sanitizeHtmlLib(html, {
    allowedTags,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    /* Only http(s) and mailto survive, so `javascript:` cannot slip through. */
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href"],
    /* A disallowed tag is unwrapped and its text kept — the old
       `KEEP_CONTENT: true`. Prose inside an unexpected <div> survives. */
    disallowedTagsMode: "discard",
    /* The exception, and the important one: these have their *contents*
       dropped too, so a stripped <script> cannot leave its body as text. */
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe"],
    /* Any surviving link leaves our site, so it must not leak referrer or gain
       window access. Done as a transform rather than the string replace this
       used to do: a regex over the output cannot tell a real tag from the same
       characters inside an attribute value. */
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: "nofollow noopener noreferrer",
          target: "_blank",
        },
      }),
    },
  });
}

/** Plain text with all markup removed, for meta descriptions and previews. */
export function htmlToPlainText(html: string | null | undefined, maxLength?: number): string {
  if (!html) return "";

  /**
   * Entities are decoded on the way out.
   *
   * The sanitiser leaves text HTML-escaped, which is right for markup and
   * wrong here: this string goes into a `<meta>` description, where the
   * framework escapes it again and a product called "Coffee & Cream" arrived
   * as "Coffee &amp;amp; Cream". The previous implementation had the same
   * latent double-escape; it is fixed rather than carried over.
   */
  const stripped = decodeEntities(
    sanitizeHtmlLib(html, { allowedTags: [], allowedAttributes: {} }),
  )
    .replace(/\s+/g, " ")
    .trim();

  if (!maxLength || stripped.length <= maxLength) return stripped;
  // Truncate on a word boundary rather than mid-word.
  const cut = stripped.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
