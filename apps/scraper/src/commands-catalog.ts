import { existsSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { products, syncChanges } from "@catalog/db/schema";
import { childEnvironment, runClaudeBatch } from "@catalog/scraper-core/catalog/copywriter/claude";
import { runCatalogCopy } from "@catalog/scraper-core/catalog/copywriter/run";
import { createSourceCheck } from "@catalog/scraper-core/catalog/copywriter/verify";
import { submitIndexNow } from "@catalog/shared/indexnow";
import {
  requestRevalidation,
  revalidationSiteUrl,
  type RevalidateBody,
} from "@catalog/shared/revalidate";
import type { SyncResult } from "@catalog/scraper-core";
import { runCatalogEnrich } from "@catalog/scraper-core/catalog/enrich";
import {
  applyProductLink,
  formatLinkPlan,
  planProductLink,
} from "@catalog/scraper-core/catalog/link";
import { formatCatalogVerifyReport, verifyCatalog } from "@catalog/scraper-core/catalog/verify";
import type { Runtime } from "./runtime.ts";

/**
 * Catalog maintenance commands: `catalog:verify`, `catalog:link`,
 * `catalog:enrich` and `catalog:copy`.
 *
 * The first two never contact the source. `catalog:enrich` does, but only
 * with `--apply`: its plan reads our own database and nothing else.
 * `catalog:copy` never contacts the source either; with `--apply` it runs
 * Claude Code (see `copywriter/claude.ts`). The logic
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
  catalog:copy       Write our own description for synced products that have
                     none, and research the facts of products whose pack size
                     looks wrong (Claude Code, \`claude -p\`)

catalog:verify options:
  --json                   Print the full report as JSON

catalog:link options:
  --apply                  Write the link (default: print the plan only)
  --absorb-twin            Delete the duplicate row that already holds the new key

catalog:enrich options:
  --apply                  Read the pages and write (default: print the plan only)
  --limit <n>              Read at most n product pages

catalog:copy options:
  --apply                  Run the model and write (default: print the plan only)
  --limit <n>              At most n products this run (default 40)
  --batch <n>              Products per prompt (default 10)
  --slug <slug>            Only this product; repeatable
  --force                  With --slug: rewrite machine copy even when current
  Environment: CLAUDE_BIN (the claude executable), CLAUDE_COPY_MODEL
  (default claude-opus-5-5), and the CLI's own sign-in -
  CLAUDE_CODE_OAUTH_TOKEN from \`claude setup-token\` on CI.
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
  if (command === "catalog:copy") return runCopy(runtime, args);
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

export interface CopyArgs {
  readonly apply: boolean;
  readonly limit: number;
  readonly batchSize: number;
  readonly slugs: readonly string[];
  readonly force: boolean;
}

/** Read `catalog:copy`'s arguments; `null` for anything malformed. */
export function parseCopyArgs(args: readonly string[]): CopyArgs | null {
  let apply = false;
  let force = false;
  let limit = 40;
  let batchSize = 10;
  const slugs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === "--apply") apply = true;
    else if (arg === "--force") force = true;
    else if (arg === "--verbose") continue;
    else if (/^--(limit|batch|slug)(=|$)/.test(arg)) {
      const [name, inline] = arg.split("=", 2) as [string, string | undefined];
      const value = inline ?? args[(index += 1)];
      if (value === undefined || value === "") return null;
      if (name === "--slug") {
        slugs.push(
          ...value
            .split(",")
            .map((slug) => slug.trim())
            .filter(Boolean),
        );
        continue;
      }
      if (!/^\d+$/.test(value)) return null;
      const number = Number.parseInt(value, 10);
      if (number < 1) return null;
      if (name === "--limit") limit = number;
      else batchSize = Math.min(number, 25);
    } else return null;
  }
  if (force && slugs.length === 0) return null;
  return { apply, limit, batchSize, slugs, force };
}

/** The repository root: where `.claude/skills` lives. */
function repositoryRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
}

/**
 * The `claude` executable. On CI it is on the PATH. On Windows the npm
 * install puts shell shims on the PATH (`claude`, `claude.cmd`) that cannot be
 * started without a shell, and a shell would mangle the JSON schema argument -
 * so the binary behind them is started directly.
 */
