import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Database } from "@catalog/db";
import { type Logger, normalizeForComparison } from "@catalog/shared";
import { type SourceCheck, reviewBatch, writeDecisions } from "./apply.ts";
import { ClaudeRunError } from "./claude.ts";
import type { CopyBatch, CopyWorkItem } from "./contract.ts";
import { type CopyCandidate, loadCopyCandidates, selectCopyWork } from "./select.ts";

/**
 * `catalog:copy`: write our own text for synced products, and check the facts
 * of the ones whose facts look wrong.
 *
 * Plan by default - it reads the catalogue and prints what it would do, and
 * nothing else. With `apply`, the work goes to the model in batches, each
 * answer is judged by `reviewBatch`, and what passes is written.
 *
 * A run is bounded (`limit` products), so a backlog is worked off over
 * several scheduled runs rather than in one long one, and an unexpected
 * failure costs at most one run's work.
 */

/** Research is the slow part; this many researched products share one prompt at most. */
export const MAX_RESEARCH_PER_BATCH = 4;

export interface GeneratedBatch {
  readonly output: unknown;
  readonly costUsd: number | null;
  readonly turns: number | null;
  readonly durationMs: number;
}

export interface BatchRequest {
  /** The session's working directory: a fresh workspace with the skill and the batch. */
  readonly cwd: string;
  /** The batch file, relative to `cwd`. */
  readonly batchFile: string;
  readonly products: number;
  /** How many of them are to be researched: sizes the turn and time budget. */
  readonly researched: number;
}

/** Turns a batch file into the model's answer. `runClaudeBatch` in production. */
export type CopyGenerator = (request: BatchRequest) => Promise<GeneratedBatch>;

export interface CatalogCopyOptions {
  readonly db: Database;
  readonly logger: Logger;
  readonly apply: boolean;
  /** Products per run. */
  readonly limit: number;
  /** Products per prompt. */
  readonly batchSize: number;
  readonly slugs?: readonly string[];
  readonly force?: boolean;
  /** The skill file (`.claude/skills/catalog-copy/SKILL.md`), copied into each workspace. */
  readonly skillFile: string;
  /** Recorded with every text and check, as `copy_model`. */
  readonly model: string;
  readonly generate: CopyGenerator;
  /** Opens the pages cited for a pack correction; see `verify.ts`. */
  readonly checkSources: SourceCheck;
  readonly now?: () => Date;
}

export interface PlannedProduct {
  readonly slug: string;
  readonly title: string;
  readonly writeCopy: boolean;
  readonly research: boolean;
  readonly reasons: readonly string[];
}

export interface CatalogCopyResult {
  readonly applied: boolean;
  readonly planned: readonly PlannedProduct[];
  /** Wanted work but beyond this run's limit. */
  readonly deferred: number;
  /** Left for the owner after repeated failures. */
  readonly givenUp: readonly string[];
  readonly batches: number;
  readonly copyWritten: number;
  readonly copyRejected: number;
  readonly researched: number;
  readonly packsCorrected: number;
  /** Batches that failed as a whole. */
  readonly failedBatches: number;
  /** Slugs whose page changed in this run. */
  readonly changed: readonly string[];
  /** Set when the run stopped early, and why. */
  readonly stopped: string | null;
  readonly costUsd: number;
}

/**
 * Group the work into prompts. A brand's products stay together, so siblings
 * are written side by side; researched products go at most
 * `MAX_RESEARCH_PER_BATCH` to a prompt, because each one costs several
 * searches and page reads, and a prompt that runs out of turns is lost whole.
 */
export function toBatches(items: readonly CopyWorkItem[], size: number): CopyWorkItem[][] {
  const byBrand = (list: readonly CopyWorkItem[]) => {
    const groups = new Map<string, CopyWorkItem[]>();
    for (const item of list) {
      const key = item.brand ?? "";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.values()].flat();
  };
  const chunk = (list: readonly CopyWorkItem[], length: number) => {
    const chunks: CopyWorkItem[][] = [];
    for (let start = 0; start < list.length; start += length) {
      chunks.push(list.slice(start, start + length));
    }
    return chunks;
  };
  return [
    ...chunk(
      byBrand(items.filter((item) => item.task.research)),
      Math.min(size, MAX_RESEARCH_PER_BATCH),
    ),
    ...chunk(byBrand(items.filter((item) => !item.task.research)), size),
  ];
}

/** Strip anything shaped like a credential from text bound for a public log. */
export function scrubForLog(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .slice(0, 500);
}

/**
 * A workspace for the model: an empty temporary directory holding the skill
 * and nothing of ours, so what it may read is only what it is given.
 */
async function createWorkspace(skillFile: string): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), "catalog-copy-"));
  const skillDir = path.join(workspace, ".claude", "skills", "catalog-copy");
  await mkdir(skillDir, { recursive: true });
  await copyFile(skillFile, path.join(skillDir, "SKILL.md"));
  return workspace;
}

