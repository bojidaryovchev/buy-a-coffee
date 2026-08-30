import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sha256Hex, type Logger, silentLogger } from "@catalog/shared";
import { findWorkspaceRoot, resolveFromWorkspaceRoot } from "./paths.ts";
import type { ScraperConfig } from "../config.ts";
import type { CatalogDiscoveryResult } from "../catalog/discover.ts";
import type { DiscoveryCrawlResult } from "../discovery/crawler.ts";
import {
  buildFeatureInventory,
  buildFilterInventory,
  buildFormInventory,
  buildRoutePatterns,
} from "../discovery/features.ts";

/**
 * Reference artifacts: the handoff contract consumed by the storefront build.
 *
 * Two properties matter more than anything else here:
 *
 *  - **Deterministic.** Same crawl input produces byte-identical files, so a
 *    diff between two exports shows real changes to the source site rather
 *    than key reordering or timestamp churn. Every object is written with
 *    sorted keys and every list has an explicit sort.
 *  - **Self-describing.** `manifest.json` carries checksums for each file, so
 *    a consumer can tell whether it is reading a complete, untampered export.
 */

export const ARTIFACT_SCHEMA_VERSION = "1.0.0";
export const CRAWLER_VERSION = "0.1.0";

export interface ArtifactExportInput {
  readonly config: ScraperConfig;
  readonly crawl: DiscoveryCrawlResult;
  readonly catalog: CatalogDiscoveryResult;
  readonly outputDir: string;
  readonly crawlRunId?: string | null;
  readonly logger?: Logger;
  /** Injected in tests so the manifest is reproducible. */
  readonly now?: () => Date;
}

export interface ArtifactManifest {
  readonly schemaVersion: string;
  readonly crawlerVersion: string;
  readonly sourceHost: string;
  readonly sourceBaseUrl: string;
  readonly crawlRunId: string | null;
  readonly generatedAt: string;
  readonly gitCommit: string | null;
  readonly counts: Record<string, number>;
  readonly files: Array<{ name: string; bytes: number; sha256: string }>;
}

/** Recursively sort object keys so JSON output is stable. */
export function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([k, v]) => [k, stableSort(v)]));
}

function serialise(value: unknown): string {
  return `${JSON.stringify(stableSort(value), null, 2)}\n`;
}

