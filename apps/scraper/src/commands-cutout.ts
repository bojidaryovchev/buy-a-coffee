import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { imageCutouts, productImages, type CutoutShape } from "@catalog/db/schema";
import type { ImagesContext } from "./commands-images.ts";

/**
 * Packshot cut-outs — Phase K, K1; DESIGN.md, "Imagery".
 *
 * For every active photo that has no cut-out yet (or whose last attempt
 * failed, a few times), the photo is read from the store, cut out by
 * `tools/cutout/cutout.py`, and the PNG is stored content-addressed under
 * `cutouts/` with a row in `image_cutouts`.
 *
 * The Python tool gets the photos in a temporary directory and nothing else:
 * no database URL, no store token, only the environment it needs to run and to
 * find its models. Everything that writes stays here.
 *
 * A row a person decided (`approved`, `rejected`) or the tool settled (`auto`,
 * `pending`) is never written again by this command; only `failed` rows are
 * retried. A changed photo has a new hash and gets a new row.
 *
 * The one exception is asked for by name: `redo` re-cuts the photos it lists,
 * settled or not, after the tool has improved. The new cut-out always waits
 * for a person, whatever the tool says, and the old decision is cleared. A
 * redo that fails leaves the row as it was, and so does one that finds the
 * row changed since it was read: a decision the owner made meanwhile stands.
 */

export const CUTOUT_PREFIX = "cutouts";
/** A photo that failed this many times is left alone until someone looks. */
export const CUTOUT_MAX_ATTEMPTS = 3;

const TOOL = fileURLToPath(new URL("../../../tools/cutout/cutout.py", import.meta.url));

/** What the tool reports for one photo (`report.json`). */
export interface CutoutReportEntry {
  readonly file?: string;
  readonly width?: number;
  readonly height?: number;
  readonly agreement?: number;
  readonly shape?: CutoutShape;
  readonly status?: "auto" | "pending";
  readonly models?: readonly string[];
  /** The method's version, so a later improvement knows what to redo. */
  readonly version?: number;
  readonly error?: string;
}
export type CutoutReport = Readonly<Record<string, CutoutReportEntry>>;

export interface CutoutCandidate {
  readonly hash: string;
  readonly objectKey: string;
  readonly mimeType: string | null;
  readonly attempts: number;
  /** For a redo: the row's `updated_at` as read, or null if it had none. */
  readonly seen?: string | null;
}

/** Runs the tool; resolves to its exit code. Injected in tests. */
export type CutoutRunner = (input: {
  readonly python: string;
  readonly tool: string;
  readonly inDir: string;
  readonly outDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly onLine: (line: string) => void;
}) => Promise<number>;

export interface CutoutOptions {
  /** Process at most this many photos. */
  readonly limit?: number;
  /** Re-cut these photos (content hashes), settled or not; `limit` is ignored. */
  readonly redo?: readonly string[];
  /** The Python interpreter (default `CUTOUT_PYTHON`, then `python`). */
  readonly python?: string;
  /** List what would be cut, and stop. */
  readonly dryRun?: boolean;
  readonly runner?: CutoutRunner;
}

export interface CutoutResult {
  readonly candidates: number;
  readonly auto: number;
  readonly pending: number;
  readonly failed: number;
}

/** `cutouts/ab/cd/<sha256>.png`, the same shape as the photos' keys. */
export function cutoutKey(bytes: Uint8Array): string {
  const hash = createHash("sha256").update(bytes).digest("hex");
  return `${CUTOUT_PREFIX}/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.png`;
}

/** The environment the tool may see: enough to run Python and find its models. */
const PASSED_THROUGH = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "U2NET_HOME",
  "PYTHONPATH",
  "VIRTUAL_ENV",
  "LANG",
  "LC_ALL",
]);

export function cutoutEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const passed: NodeJS.ProcessEnv = { PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" };
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value !== "" && PASSED_THROUGH.has(name.toUpperCase())) {
      passed[name] = value;
    }
  }
  return passed;
}

/**
 * The file's own format, read from its first bytes as the sync reads a photo
 * (`sniffImageType`): `mime_type` was not recorded by early syncs, so a row
 * may not say. Null for anything the tool cannot read.
 */