function claudeBin(): string {
  const configured = process.env.CLAUDE_BIN?.trim();
  if (configured) return configured;
  if (process.platform === "win32" && process.env.APPDATA) {
    const native = path.join(
      process.env.APPDATA,
      "npm",
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );
    if (existsSync(native)) return native;
  }
  return "claude";
}

async function runCopy(runtime: Runtime, args: readonly string[]): Promise<number> {
  const parsed = parseCopyArgs(args);
  if (!parsed) {
    process.stderr.write(
      "Usage: catalog:copy [--apply] [--limit <n>] [--batch <n>] [--slug <slug>]... [--force]\n",
    );
    return EXIT_USAGE;
  }

  const skillFile = path.join(
    repositoryRoot(process.cwd()),
    ".claude",
    "skills",
    "catalog-copy",
    "SKILL.md",
  );
  if (parsed.apply && !existsSync(skillFile)) {
    process.stderr.write(`catalog:copy: the skill is missing (${skillFile})\n`);
    return EXIT_USAGE;
  }
  const model = process.env.CLAUDE_COPY_MODEL?.trim() || "claude-opus-5-5";
  const bin = claudeBin();
  // The model's process sees none of this process's secrets; see `childEnvironment`.
  const env = childEnvironment(process.env);
  const result = await runCatalogCopy({
    db: runtime.db,
    logger: runtime.logger,
    apply: parsed.apply,
    limit: parsed.limit,
    batchSize: parsed.batchSize,
    ...(parsed.slugs.length > 0 ? { slugs: parsed.slugs } : {}),
    force: parsed.force,
    skillFile,
    model,
    generate: ({ cwd, batchFile, products, researched }) =>
      runClaudeBatch(batchFile, {
        bin,
        cwd,
        model,
        env,
        // Reading the file, about eight searches and page reads per product
        // researched, and room to think about the copy.
        maxTurns: 12 + 10 * researched + 2 * products,
        timeoutMs: Math.min(40, 6 + 4 * researched + products) * 60 * 1000,
      }),
    checkSources: createSourceCheck(),
  });

  const announced = await announceChanges(runtime, result.changed);
  // A new text or a corrected size shows on the product page and on every
  // card of it, so the whole catalog, not the product page alone.
  const storefront =
    result.changed.length > 0 ? await refreshStorefront(runtime, { scope: "catalog" }) : null;

  process.stdout.write(
    `${JSON.stringify(
      {
        command: "catalog:copy",
        indexNow: announced,
        storefront,
        model,
        ...result,
        planned: result.planned.length,
        plan: result.planned,
        note: result.applied
          ? `Wrote ${result.copyWritten} text(s), rejected ${result.copyRejected}, researched ${result.researched} product(s), corrected ${result.packsCorrected} pack size(s).`
          : parsed.apply
            ? "Nothing to do."
            : `Plan only; nothing was sent or written. --apply would work on ${result.planned.length} product(s).`,
      },
      null,
      2,
    )}\n`,
  );
  if (result.stopped?.startsWith("setup")) return EXIT_USAGE;
  return result.stopped !== null || result.failedBatches > 0 ? EXIT_UNTRUSTED : EXIT_OK;
}

/**
 * Tell IndexNow (Bing and others; not Google) which product pages changed, so
 * they are recrawled now rather than eventually: new text and corrected sizes
 * from the copywriter, and whatever a sync created, changed, moved or removed.
 *
 * Optional: without `INDEXNOW_KEY` and `SITE_URL` nothing is sent. A refusal
 * or a network error is reported, never fatal - the copy is already written.
 */