async function readGitCommit(cwd: string): Promise<string | null> {
  try {
    const exec = promisify(execFile);
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd, timeout: 5_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function exportReferenceArtifacts(
  input: ArtifactExportInput,
): Promise<{ outputDir: string; manifest: ArtifactManifest }> {
  const logger = input.logger ?? silentLogger;
  const now = input.now ?? (() => new Date());
  const { crawl, catalog, config } = input;

  // Anchored to the workspace root so the contract directory does not move
  // when the CLI is invoked from a package directory.
  const outputDir = resolveFromWorkspaceRoot(input.outputDir);
  // A stale file from a previous export would silently become part of the
  // contract, so the directory is rebuilt rather than merged into.
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const realPages = crawl.pages.filter((page) => !page.isSoft404);
  const softPages = crawl.pages.filter((page) => page.isSoft404);

  const pageTypeCounts: Record<string, number> = {};
  for (const page of crawl.pages) {
    const key = page.classification.pageType;
    pageTypeCounts[key] = (pageTypeCounts[key] ?? 0) + 1;
  }

  const features = buildFeatureInventory(crawl, catalog);
  const forms = buildFormInventory(crawl);
  const filters = buildFilterInventory(crawl, catalog);
  const routePatterns = buildRoutePatterns(crawl);

  const files: Array<{ name: string; content: string }> = [];

  files.push({
    name: "pages.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description:
        "Every public page reached by the discovery crawl. `isSoft404` entries returned HTTP 200 with the home-page shell and are not real pages.",
      count: crawl.pages.length,
      pages: [...crawl.pages]
        .sort((a, b) => (a.canonicalUrl < b.canonicalUrl ? -1 : 1))
        .map((page) => ({
          url: page.canonicalUrl,
          canonicalUrl: page.canonicalUrl,
          finalUrl: page.finalUrl,
          path: page.path,
          depth: page.depth,
          statusCode: page.statusCode,
          contentType: page.contentType,
          isSoft404: page.isSoft404,
          title: page.title,
          metaDescription: page.metaDescription,
          canonicalTag: page.canonicalTag,
          pageType: page.classification.pageType,
          pageTypeConfidence: page.classification.confidence,
          pageTypeEvidence: page.classification.evidence,
          headings: page.headings,
          internalLinkCount: page.internalLinks.length,
          externalLinkCount: page.externalLinks.length,
          formCount: page.forms.length,
          structuredDataCount: page.structuredData.length,
          contentHash: page.contentHash,
          byteSize: page.byteSize,
        })),
    }),
  });

  files.push({
    name: "site-map.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description: "Directed graph of internal links. Nodes are canonical pages, edges are links.",
      nodes: [...crawl.pages]
        .sort((a, b) => (a.canonicalUrl < b.canonicalUrl ? -1 : 1))
        .map((page) => ({
          url: page.canonicalUrl,
          pageType: page.classification.pageType,
          depth: page.depth,
          isSoft404: page.isSoft404,
        })),
      edges: [...crawl.links]
        .sort((a, b) =>
          a.fromCanonicalUrl === b.fromCanonicalUrl
            ? a.toCanonicalUrl < b.toCanonicalUrl
              ? -1
              : 1
            : a.fromCanonicalUrl < b.fromCanonicalUrl
              ? -1
              : 1,
        )
        .map((link) => ({
          from: link.fromCanonicalUrl,
          to: link.toCanonicalUrl,
          anchorText: link.anchorText,
          rel: link.rel,
        })),
      externalHosts: crawl.externalHosts,
    }),
  });

  files.push({
    name: "route-patterns.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description:
        "Observed URL patterns per page type. The source uses a flat namespace: products, categories and brands all live at `/<slug>/`, so page type cannot be derived from the URL.",
      patterns: routePatterns,
    }),
  });

  files.push({
    name: "page-types.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description: "Page-type counts and the URLs classified into each.",
      counts: pageTypeCounts,
      types: Object.keys(pageTypeCounts)
        .sort()
        .map((type) => ({
          pageType: type,
          count: pageTypeCounts[type] ?? 0,
          urls: crawl.pages
            .filter((page) => page.classification.pageType === type)
            .map((page) => page.canonicalUrl)
            .sort()
            .slice(0, 200),
        })),
    }),
  });

  files.push({
    name: "products.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description:
        "Normalised catalog snapshot. `sourceKey` combines the canonical path with the normalised pack size because the source serves two different products from one URL.",
      catalogSource: catalog.source,
      parserConfidence: catalog.confidence,
      rawRecordCount: catalog.rawRecordCount,
      count: catalog.products.length,
      collidingPaths: catalog.collidingPaths.sort(),
      duplicateKeys: [...new Set(catalog.duplicateKeys)].sort(),
      products: [...catalog.products]
        .sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1))
        .map((product) => ({
          sourceKey: product.sourceKey,
          sourceUrl: product.sourceUrl,
          sourcePath: product.sourcePath,
          sourceVariantKey: product.sourceVariantKey,
          identityStrategy: product.identityStrategy,
          hasUrlCollision: product.hasUrlCollision,
          name: product.name,
          currentPrice: product.currentPrice?.amount ?? null,
          oldPrice: product.oldPrice?.amount ?? null,
          currency: product.currency,
          availability: product.availability,
          brandKey: product.brandKey,
          categoryKeys: [...product.categoryKeys].sort(),
          weight: product.weightText,
          weightCanonical: product.weight?.canonical ?? null,
          sku: product.sku,
          gtin: product.gtin,
          attributes: product.attributes,
          descriptionText: product.descriptionText,
          sourceImageUrls: [...product.sourceImageUrls].sort(),
          semanticHash: product.semanticHash,
        })),
    }),
  });

  files.push({
    name: "categories.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description: "Category taxonomy, including parent/child relationships.",
      count: catalog.categories.length,
      categories: [...catalog.categories]
        .sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1))
        .map((category) => ({
          sourceKey: category.sourceKey,
          rawSlug: category.rawSlug,
          sourceId: category.sourceId,
          name: category.name,
          url: category.url,
          parentKey: category.parentKey,
          position: category.position,
          productCount: category.productCount,
        })),
    }),
  });

  files.push({
    name: "brands.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description:
        "Brands that carry products. `rawSlug` preserves the source slug verbatim, including a leading space on one real brand.",
      count: catalog.brands.length,
      brands: [...catalog.brands]
        .sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1))
        .map((brand) => ({
          sourceKey: brand.sourceKey,
          rawSlug: brand.rawSlug,
          sourceId: brand.sourceId,
          name: brand.name,
          url: brand.url,
          productCount: brand.productCount,
        })),
    }),
  });

  files.push({
    name: "filters.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description:
        "Catalog filters, their URL parameters and observed values. Effects were determined by reading the page's own filter script, never by submitting anything.",
      count: filters.length,
      filters,
    }),
  });

  files.push({
    name: "forms.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description:
        "Public forms. The source has no <form> elements at all: both flows are script-driven fetch() calls. No form was ever submitted.",
      count: forms.length,
      forms,
    }),
  });

  files.push({
    name: "features.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description:
        "Observed public storefront capabilities. Every entry is backed by evidence URLs from the crawl.",
      count: features.length,
      features,
    }),
  });

  files.push({
    name: "relationships.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description: "Entity relationships derived from the catalog.",
      categoryTree: buildCategoryTree(catalog),
      productsPerCategory: countBy(catalog.products.flatMap((p) => p.categoryKeys)),
      productsPerBrand: countBy(
        catalog.products.map((p) => p.brandKey).filter((key): key is string => key !== null),
      ),
      productsWithoutBrand: catalog.products.filter((p) => p.brandKey === null).length,
      productsWithoutPrice: catalog.products.filter((p) => p.currentPrice === null).length,
      productsWithoutWeight: catalog.products.filter((p) => p.weight === null).length,
      productsOnPromotion: catalog.products.filter((p) => p.oldPrice !== null).length,
      urlCollisions: [...catalog.collidingPaths].sort().map((path) => ({
        path,
        sourceKeys: catalog.products
          .filter((product) => product.sourcePath === path)
          .map((product) => product.sourceKey)
          .sort(),
      })),
    }),
  });

  files.push({
    name: "errors.json",
    content: serialise({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      description: "Failures encountered during discovery, plus stale sitemap entries.",
      crawlErrors: [...crawl.errors].sort((a, b) => (a.url < b.url ? -1 : 1)),
      catalogErrors: [...catalog.errors].sort((a, b) => (a.url < b.url ? -1 : 1)),
      invalidProductRecords: [...catalog.invalidRecords].sort((a, b) => (a.path < b.path ? -1 : 1)),
      softNotFoundUrls: softPages.map((page) => page.canonicalUrl).sort(),
      blockedByRobots: crawl.blockedByRobots,
      staleSitemapEntries: crawl.sitemapEntries
        .filter((entry) => entry.outcome !== "ok")
        .sort((a, b) => (a.loc < b.loc ? -1 : 1)),
    }),
  });

  const counts: Record<string, number> = {
    pagesCrawled: crawl.pages.length,
    realPages: realPages.length,
    softNotFoundPages: softPages.length,
    internalLinks: crawl.links.length,
    products: catalog.products.length,
    categories: catalog.categories.length,
    brands: catalog.brands.length,
    features: features.length,
    filters: filters.length,
    forms: forms.length,
    routePatterns: routePatterns.length,
    crawlErrors: crawl.errors.length,
  };

  files.push({
    name: "report.md",
    content: buildReport({ config, crawl, catalog, counts, pageTypeCounts, features, filters, forms }),
  });

  const manifest: ArtifactManifest = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    crawlerVersion: CRAWLER_VERSION,
    sourceHost: config.canonicalHost,
    sourceBaseUrl: config.baseUrl,
    crawlRunId: input.crawlRunId ?? null,
    generatedAt: now().toISOString(),
    gitCommit: await readGitCommit(findWorkspaceRoot()),
    counts,
    files: files
      .map((file) => ({
        name: file.name,
        bytes: Buffer.byteLength(file.content, "utf8"),
        sha256: sha256Hex(file.content),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : 1)),
  };

  for (const file of files) {
    await writeFile(path.join(outputDir, file.name), file.content, "utf8");
  }
  await writeFile(path.join(outputDir, "manifest.json"), serialise(manifest), "utf8");

  logger.info("reference.exported", { outputDir, files: files.length + 1, counts });
  return { outputDir, manifest };
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function buildCategoryTree(catalog: CatalogDiscoveryResult): unknown[] {
  const byParent = new Map<string | null, typeof catalog.categories>();
  for (const category of catalog.categories) {
    const list = byParent.get(category.parentKey) ?? [];
    list.push(category);
    byParent.set(category.parentKey, list);
  }
  const build = (parentKey: string | null): unknown[] =>
    [...(byParent.get(parentKey) ?? [])]
      .sort((a, b) => a.position - b.position || (a.sourceKey < b.sourceKey ? -1 : 1))
      .map((category) => ({
        sourceKey: category.sourceKey,
        name: category.name,
        productCount: category.productCount,
        children: build(category.sourceKey),
      }));
  return build(null);
}