export function photoExtension(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

/** Active photos with no settled cut-out, primary photos first. */
export async function loadCutoutCandidates(
  db: ImagesContext["db"],
  limit?: number,
): Promise<CutoutCandidate[]> {
  const rows = await db
    .select({
      hash: productImages.sourceContentHash,
      objectKey: productImages.objectKey,
      mimeType: productImages.mimeType,
      ordinal: sql<number>`min(${productImages.ordinal})`.mapWith(Number),
      attempts: sql<number>`coalesce(max(${imageCutouts.attempts}), 0)`.mapWith(Number),
    })
    .from(productImages)
    .leftJoin(imageCutouts, eq(imageCutouts.sourceContentHash, productImages.sourceContentHash))
    .where(
      and(
        eq(productImages.status, "active"),
        isNotNull(productImages.sourceContentHash),
        isNotNull(productImages.objectKey),
        or(
          isNull(imageCutouts.sourceContentHash),
          and(eq(imageCutouts.status, "failed"), lt(imageCutouts.attempts, CUTOUT_MAX_ATTEMPTS)),
        ),
      ),
    )
    .groupBy(productImages.sourceContentHash, productImages.objectKey, productImages.mimeType)
    .orderBy(asc(sql`min(${productImages.ordinal})`), asc(productImages.sourceContentHash));

  const candidates = rows
    .filter((row) => row.hash && row.objectKey)
    .map((row) => ({
      hash: row.hash!,
      objectKey: row.objectKey!,
      mimeType: row.mimeType,
      attempts: row.attempts,
    }));
  // One object per hash: two rows can name the same photo.
  const unique = [...new Map(candidates.map((c) => [c.hash, c])).values()];
  return limit !== undefined ? unique.slice(0, limit) : unique;
}

/** The active photos with these hashes, whatever their cut-out's state. */
export async function loadRedoCandidates(
  db: ImagesContext["db"],
  hashes: readonly string[],
): Promise<CutoutCandidate[]> {
  if (hashes.length === 0) return [];
  const rows = await db
    .select({
      hash: productImages.sourceContentHash,
      objectKey: productImages.objectKey,
      mimeType: productImages.mimeType,
      attempts: sql<number>`coalesce(max(${imageCutouts.attempts}), 0)`.mapWith(Number),
      // As text: a Date would drop the microseconds the write compares against.
      seen: sql<string | null>`max(${imageCutouts.updatedAt})::text`,
    })
    .from(productImages)
    .leftJoin(imageCutouts, eq(imageCutouts.sourceContentHash, productImages.sourceContentHash))
    .where(
      and(
        eq(productImages.status, "active"),
        inArray(productImages.sourceContentHash, [...hashes]),
        isNotNull(productImages.objectKey),
      ),
    )
    .groupBy(productImages.sourceContentHash, productImages.objectKey, productImages.mimeType);
  const candidates = rows.map((row) => ({
    hash: row.hash!,
    objectKey: row.objectKey!,
    mimeType: row.mimeType,
    attempts: row.attempts,
    seen: row.seen,
  }));
  return [...new Map(candidates.map((c) => [c.hash, c])).values()];
}

const spawnRunner: CutoutRunner = ({ python, tool, inDir, outDir, env, onLine }) =>
  new Promise((resolve, reject) => {
    const child = spawn(python, [tool, inDir, outDir], { env, stdio: ["ignore", "pipe", "pipe"] });
    createInterface({ input: child.stdout }).on("line", onLine);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && stderr) onLine(`stderr: ${stderr}`);
      resolve(code ?? 1);
    });
  });

