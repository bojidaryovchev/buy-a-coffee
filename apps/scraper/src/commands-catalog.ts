import { runCatalogEnrich } from "@catalog/scraper-core/catalog/enrich";
import {
  applyProductLink,
  formatLinkPlan,
  planProductLink,
} from "@catalog/scraper-core/catalog/link";
import { formatCatalogVerifyReport, verifyCatalog } from "@catalog/scraper-core/catalog/verify";
import type { Runtime } from "./runtime.ts";

/**
 * Catalog maintenance commands: `catalog:verify`, `catalog:link` and
 * `catalog:enrich`.
 *
 * The first two never contact the source. `catalog:enrich` does, but only
 * with `--apply`: its plan reads our own database and nothing else. The logic
 * lives in `@catalog/scraper-core`; this file only reads arguments, prints,
 * and chooses an exit code.
 */

export const CATALOG_HELP = `
Catalog commands:
  catalog:verify     Assert the catalog invariants; exits 2 on a violation
  catalog:link <our-slug> <new-source-key>
                     Re-point a product at the key the source lists it under now
  catalog:enrich     Read the product page of every active product without a
                     product code, and store the code and the stated facts

catalog:verify options:
  --json                   Print the full report as JSON

catalog:link options:
  --apply                  Write the link (default: print the plan only)
  --absorb-twin            Delete the duplicate row that already holds the new key

catalog:enrich options:
  --apply                  Read the pages and write (default: print the plan only)
  --limit <n>              Read at most n product pages
`;

/** Mirrors `EXIT` in cli.ts, which cannot be imported from here without a cycle. */
const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_UNTRUSTED = 2;

/**
 * Run a catalog command.
 *
 * Returns the exit code, or `null` when `command` is not one of ours — which
 * lets cli.ts hand over anything it does not recognise with a single line.
 */
export async function runCatalogCommand(
  runtime: Runtime,
  command: string,
  args: readonly string[],
): Promise<number | null> {
  if (command === "catalog:enrich") return runEnrich(runtime, args);
  if (command !== "catalog:verify" && command !== "catalog:link") return null;

  // Read here rather than through cli.ts's `parseArgs`, which would take the
  // word after `--apply` to be that flag's value.
  const flags = new Set(args.filter((arg) => arg.startsWith("--") && arg !== "--"));
  const positional = args.filter((arg) => !arg.startsWith("--"));

  if (command === "catalog:verify") {
    const report = await verifyCatalog(runtime.db);
    process.stdout.write(
      flags.has("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatCatalogVerifyReport(report)}\n`,
    );
    return report.ok ? EXIT_OK : EXIT_UNTRUSTED;
  }

  const [slug, sourceKey] = positional;
  if (!slug || !sourceKey || positional.length !== 2) {
    process.stderr.write(
      "Usage: catalog:link <our-slug> <new-source-key> [--apply] [--absorb-twin]\n",
    );
    return EXIT_USAGE;
  }

  const { config, db } = runtime;
  const plan = await planProductLink(db, {
    siteKey: config.sourceKey,
    baseUrl: config.baseUrl,
    canonicalHost: config.canonicalHost,
    hostAliases: config.hostAliases,
    slug,
    sourceKey,
    absorbTwin: flags.has("--absorb-twin"),
  });

  const apply = flags.has("--apply") && plan.outcome === "ready";
  if (apply) {
    const result = await applyProductLink(db, plan);
    runtime.logger.info("catalog.linked", { ...result, to: plan.to?.sourceKey });
  }
  process.stdout.write(`${formatLinkPlan(plan, { applied: apply })}\n`);
  return plan.outcome === "blocked" ? EXIT_USAGE : EXIT_OK;
}

/**
 * Read `--limit <n>` or `--limit=<n>`. Returns `null` for a value that is not
 * a whole number of pages, so a typo stops the command instead of reading
 * everything.
 */
export function parseEnrichArgs(
  args: readonly string[],
): { apply: boolean; limit: number | undefined } | null {
  let apply = false;
  let limit: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--limit" || arg.startsWith("--limit=")) {
      const raw = arg === "--limit" ? args[(index += 1)] : arg.slice("--limit=".length);
      if (raw === undefined || !/^\d+$/.test(raw)) return null;
      limit = Number.parseInt(raw, 10);
      continue;
    }
    // Options every command accepts (`--verbose`, `--base-url x`) are read by
    // cli.ts; anything else here is a mistake.
    if (arg === "--verbose") continue;
    if (arg === "--base-url" || arg === "--concurrency") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--base-url=") || arg.startsWith("--concurrency=")) continue;
    return null;
  }
  return { apply, limit };
}

async function runEnrich(runtime: Runtime, args: readonly string[]): Promise<number> {
  const parsed = parseEnrichArgs(args);
  if (!parsed) {
    process.stderr.write("Usage: catalog:enrich [--apply] [--limit <n>]\n");
    return EXIT_USAGE;
  }

  const result = await runCatalogEnrich({
    config: runtime.config,
    db: runtime.db,
    fetcher: runtime.fetcher,
    logger: runtime.logger,
    apply: parsed.apply,
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        command: "catalog:enrich",
        ...result,
        note: result.applied
          ? `Read ${result.requests} product page(s); ${result.after.withoutCode} active product(s) still have no code.`
          : parsed.apply
            ? "Nothing to do: every active product already has a product code."
            : `Plan only; nothing was requested or written. --apply would read ${result.selected} product page(s).`,
      },
      null,
      2,
    )}\n`,
  );
  // Stopping early on repeated failures means the source was not well enough
  // to finish: completed, but not to be trusted as a full backfill.
  return result.halted ? EXIT_UNTRUSTED : EXIT_OK;
}