export async function announceChanges(
  runtime: Pick<Runtime, "logger">,
  slugs: readonly string[],
): Promise<{ submitted: number; ok: boolean; skipped: string | null }> {
  const siteUrl = process.env.SITE_URL?.trim();
  if (slugs.length === 0) return { submitted: 0, ok: true, skipped: "no-urls" };
  if (!siteUrl) return { submitted: 0, ok: true, skipped: "no-site-url" };
  try {
    const origin = new URL(siteUrl).origin;
    const result = await submitIndexNow({
      siteUrl: origin,
      key: process.env.INDEXNOW_KEY?.trim(),
      // A product's page is `/bg/<slug>` (`productHref` in the storefront).
      urls: slugs.map((slug) => `${origin}/bg/${encodeURIComponent(slug)}`),
    });
    if (!result.ok) runtime.logger.warn("indexnow.refused", { statuses: result.statuses });
    return { submitted: result.submitted, ok: result.ok, skipped: result.skipped };
  } catch (error) {
    runtime.logger.warn("indexnow.failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { submitted: 0, ok: false, skipped: null };
  }
}

/** What `refreshStorefront` reports, for the run's printed result and the job summary. */
export interface StorefrontRefresh {
  readonly ok: boolean;
  /** Why nothing was sent, when nothing was: a missing `SITE_URL` or `CRON_SECRET`. */
  readonly skipped: string | null;
  readonly status: number | null;
  readonly routes: number;
  readonly paths: number;
  readonly error: string | null;
}

const SKIPPED_BECAUSE: Record<string, string> = {
  "no-site-url": "SITE_URL is not set",
  "bad-site-url": "SITE_URL is not a URL",
  "insecure-site-url": "SITE_URL is not https",
  "no-secret": "CRON_SECRET is not set",
};

/**
 * Ask the storefront to redraw what a run changed (`POST /api/revalidate`,
 * through `@catalog/shared/revalidate`): without it the pages show the change
 * within their five minutes and the sitemap within the CDN's hour.
 *
 * Optional: without `SITE_URL` (or `NEXT_PUBLIC_SITE_URL`) and `CRON_SECRET`
 * nothing is sent, and the log says which is missing. A refusal, a timeout or
 * a network error is a warning, never fatal - the change is already written.
 */
export async function refreshStorefront(
  runtime: Pick<Runtime, "logger">,
  body: RevalidateBody,
): Promise<StorefrontRefresh> {
  const outcome = await requestRevalidation({
    siteUrl: revalidationSiteUrl(process.env),
    secret: process.env.CRON_SECRET,
    body,
  });
  if (outcome.skipped) {
    runtime.logger.info("storefront.revalidate.skipped", {
      reason: SKIPPED_BECAUSE[outcome.skipped] ?? outcome.skipped,
      note: "Pages catch up within 5 minutes, the sitemap within about an hour.",
    });
  } else if (outcome.ok) {
    runtime.logger.info("storefront.revalidated", {
      routes: outcome.routes,
      paths: outcome.paths,
    });
  } else {
    runtime.logger.warn("storefront.revalidate.failed", {
      status: outcome.status,
      error: outcome.error,
    });
  }
  return {
    ok: outcome.ok,
    skipped: outcome.skipped ? (SKIPPED_BECAUSE[outcome.skipped] ?? outcome.skipped) : null,
    status: outcome.status,
    routes: outcome.routes,
    paths: outcome.paths,
    error: outcome.error,
  };
}

/**
 * Whether a sync run wrote anything the shop shows: a product created,
 * changed, moved, marked missing, removed or brought back; a brand or a
 * category created, renamed, hidden or restored; a photograph mirrored; a
 * product page's facts read in.
 */
export function syncChangedShop(
  result: Pick<SyncResult, "appliedDiff" | "taxonomy" | "images" | "enrichment">,
): boolean {
  const productChanged = Object.entries(result.appliedDiff.counts).some(
    ([change, count]) => change !== "unchanged" && count > 0,
  );
  const taxonomy = [result.taxonomy.brands, result.taxonomy.categories].some(
    (side) =>
      side.created.length + side.renamed.length + side.markedMissing.length + side.restored.length >
      0,
  );
  return productChanged || taxonomy || result.images.mirrored > 0 || result.enrichment.enriched > 0;
}

/**
 * Announce the product pages a sync run touched: every product with a
 * recorded change in that run, removed ones included (an engine should drop
 * a page that is gone as soon as one that is new).
 */
export async function announceSyncChanges(
  runtime: Pick<Runtime, "logger" | "db">,
  syncRunId: string,
): Promise<{ submitted: number; ok: boolean; skipped: string | null }> {
  const rows = await runtime.db
    .selectDistinct({ slug: products.slug })
    .from(syncChanges)
    .innerJoin(products, eq(products.id, syncChanges.productId))
    .where(eq(syncChanges.syncRunId, syncRunId));
  return announceChanges(
    runtime,
    rows.map((row) => row.slug),
  );
}