export async function runCatalogCopy(options: CatalogCopyOptions): Promise<CatalogCopyResult> {
  const now = options.now ?? (() => new Date());
  const candidates = await loadCopyCandidates(options.db);
  const plan = selectCopyWork(candidates, {
    limit: options.limit,
    ...(options.slugs ? { slugs: options.slugs } : {}),
    ...(options.force ? { force: options.force } : {}),
  });

  const planned = plan.items.map((item) => ({
    slug: item.slug,
    title: item.title,
    writeCopy: item.task.writeCopy,
    research: item.task.research,
    reasons: item.task.researchReasons,
  }));
  const base = {
    planned,
    deferred: plan.deferred,
    givenUp: plan.givenUp,
  };
  if (!options.apply || plan.items.length === 0) {
    return {
      ...base,
      applied: false,
      batches: 0,
      copyWritten: 0,
      copyRejected: 0,
      researched: 0,
      packsCorrected: 0,
      failedBatches: 0,
      changed: [],
      stopped: null,
      costUsd: 0,
    };
  }

  const byId = new Map<string, CopyCandidate>(candidates.map((c) => [c.id, c]));
  const summaries = new Map<string, string>();
  const bodies = new Map<string, readonly string[]>();
  for (const candidate of candidates) {
    if (candidate.summary) summaries.set(normalizeForComparison(candidate.summary), candidate.id);
    if (candidate.bodyParagraphs.length > 0) bodies.set(candidate.id, candidate.bodyParagraphs);
  }

  const totals = {
    batches: 0,
    copyWritten: 0,
    copyRejected: 0,
    researched: 0,
    packsCorrected: 0,
    failedBatches: 0,
    costUsd: 0,
  };
  let stopped: string | null = null;
  const changed: string[] = [];

  const workspace = await createWorkspace(options.skillFile);
  try {
    const batches = toBatches(plan.items, options.batchSize);
    for (const [index, items] of batches.entries()) {
      const log = options.logger.child({ batch: index + 1, of: batches.length });
      const batchFile = `batch-${index + 1}.json`;
      const batch: CopyBatch = { version: 1, products: items };
      await writeFile(path.join(workspace, batchFile), JSON.stringify(batch, null, 2), "utf8");

      let generated: GeneratedBatch;
      try {
        log.info("copy.batch.start", { products: items.map((item) => item.slug) });
        generated = await options.generate({
          cwd: workspace,
          batchFile,
          products: items.length,
          researched: items.filter((item) => item.task.research).length,
        });
      } catch (error) {
        totals.failedBatches += 1;
        const failure = error instanceof ClaudeRunError ? error.failure : "batch";
        const message = error instanceof Error ? error.message : String(error);
        const detail = error instanceof ClaudeRunError ? scrubForLog(error.detail) : "";
        log.error("copy.batch.failed", { failure, message, detail });
        if (failure !== "batch") {
          // Not these products' fault: stop, and charge nobody an attempt.
          stopped = `${failure}: ${message}`;
          break;
        }
        // This batch's own failure: each product in it is charged one attempt.
        await writeDecisions(
          options.db,
          items.map((item) => ({
            id: item.id,
            slug: item.slug,
            copy: item.task.writeCopy
              ? { status: "rejected" as const, problems: [`пускането се провали: ${message}`] }
              : { status: "not-asked" as const },
            research: item.task.research
              ? { status: "missing" as const, problem: `пускането се провали: ${message}` }
              : { status: "not-asked" as const },
          })),
          options.model,
        );
        continue;
      } finally {
        await rm(path.join(workspace, batchFile), { force: true });
      }

      totals.batches += 1;
      totals.costUsd += generated.costUsd ?? 0;
      const review = await reviewBatch(items, generated.output, {
        candidates: byId,
        summaries,
        bodies,
        model: options.model,
        now: now(),
        checkSources: options.checkSources,
      });
      if (review.strayIds.length > 0) log.warn("copy.batch.stray_ids", { ids: review.strayIds });
      for (const decision of review.decisions) {
        if (decision.copy.status === "rejected") {
          log.warn("copy.rejected", { slug: decision.slug, problems: decision.copy.problems });
        }
        if (decision.research.status === "recorded") {
          const record = decision.research.record;
          log.info("copy.researched", {
            slug: decision.slug,
            verdict: record.verdict,
            applied: record.applied,
            heldBack: record.heldBack,
            pack: record.pack ? `${record.pack.value} ${record.pack.unit}` : null,
          });
        }
      }
      const written = await writeDecisions(options.db, review.decisions, options.model);
      totals.copyWritten += written.copyWritten;
      totals.copyRejected += written.copyRejected;
      totals.researched += written.researched;
      totals.packsCorrected += written.packsCorrected;
      changed.push(...written.changed);
      log.info("copy.batch.done", {
        ...written,
        turns: generated.turns,
        seconds: Math.round(generated.durationMs / 1000),
      });
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  return { ...base, applied: true, ...totals, changed, stopped };
}
