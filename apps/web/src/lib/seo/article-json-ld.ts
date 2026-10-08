import { absoluteUrl, siteConfig } from "@/config/site";
import { SHARE_CARD } from "./share-card";

/**
 * `Article` structured data for a journal entry.
 *
 * In its own file rather than in `json-ld.ts` only because that file was being
 * edited in parallel when this was written; it follows the same rule as the
 * builders there — only claims we can support are emitted.
 *
 * Two of those are worth spelling out:
 *
 *  - **The author is the shop.** The articles are written by the business and
 *    signed by it. An `author` of type `Person` would need a real person to
 *    name, and inventing a byline is exactly the kind of fabricated authority
 *    this storefront does not do. `Organization` is both true and valid.
 *  - **Dates are calendar dates.** An article records the day it was published,
 *    not an instant, so `datePublished` is emitted as `YYYY-MM-DD` — a valid
 *    ISO 8601 date — rather than padded out to a time nobody recorded.
 */

export interface ArticleJsonLdInput {
  /** Site-relative path of the article. */
  readonly href: string;
  readonly title: string;
  readonly description: string;
  /** `YYYY-MM-DD`. */
  readonly publishedAt: string;
  /** `YYYY-MM-DD`. */
  readonly modifiedAt: string;
}

export function articleJsonLd(article: ArticleJsonLdInput): Record<string, unknown> {
  const url = absoluteUrl(article.href);
  const shop = {
    "@type": "Organization",
    name: siteConfig.name,
    url: absoluteUrl("/"),
  };

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    inLanguage: siteConfig.locale,
    datePublished: article.publishedAt,
    dateModified: article.modifiedAt,
    author: shop,
    publisher: shop,
    /* The shop's share card: the articles have no photographs of their own,
       and a made-up illustration would be decoration posing as content. */
    image: [absoluteUrl(SHARE_CARD)],
  };
}
