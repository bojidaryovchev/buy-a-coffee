#!/usr/bin/env node
import { ConfigError, type ScraperConfig } from "@catalog/scraper-core";
import {
  commandDiscovery,
  commandImagesGc,
  commandReferenceExport,
  commandStatus,
  commandSync,
} from "./commands.ts";
import { createRuntime } from "./runtime.ts";

/**
 * Typed CLI with explicit exit codes.
 *
 *   0  success
 *   1  usage or configuration error
 *   2  the job ran but its result is not trustworthy (circuit breaker open,
 *      partial crawl). Distinct from 1 so a scheduler can alert differently
 *      on "misconfigured" versus "the source misbehaved".
 *   3  unexpected failure
 */
export const EXIT = {
  ok: 0,
  usage: 1,
  untrusted: 2,
  failure: 3,
} as const;

interface ParsedArgs {
  readonly command: string;
  readonly flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token || !token.startsWith("--")) continue;
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[body] = next;
      i += 1;
    } else {
      flags[body] = true;
    }
  }
  return { command, flags };
}

function num(flags: ParsedArgs["flags"], key: string): number | undefined {
  const value = flags[key];
  if (value === undefined || typeof value === "boolean") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function str(flags: ParsedArgs["flags"], key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function bool(flags: ParsedArgs["flags"], key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}

const HELP = `
catalog-sync — reference crawler and catalog synchronisation

Usage:
  catalog-sync <command> [options]

Commands:
  discovery          Crawl the full public surface and export reference artifacts
  sync               Synchronise the catalog into PostgreSQL
  reference          Re-export the reference artifacts
  images:gc          Report (and optionally delete) unreferenced mirrored images
  status             Print catalog counts
  help               Show this message

Common options:
  --base-url <url>         Override the source base URL
  --concurrency <n>        Concurrent requests
  --verbose                Debug-level logging

discovery options:
  --max-pages <n>          Cap on pages crawled
  --max-depth <n>          Cap on link depth
  --output <dir>           Artifact output directory (default: reference/latest)
  --skip-export            Crawl without writing artifacts
  --dry-run                Crawl without writing to the database

sync options:
  --dry-run                Compute and report the diff without mutating products
  --no-images              Skip image mirroring
  --product-limit <n>      Only process the first N products

images:gc options:
  --apply                  Actually delete orphaned objects (default: report only)

Exit codes:
  0 success   1 usage/config   2 completed but untrusted   3 failure
`;

export async function main(argv: readonly string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);

  if (command === "help" || command === "--help" || command === "-h" || bool(flags, "help")) {
    process.stdout.write(`${HELP}\n`);
    return EXIT.ok;
  }

  const overrides: Partial<Record<keyof ScraperConfig, unknown>> = {};
  const baseUrl = str(flags, "base-url");
  if (baseUrl) {
    overrides.baseUrl = baseUrl;
    try {
      overrides.canonicalHost = new URL(baseUrl).hostname;
    } catch {
      process.stderr.write(`Invalid --base-url: ${baseUrl}\n`);
      return EXIT.usage;
    }
  }
  const concurrency = num(flags, "concurrency");
  if (concurrency !== undefined) overrides.concurrency = concurrency;
  if (bool(flags, "verbose")) overrides.logLevel = "debug";
  if (bool(flags, "no-images")) overrides.imagesEnabled = false;

  let runtime;
  try {
    runtime = await createRuntime({ overrides, context: { command } });
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      return EXIT.usage;
    }
    process.stderr.write(
      `Failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT.usage;
  }

  try {
    switch (command) {
      case "discovery": {
        const result = await commandDiscovery(runtime, {
          ...(num(flags, "max-pages") !== undefined ? { maxPages: num(flags, "max-pages") } : {}),
          ...(num(flags, "max-depth") !== undefined ? { maxDepth: num(flags, "max-depth") } : {}),
          ...(str(flags, "output") !== undefined ? { output: str(flags, "output") } : {}),
          skipExport: bool(flags, "skip-export"),
          dryRun: bool(flags, "dry-run"),
        });
        printJson({
          command,
          crawlRunId: result.crawlRunId,
          pages: result.crawl.pages.length,
          realPages: result.crawl.pages.filter((page) => !page.isSoft404).length,
          softNotFound: result.crawl.stats.soft404,
          links: result.crawl.links.length,
          errors: result.crawl.errors.length,
          products: result.catalog.products.length,
          categories: result.catalog.categories.length,
          brands: result.catalog.brands.length,
          catalogSource: result.catalog.source,
          parserConfidence: result.catalog.confidence,
          artifactDir: result.artifactDir,
        });
        return result.crawl.errors.length > 0 ? EXIT.untrusted : EXIT.ok;
      }

      case "sync": {
        const result = await commandSync(runtime, {
          dryRun: bool(flags, "dry-run"),
          skipImages: bool(flags, "no-images"),
          ...(num(flags, "product-limit") !== undefined
            ? { productLimit: num(flags, "product-limit") }
            : {}),
        });
        printJson({
          command,
          syncRunId: result.syncRunId,
          status: result.status,
          dryRun: result.dryRun,
          catalogSource: result.discovery.source,
          parserConfidence: result.discovery.confidence,
          discovered: result.discovery.products.length,
          ...result.appliedDiff.counts,
          images: result.images,
          circuitBreaker: {
            tripped: result.breaker.tripped,
            reasons: result.breaker.reasons,
            summary: result.breaker.summary,
          },
          productsBefore: result.productsBefore,
          productsAfter: result.productsAfter,
          durationMs: result.durationMs,
        });
        return result.breaker.tripped || result.status !== "succeeded" ? EXIT.untrusted : EXIT.ok;
      }

      case "reference": {
        const result = await commandReferenceExport(runtime, {
          ...(str(flags, "output") !== undefined ? { output: str(flags, "output") } : {}),
          ...(num(flags, "max-pages") !== undefined ? { maxPages: num(flags, "max-pages") } : {}),
        });
        printJson({ command, ...result });
        return EXIT.ok;
      }

      case "images:gc": {
        const result = await commandImagesGc(runtime, { apply: bool(flags, "apply") });
        printJson({ command, orphaned: result.orphaned.length, deleted: result.deleted });
        return EXIT.ok;
      }

      case "status": {
        printJson({ command, ...(await commandStatus(runtime)) });
        return EXIT.ok;
      }

      default: {
        process.stderr.write(`Unknown command: ${command}\n${HELP}\n`);
        return EXIT.usage;
      }
    }
  } catch (error) {
    runtime.logger.error("cli.failed", { command, error });
    process.stderr.write(
      `${command} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT.failure;
  } finally {
    await runtime.close();
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// Only run when executed directly, so tests can import `main`.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (invokedDirectly || process.env.CATALOG_CLI_FORCE === "1") {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = EXIT.failure;
    });
}
