import {
  type Logger,
  canonicalizeUrl,
  decodedPath,
  mapWithConcurrency,
  silentLogger,
} from "@catalog/shared";
import type { ScraperConfig } from "../config.ts";
import type { Fetcher } from "../fetch/fetcher.ts";
import { type Classification, classifyPage } from "../parsers/classify.ts";
import { type ParsedPage, parsePage } from "../parsers/page.ts";
import { parseFilterContract, parseListingPage } from "../parsers/listing.ts";
import { parseSitemap } from "../parsers/sitemap.ts";

/**
 * Breadth-first same-origin discovery crawl.
 *
 * Answers "what public functionality and catalog structure does the reference
 * site expose?" — it is not a mirroring exercise, so it captures structure,
 * relationships and observed behaviour rather than bytes.
 */

export interface CrawledPage {
  readonly url: string;
  readonly canonicalUrl: string;
  readonly discoveredUrl: string;
  readonly finalUrl: string;
  readonly path: string;
  readonly depth: number;
  readonly statusCode: number | null;
  readonly contentType: string | null;
  readonly isSoft404: boolean;
  readonly outcome: string;
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly canonicalTag: string | null;
  readonly robotsMeta: string | null;
  readonly classification: Classification;
  readonly headings: Array<{ level: number; text: string }>;
  readonly internalLinks: string[];
  readonly externalLinks: string[];
  readonly forms: ParsedPage["forms"];
  readonly structuredData: unknown[];
  readonly signals: Record<string, unknown>;
  readonly contentHash: string;
  readonly byteSize: number;
  readonly durationMs: number;
  readonly referrer: string | null;
}

export interface CrawlLink {
  readonly fromCanonicalUrl: string;
  readonly toCanonicalUrl: string;
  readonly anchorText: string | null;
  readonly rel: string | null;
  readonly ordinal: number;
}

export interface CrawlError {
  readonly url: string;
  readonly stage: string;
  readonly errorClass: string;
  readonly message: string;
  readonly statusCode: number | null;
}

export interface DiscoveryCrawlResult {
  readonly pages: CrawledPage[];
  readonly links: CrawlLink[];
  readonly errors: CrawlError[];
  /** URLs we declined to fetch because robots.txt disallows them. */
  readonly blockedByRobots: string[];
  readonly externalHosts: Record<string, number>;
  /** Filter controls observed across listing pages. */
  readonly filters: Array<{
    key: string;
    urlParam: string | null;
    multiValue: boolean;
    values: string[];
    pageUrls: string[];
    appliesToPageTypes: string[];
  }>;
  readonly sitemapEntries: Array<{ loc: string; verified: boolean; outcome: string }>;
  readonly stats: {
    attempted: number;
    succeeded: number;
    failed: number;
    soft404: number;
    blockedByRobots: number;
    skippedDepth: number;
    skippedLimit: number;
    durationMs: number;
  };
}

export interface DiscoveryCrawlOptions {
  readonly config: ScraperConfig;
  readonly fetcher: Fetcher;
  readonly logger?: Logger;
  readonly maxPages?: number;
  readonly maxDepth?: number;
  /** Slugs/paths already known from the catalog, to sharpen classification. */
  readonly catalogHints?: {
    productPaths?: ReadonlySet<string>;
    categorySlugs?: ReadonlySet<string>;
    subcategorySlugs?: ReadonlySet<string>;
    brandSlugs?: ReadonlySet<string>;
  };
}

interface QueueItem {
  readonly canonicalUrl: string;
  readonly discoveredUrl: string;
  readonly depth: number;
  readonly referrer: string | null;
}

