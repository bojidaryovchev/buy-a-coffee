import {
  applyProductLink,
  formatLinkPlan,
  planProductLink,
} from "@catalog/scraper-core/catalog/link";
import { formatCatalogVerifyReport, verifyCatalog } from "@catalog/scraper-core/catalog/verify";
import type { Runtime } from "./runtime.ts";

/**
 * Catalog maintenance commands: `catalog:verify` and `catalog:link`.
 *
 * Neither contacts the source. The logic lives in `@catalog/scraper-core`;
 * this file only reads arguments, prints, and chooses an exit code.
 */

export const CATALOG_HELP = `
Catalog commands:
  catalog:verify     Assert the catalog invariants; exits 2 on a violation
  catalog:link <our-slug> <new-source-key>
                     Re-point a product at the key the source lists it under now

catalog:verify options:
  --json                   Print the full report as JSON

catalog:link options:
  --apply                  Write the link (default: print the plan only)
  --absorb-twin            Delete the duplicate row that already holds the new key
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