function buildReport(input: {
  config: ScraperConfig;
  crawl: DiscoveryCrawlResult;
  catalog: CatalogDiscoveryResult;
  counts: Record<string, number>;
  pageTypeCounts: Record<string, number>;
  features: ReturnType<typeof buildFeatureInventory>;
  filters: ReturnType<typeof buildFilterInventory>;
  forms: ReturnType<typeof buildFormInventory>;
}): string {
  const { config, crawl, catalog, counts, pageTypeCounts, features, filters, forms } = input;

  const lines: string[] = [];
  lines.push(`# Reference site report — ${config.canonicalHost}`);
  lines.push("");
  lines.push(
    "Generated by the discovery crawler. Everything below was observed on public pages; nothing was inferred and no form was submitted.",
  );
  lines.push("");

  lines.push("## Crawl summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  for (const [key, value] of Object.entries(counts)) lines.push(`| ${key} | ${value} |`);
  lines.push(`| crawlDurationMs | ${crawl.stats.durationMs} |`);
  lines.push("");

  lines.push("## Page types");
  lines.push("");
  lines.push("| Page type | Count |");
  lines.push("| --- | --- |");
  for (const [type, count] of Object.entries(pageTypeCounts).sort(([a], [b]) => (a < b ? -1 : 1))) {
    lines.push(`| ${type} | ${count} |`);
  }
  lines.push("");

  if ((pageTypeCounts.soft_404 ?? 0) > 0) {
    lines.push("### Soft 404s");
    lines.push("");
    lines.push(
      `The source answers unknown routes with **HTTP 200 and the home-page shell**. ${pageTypeCounts.soft_404} such URLs were reached, mostly stale \`/products/<slug>/\` entries still listed in \`sitemap.xml\`. They are recorded but excluded from the catalog.`,
    );
    lines.push("");
  }

  lines.push("## Catalog");
  lines.push("");
  lines.push(`- Source used: \`${catalog.source}\``);
  lines.push(`- Parser confidence: ${catalog.confidence.toFixed(2)}`);
  lines.push(`- Raw records: ${catalog.rawRecordCount}, distinct products: ${catalog.products.length}`);
  lines.push(`- Categories: ${catalog.categories.length}, brands: ${catalog.brands.length}`);
  lines.push(
    `- Products without a price: ${catalog.products.filter((p) => p.currentPrice === null).length}`,
  );
  lines.push(`- Products on promotion: ${catalog.products.filter((p) => p.oldPrice !== null).length}`);
  if (catalog.collidingPaths.length > 0) {
    lines.push("");
    lines.push(
      `**URL collisions:** ${catalog.collidingPaths.length} path(s) serve more than one distinct product. Product identity therefore combines the path with the normalised pack size:`,
    );
    for (const path of catalog.collidingPaths.sort()) {
      const keys = catalog.products.filter((p) => p.sourcePath === path).map((p) => p.sourceKey);
      lines.push(`- \`${path}\` → ${keys.map((k) => `\`${k}\``).join(", ")}`);
    }
  }
  lines.push("");

  lines.push("## Category tree");
  lines.push("");
  const roots = catalog.categories.filter((category) => category.parentKey === null);
  for (const root of roots.sort((a, b) => a.position - b.position)) {
    lines.push(`- **${root.name}** (\`${root.sourceKey}\`) — ${root.productCount ?? 0} products`);
    for (const child of catalog.categories.filter((c) => c.parentKey === root.sourceKey)) {
      lines.push(`  - ${child.name} (\`${child.sourceKey}\`) — ${child.productCount ?? 0} products`);
    }
  }
  lines.push("");

  lines.push("## Observed features");
  lines.push("");
  for (const feature of features) {
    lines.push(`### ${feature.name} (\`${feature.id}\`)`);
    lines.push("");
    lines.push(feature.description);
    lines.push("");
    lines.push(`- Page types: ${feature.pageTypes.join(", ") || "—"}`);
    lines.push(`- Evidence: ${feature.evidenceUrls.slice(0, 3).map((u) => `\`${u}\``).join(", ")}`);
    for (const note of feature.implementationNotes ?? []) lines.push(`- Note: ${note}`);
    lines.push("");
  }

  lines.push("## Filters");
  lines.push("");
  if (filters.length === 0) {
    lines.push("No filters were observed.");
  } else {
    lines.push("| Filter | URL parameter | Multi-value | Values |");
    lines.push("| --- | --- | --- | --- |");
    for (const filter of filters) {
      lines.push(
        `| ${filter.name} | \`${filter.urlParam ?? "—"}\` | ${filter.multiValue ? "yes" : "no"} | ${filter.values.map((v) => v.value).join(", ") || "—"} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Public forms");
  lines.push("");
  lines.push(
    "The source has **no `<form>` elements**. Both public flows are script-driven `fetch()` calls to a third-party CMS endpoint. Neither was submitted.",
  );
  lines.push("");
  for (const form of forms) {
    lines.push(`- **${form.name}** — fields: ${form.fields.map((f) => f.type ?? "?").join(", ")}. ${form.sideEffectWarning ?? ""}`);
  }
  lines.push("");

  lines.push("## Notes for the storefront build");
  lines.push("");
  lines.push("- There is no cart, checkout or payment anywhere on the reference site.");
  lines.push("- Ordering is a single phone-number field; the shop calls back to confirm.");
  lines.push("- Filtering and search are client-side on the reference; ours must be server-rendered.");
  lines.push("- Listings have no pagination and no sort control: every product renders at once.");
  lines.push("- Prices are in EUR. At least one uses a comma decimal separator.");
  lines.push("- Some products have no price and some have no pack size; both must render safely.");
  lines.push("");

  return lines.join("\n");
}