export async function runDiscoveryCrawl(
  options: DiscoveryCrawlOptions,
): Promise<DiscoveryCrawlResult> {
  const { config, fetcher } = options;
  const logger = (options.logger ?? silentLogger).child({ job: "discovery" });
  const startedAt = Date.now();

  const maxPages = options.maxPages ?? config.maxPages;
  const maxDepth = options.maxDepth ?? config.maxDepth;

  const canonicalise = (value: string, base?: string) =>
    canonicalizeUrl(value, {
      base: base ?? config.baseUrl,
      canonicalHost: config.canonicalHost,
      hostAliases: config.hostAliases,
    });

  const pages: CrawledPage[] = [];
  const links: CrawlLink[] = [];
  const errors: CrawlError[] = [];
  const blockedByRobots: string[] = [];
  const externalHosts: Record<string, number> = {};
  const filterAccumulator = new Map<
    string,
    { urlParam: string | null; multiValue: boolean; values: Set<string>; pageUrls: Set<string>; pageTypes: Set<string> }
  >();

  const visited = new Set<string>();
  const queued = new Set<string>();
  let queue: QueueItem[] = [];
  let skippedDepth = 0;
  let skippedLimit = 0;

  const enqueue = (item: QueueItem): void => {
    if (visited.has(item.canonicalUrl) || queued.has(item.canonicalUrl)) return;
    if (item.depth > maxDepth) {
      skippedDepth += 1;
      return;
    }
    queued.add(item.canonicalUrl);
    queue.push(item);
  };

  // Seed: the base URL.
  const root = canonicalise(config.baseUrl);
  if (!root) throw new Error(`Base URL is not canonicalisable: ${config.baseUrl}`);
  enqueue({ canonicalUrl: root.href, discoveredUrl: config.baseUrl, depth: 0, referrer: null });

  // Establish what a "page not found" body looks like before anything else.
  await fetcher.calibrateSoft404();

  // Seed: sitemap hints. Treated strictly as hints — the source's sitemap is
  // demonstrably stale, so every entry is verified by fetching it.
  const sitemapEntries: DiscoveryCrawlResult["sitemapEntries"] = [];
  await fetcher.loadRobots();
  const sitemapUrls = fetcher.getSitemapUrls();
  const defaultSitemap = canonicalise("/sitemap.xml");
  const sitemapCandidates =
    sitemapUrls.length > 0 ? sitemapUrls : defaultSitemap ? [defaultSitemap.href] : [];

  for (const sitemapUrl of sitemapCandidates.slice(0, 5)) {
    const response = await fetcher.get(sitemapUrl);
    if (response.outcome !== "ok") {
      logger.warn("discovery.sitemap_unavailable", { sitemapUrl, outcome: response.outcome });
      continue;
    }
    const parsed = parseSitemap(response.body);
    logger.info("discovery.sitemap_loaded", {
      sitemapUrl,
      kind: parsed.kind,
      entries: parsed.entries.length,
    });
    for (const entry of parsed.entries) {
      const canonical = canonicalise(entry.loc);
      if (!canonical || canonical.host !== config.canonicalHost) continue;
      sitemapEntries.push({ loc: entry.loc, verified: false, outcome: "pending" });
      enqueue({
        canonicalUrl: canonical.href,
        discoveredUrl: entry.loc,
        depth: 1,
        referrer: sitemapUrl,
      });
    }
  }

  // BFS: one wave at a time, each wave fetched with bounded concurrency.
  while (queue.length > 0 && pages.length < maxPages) {
    const capacity = maxPages - pages.length;
    const wave = queue.slice(0, Math.max(0, capacity));
    const deferred = queue.slice(wave.length);
    if (deferred.length > 0) skippedLimit += deferred.length;
    queue = [];

    for (const item of wave) {
      queued.delete(item.canonicalUrl);
      visited.add(item.canonicalUrl);
    }

    const settled = await mapWithConcurrency(wave, config.concurrency, async (item) => {
      const response = await fetcher.get(item.canonicalUrl);

      // Declining to fetch a disallowed URL is the crawler working correctly,
      // so it is counted separately rather than inflating the error count and
      // tripping the circuit breaker's "entry pages failed" check.
      if (response.outcome === "blocked_by_robots") {
        blockedByRobots.push(item.canonicalUrl);
        return null;
      }

      if (response.outcome !== "ok" && response.outcome !== "soft_404") {
        errors.push({
          url: item.canonicalUrl,
          stage: "fetch",
          errorClass: response.error?.name ?? response.outcome,
          message: response.error?.message ?? response.outcome,
          statusCode: response.statusCode,
        });
        return null;
      }

      const parsed = parsePage(response.body);
      const listing = parseListingPage(response.body);
      const filterContract = parseFilterContract(response.body);
      const isSoft404 = response.outcome === "soft_404";

      const classification = classifyPage({
        path: decodedPath(canonicalise(item.canonicalUrl) ?? root),
        page: parsed,
        isSoft404,
        listingFilterKeys: listing.filterKeys,
        filterContractParams: filterContract.map((entry) => entry.urlParam),
        ...(options.catalogHints?.productPaths ? { knownProductPaths: options.catalogHints.productPaths } : {}),
        ...(options.catalogHints?.categorySlugs ? { knownCategorySlugs: options.catalogHints.categorySlugs } : {}),
        ...(options.catalogHints?.subcategorySlugs
          ? { knownSubcategorySlugs: options.catalogHints.subcategorySlugs }
          : {}),
        ...(options.catalogHints?.brandSlugs ? { knownBrandSlugs: options.catalogHints.brandSlugs } : {}),
      });

      // Filter inventory, recorded only from pages that actually render one.
      if (listing.filterKeys.length > 0 || filterContract.length > 0) {
        const contract = filterContract;
        for (const key of new Set([...listing.filterKeys, ...contract.map((c) => c.urlParam)])) {
          const entry = filterAccumulator.get(key) ?? {
            urlParam: null,
            multiValue: false,
            values: new Set<string>(),
            pageUrls: new Set<string>(),
            pageTypes: new Set<string>(),
          };
          const contractEntry = contract.find((c) => c.urlParam === key);
          entry.urlParam = contractEntry?.urlParam ?? entry.urlParam ?? (listing.filterKeys.includes(key) ? key : null);
          entry.multiValue = entry.multiValue || (contractEntry?.multiValue ?? false);
          for (const value of listing.filterValues[key] ?? []) entry.values.add(value);
          entry.pageUrls.add(item.canonicalUrl);
          entry.pageTypes.add(classification.pageType);
          filterAccumulator.set(key, entry);
        }
      }

      const internalLinks: string[] = [];
      const externalLinks: string[] = [];
      let ordinal = 0;

      for (const link of parsed.links) {
        const canonical = canonicalise(link.href, response.finalUrl || item.canonicalUrl);
        if (!canonical) continue;
        if (canonical.host === config.canonicalHost) {
          internalLinks.push(canonical.href);
          // Soft-404 pages are not real pages: every link on them is the site
          // chrome repeated verbatim. Recording those edges would triple the
          // size of the site graph while adding no structural information.
          if (!isSoft404) {
            links.push({
              fromCanonicalUrl: item.canonicalUrl,
              toCanonicalUrl: canonical.href,
              anchorText: link.text || null,
              rel: link.rel,
              ordinal: ordinal++,
            });
          }
          // Soft-404 pages are dead ends: their links are just the site chrome
          // and following them adds nothing but load on the source.
          if (!isSoft404) {
            enqueue({
              canonicalUrl: canonical.href,
              discoveredUrl: link.href,
              depth: item.depth + 1,
              referrer: item.canonicalUrl,
            });
          }
        } else {
          externalLinks.push(canonical.href);
          externalHosts[canonical.host] = (externalHosts[canonical.host] ?? 0) + 1;
        }
      }

      const page: CrawledPage = {
        url: item.canonicalUrl,
        canonicalUrl: item.canonicalUrl,
        discoveredUrl: item.discoveredUrl,
        finalUrl: response.finalUrl,
        path: decodedPath(canonicalise(item.canonicalUrl) ?? root),
        depth: item.depth,
        statusCode: response.statusCode,
        contentType: response.contentType,
        isSoft404,
        outcome: response.outcome,
        title: parsed.title,
        metaDescription: parsed.metaDescription,
        canonicalTag: parsed.canonicalTag,
        robotsMeta: parsed.robotsMeta,
        classification,
        headings: parsed.headings,
        internalLinks: [...new Set(internalLinks)],
        externalLinks: [...new Set(externalLinks)],
        forms: parsed.forms,
        structuredData: parsed.structuredData,
        signals: {
          ...parsed.signals,
          listingCardCount: listing.cards.length,
          listingFilterKeys: listing.filterKeys,
          openGraph: parsed.openGraph,
          lang: parsed.lang,
          imageCount: parsed.imageUrls.length,
        },
        contentHash: response.contentHash,
        byteSize: response.bytes,
        durationMs: response.durationMs,
        referrer: item.referrer,
      };
      return page;
    });

    for (const entry of settled) {
      if (entry.ok && entry.value) pages.push(entry.value);
      else if (!entry.ok) {
        errors.push({
          url: "unknown",
          stage: "crawl",
          errorClass: "WorkerError",
          message: entry.error instanceof Error ? entry.error.message : String(entry.error),
          statusCode: null,
        });
      }
    }

    logger.info("discovery.wave_complete", {
      crawled: pages.length,
      queued: queue.length,
      errors: errors.length,
    });
  }

  // Resolve which sitemap entries turned out to be real.
  const pageByUrl = new Map(pages.map((page) => [page.canonicalUrl, page]));
  const resolvedSitemapEntries = sitemapEntries.map((entry) => {
    const canonical = canonicalise(entry.loc);
    const page = canonical ? pageByUrl.get(canonical.href) : undefined;
    return {
      loc: entry.loc,
      verified: page !== undefined,
      outcome: page ? (page.isSoft404 ? "soft_404" : "ok") : "not_crawled",
    };
  });

  const soft404 = pages.filter((page) => page.isSoft404).length;

  const result: DiscoveryCrawlResult = {
    pages,
    links,
    errors,
    blockedByRobots: [...new Set(blockedByRobots)].sort(),
    externalHosts,
    filters: [...filterAccumulator.entries()].map(([key, entry]) => ({
      key,
      urlParam: entry.urlParam,
      multiValue: entry.multiValue,
      values: [...entry.values].sort(),
      pageUrls: [...entry.pageUrls].sort(),
      appliesToPageTypes: [...entry.pageTypes].sort(),
    })),
    sitemapEntries: resolvedSitemapEntries,
    stats: {
      attempted: pages.length + errors.length,
      succeeded: pages.length - soft404,
      failed: errors.length,
      soft404,
      blockedByRobots: new Set(blockedByRobots).size,
      skippedDepth,
      skippedLimit,
      durationMs: Date.now() - startedAt,
    },
  };

  logger.info("discovery.complete", result.stats);
  return result;
}