export async function commandCutout(
  ctx: ImagesContext,
  options: CutoutOptions = {},
): Promise<CutoutResult> {
  const { db, storage, logger } = ctx;
  const redo = options.redo !== undefined;
  const candidates = redo
    ? await loadRedoCandidates(db, options.redo!)
    : await loadCutoutCandidates(db, options.limit);
  if (redo) {
    const found = new Set(candidates.map((c) => c.hash));
    const unknown = options.redo!.filter((hash) => !found.has(hash));
    if (unknown.length > 0) logger.warn("cutout.redo_unknown", { hashes: unknown });
  }
  logger.info("cutout.candidates", {
    count: candidates.length,
    redo,
    dryRun: options.dryRun ?? false,
  });
  if (candidates.length === 0 || options.dryRun) {
    return { candidates: candidates.length, auto: 0, pending: 0, failed: 0 };
  }

  const work = await mkdtemp(path.join(tmpdir(), "cutout-"));
  const inDir = path.join(work, "in");
  const outDir = path.join(work, "out");
  await mkdir(inDir);
  await mkdir(outDir);
  const counts = { auto: 0, pending: 0, failed: 0 };

  try {
    const missing = new Map<string, string>();
    for (const candidate of candidates) {
      const bytes = await storage.get(candidate.objectKey);
      if (!bytes) {
        missing.set(candidate.hash, `the photo ${candidate.objectKey} is not in the store`);
        continue;
      }
      const ext = photoExtension(bytes);
      if (!ext) {
        missing.set(candidate.hash, `the photo ${candidate.objectKey} is not a JPEG, PNG or WebP`);
        continue;
      }
      await writeFile(path.join(inDir, `${candidate.hash}.${ext}`), bytes);
    }

    const runner = options.runner ?? spawnRunner;
    const python = options.python ?? process.env.CUTOUT_PYTHON ?? "python";
    let done = 0;
    const code = await runner({
      python,
      tool: TOOL,
      inDir,
      outDir,
      env: cutoutEnvironment(process.env),
      onLine: (line) => {
        if (line.startsWith("{")) {
          done += 1;
          logger.info("cutout.progress", { done, of: candidates.length });
        } else if (line.trim()) {
          logger.warn("cutout.tool", { line: line.slice(0, 2000) });
        }
      },
    });

    let report: CutoutReport = {};
    try {
      report = JSON.parse(await readFile(path.join(outDir, "report.json"), "utf8")) as CutoutReport;
    } catch {
      logger.error("cutout.no_report", { exitCode: code });
    }

    for (const candidate of candidates) {
      const entry = report[candidate.hash];
      const error =
        missing.get(candidate.hash) ??
        entry?.error ??
        (entry?.file ? undefined : `the tool made nothing (exit ${code})`);
      if (error) {
        counts.failed += 1;
        if (redo) logger.warn("cutout.redo_failed", { hash: candidate.hash, error });
        else await recordFailure(db, candidate, error);
        continue;
      }
      const bytes = new Uint8Array(await readFile(path.join(outDir, entry!.file!)));
      const key = cutoutKey(bytes);
      await storage.put({
        key,
        body: bytes,
        contentType: "image/png",
        // Content-addressed keys are immutable, so they can be cached forever.
        cacheControl: "public, max-age=31536000, immutable",
      });
      const status = entry!.status === "auto" && !redo ? "auto" : "pending";
      const written = await recordCutout(
        db,
        candidate,
        key,
        bytes.byteLength,
        entry!,
        status,
        redo,
      );
      if (written || !redo) {
        counts[status] += 1;
      } else {
        counts.failed += 1;
        logger.warn("cutout.redo_skipped", { hash: candidate.hash, reason: "changed meanwhile" });
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  logger.info("cutout.done", { candidates: candidates.length, ...counts });
  return { candidates: candidates.length, ...counts };
}

/**
 * Insert, or update a row that last failed — never one that was settled. A
 * redo updates the row it read, settled or not, but only as it was read.
 * Answers whether it wrote.
 */
async function upsert(
  db: ImagesContext["db"],
  values: typeof imageCutouts.$inferInsert,
  redo?: { seen: string | null | undefined },
): Promise<boolean> {
  const { sourceContentHash: _hash, createdAt: _created, ...set } = values;
  const written = await db
    .insert(imageCutouts)
    .values(values)
    .onConflictDoUpdate({
      target: imageCutouts.sourceContentHash,
      set: { ...set, updatedAt: sql`now()` },
      setWhere: redo?.seen
        ? sql`${imageCutouts.updatedAt}::text = ${redo.seen}`
        : eq(imageCutouts.status, "failed"),
    })
    .returning({ hash: imageCutouts.sourceContentHash });
  return written.length > 0;
}

async function recordCutout(
  db: ImagesContext["db"],
  candidate: CutoutCandidate,
  objectKey: string,
  byteSize: number,
  entry: CutoutReportEntry,
  status: "auto" | "pending",
  redo: boolean,
): Promise<boolean> {
  return upsert(
    db,
    {
      sourceContentHash: candidate.hash,
      objectKey,
      width: entry.width ?? null,
      height: entry.height ?? null,
      byteSize,
      agreement: entry.agreement ?? null,
      shape: entry.shape ?? null,
      status,
      madeBy: `tools/cutout${entry.version ? ` v${entry.version}` : ""} ${(entry.models ?? []).join("+")}`,
      attempts: candidate.attempts + 1,
      lastError: null,
      ...(redo ? { decidedBy: null, decidedAt: null } : {}),
    },
    redo ? { seen: candidate.seen } : undefined,
  );
}

async function recordFailure(
  db: ImagesContext["db"],
  candidate: CutoutCandidate,
  error: string,
): Promise<void> {
  await upsert(db, {
    sourceContentHash: candidate.hash,
    status: "failed",
    attempts: candidate.attempts + 1,
    lastError: error.slice(0, 2000),
  });
}
