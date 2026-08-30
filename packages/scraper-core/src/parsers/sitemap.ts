import * as cheerio from "cheerio";

/**
 * Sitemap parsing.
 *
 * The source's sitemap is demonstrably stale: 111 of its 148 entries use a
 * `/products/<slug>/` prefix that no longer resolves, and it lists `/marki/`
 * which is now a soft 404. So sitemap entries are treated strictly as *hints*
 * to be verified by fetching, never as a catalog.
 */

export interface SitemapEntry {
  readonly loc: string;
  readonly lastModified: string | null;
  readonly changeFrequency: string | null;
  readonly priority: string | null;
  readonly imageUrls: string[];
}

export interface SitemapParseResult {
  readonly kind: "urlset" | "sitemapindex" | "unknown";
  readonly entries: SitemapEntry[];
  /** Nested sitemap URLs when the document is an index. */
  readonly sitemapUrls: string[];
}

export function parseSitemap(xml: string): SitemapParseResult {
  const $ = cheerio.load(xml, { xmlMode: true });

  const sitemapNodes = $("sitemapindex > sitemap");
  if (sitemapNodes.length > 0) {
    const sitemapUrls = sitemapNodes
      .toArray()
      .map((element) => $(element).children("loc").first().text().trim())
      .filter((loc) => loc.length > 0);
    return { kind: "sitemapindex", entries: [], sitemapUrls };
  }

  const urlNodes = $("urlset > url");
  if (urlNodes.length === 0) {
    return { kind: "unknown", entries: [], sitemapUrls: [] };
  }

  const entries: SitemapEntry[] = [];
  urlNodes.each((_, element) => {
    const node = $(element);
    const loc = node.children("loc").first().text().trim();
    if (!loc) return;
    const imageUrls = node
      .find("image\\:image > image\\:loc, loc")
      .toArray()
      .map((img) => $(img).text().trim())
      .filter((url) => url.length > 0 && url !== loc);
    entries.push({
      loc,
      lastModified: node.children("lastmod").first().text().trim() || null,
      changeFrequency: node.children("changefreq").first().text().trim() || null,
      priority: node.children("priority").first().text().trim() || null,
      imageUrls: [...new Set(imageUrls)],
    });
  });

  return { kind: "urlset", entries, sitemapUrls: [] };
}
