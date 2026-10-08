import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { productImages } from "@catalog/db/schema";
import { mapWithConcurrency } from "@catalog/shared";
import { type StorageDriver, createStorageDriver } from "@catalog/scraper-core";
import type { Runtime } from "./runtime.ts";

/**
 * Image store maintenance: move objects between stores, and check that every
 * image the catalog references is really there.
 *
 * Both work from the active `product_images` rows. The object key is content
 * addressed, so a copy is idempotent by construction: an object that is
 * already present at the destination is the same bytes.
 */

export type ImagesContext = Pick<Runtime, "db" | "config" | "logger" | "storage">;

/** A mistake in how the command was invoked, not a failure of the work. */
export class ImagesUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagesUsageError";
  }
}

const DRIVER_KINDS = ["local", "s3", "vercel-blob"] as const;
type DriverKind = (typeof DRIVER_KINDS)[number];

function isDriverKind(value: string): value is DriverKind {
  return (DRIVER_KINDS as readonly string[]).includes(value);
}

interface ReferencedObject {
  readonly key: string;
  readonly mimeType: string | null;
  /** Active rows pointing at this key. */
  readonly rows: number;
}

/** Distinct object keys of active rows, plus the number of active rows with no key. */
async function loadReferenced(
  db: ImagesContext["db"],
): Promise<{ objects: ReferencedObject[]; withoutKey: number }> {
  const rows = await db
    .select({ objectKey: productImages.objectKey, mimeType: productImages.mimeType })
    .from(productImages)
    .where(eq(productImages.status, "active"));

  const byKey = new Map<string, { mimeType: string | null; rows: number }>();
  let withoutKey = 0;
  for (const row of rows) {
    if (!row.objectKey) {
      withoutKey += 1;
      continue;
    }
    const entry = byKey.get(row.objectKey);
    if (entry) {
      entry.rows += 1;
      entry.mimeType ??= row.mimeType;
    } else {
      byKey.set(row.objectKey, { mimeType: row.mimeType, rows: 1 });
    }
  }
  const objects = [...byKey.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { objects, withoutKey };
}

/**
 * The driver for a named kind. The runtime's own driver is reused when the
 * kind matches; otherwise one is built from the same configuration with only
 * the kind (and, for local, the directory) changed.
 */
function resolveDriver(
  runtime: ImagesContext,
  kind: string,
  localDir: string | undefined,
  flag: string,
): StorageDriver {
  if (!isDriverKind(kind)) {
    throw new ImagesUsageError(
      `${flag} must be one of: ${DRIVER_KINDS.join(", ")} (got "${kind}").`,
    );
  }
  if (kind === runtime.config.storageDriver && localDir === undefined) return runtime.storage;
  try {
    return createStorageDriver({
      ...runtime.config,
      storageDriver: kind,
      ...(localDir !== undefined ? { storageLocalDir: localDir } : {}),
    });
  } catch (error) {
    throw new ImagesUsageError(error instanceof Error ? error.message : String(error));
  }
}

// --- images:push ------------------------------------------------------------

export interface ImagesPushOptions {
  readonly from: string;
  readonly to: string;
  /** Local directory for a `local` source / destination (default: STORAGE_LOCAL_DIR). */
  readonly fromDir?: string;
  readonly toDir?: string;
  readonly apply?: boolean;
  /** Tests inject drivers directly. */
  readonly source?: StorageDriver;
  readonly target?: StorageDriver;
}

export interface ImagesPushResult {
  readonly applied: boolean;
  readonly referenced: number;
  /** Objects copied (with `apply`) -- always 0 in a plan. */
  readonly copied: number;
  /** Objects a plan would copy; equals `copied` after an apply. */
  readonly toCopy: number;
  readonly skipped: number;
  readonly failed: readonly { key: string; error: string }[];
  readonly activeRowsWithoutKey: number;
}

type PushOutcome =
  { kind: "skipped" } | { kind: "to-copy"; copied: boolean } | { kind: "failed"; error: string };

/** The 64-hex hash in a content-addressed key's file name, if it has one. */
function hashInKey(key: string): string | null {
  const match = /\/([0-9a-f]{64})\.[a-z0-9]+$/.exec(key);
  return match ? (match[1] as string) : null;
}

export async function commandImagesPush(
  runtime: ImagesContext,
  options: ImagesPushOptions,
): Promise<ImagesPushResult> {
  const source = options.source ?? resolveDriver(runtime, options.from, options.fromDir, "--from");
  const target = options.target ?? resolveDriver(runtime, options.to, options.toDir, "--to");
  if (!options.source && !options.target && options.from === options.to) {
    const sameLocal = options.from === "local" && options.fromDir === options.toDir;
    if (options.from !== "local" || sameLocal) {
      throw new ImagesUsageError("--from and --to name the same store; nothing to move.");
    }
  }

  const apply = options.apply === true;
  const { objects, withoutKey } = await loadReferenced(runtime.db);

  const settled = await mapWithConcurrency(
    objects,
    runtime.config.imageConcurrency,
    async (object): Promise<PushOutcome> => {
      if (await target.exists(object.key)) return { kind: "skipped" };

      // A plan still has to know whether the copy could succeed.
      if (!apply) {
        return (await source.exists(object.key))
          ? { kind: "to-copy", copied: false }
          : { kind: "failed", error: "missing in source store" };
      }

      const bytes = await source.get(object.key);
      if (!bytes) return { kind: "failed", error: "missing in source store" };

      // Keys are content hashes: refuse to spread a corrupted object.
      const expected = hashInKey(object.key);
      if (expected && createHash("sha256").update(bytes).digest("hex") !== expected) {
        return { kind: "failed", error: "source bytes do not match the content hash in the key" };
      }

      await target.put({
        key: object.key,
        body: bytes,
        ...(object.mimeType ? { contentType: object.mimeType } : {}),
        // Content-addressed keys are immutable, so they can be cached forever.
        cacheControl: "public, max-age=31536000, immutable",
      });
      return { kind: "to-copy", copied: true };
    },
  );

  let copied = 0;
  let toCopy = 0;
  let skipped = 0;
  const failed: { key: string; error: string }[] = [];
  settled.forEach((entry, index) => {
    const key = (objects[index] as ReferencedObject).key;
    if (!entry.ok) {
      failed.push({
        key,
        error: entry.error instanceof Error ? entry.error.message : String(entry.error),
      });
    } else if (entry.value.kind === "failed") {
      failed.push({ key, error: entry.value.error });
    } else if (entry.value.kind === "skipped") {
      skipped += 1;
    } else {
      toCopy += 1;
      if (entry.value.copied) copied += 1;
    }
  });

  runtime.logger.info(apply ? "images.push_applied" : "images.push_plan", {
    from: source.kind,
    to: target.kind,
    referenced: objects.length,
    copied,
    toCopy,
    skipped,
    failed: failed.length,
  });

  return {
    applied: apply,
    referenced: objects.length,
    copied,
    toCopy,
    skipped,
    failed,
    activeRowsWithoutKey: withoutKey,
  };
}

// --- images:verify ----------------------------------------------------------

export interface ImagesVerifyOptions {
  /** Also request each public URL. Needs STORAGE_PUBLIC_BASE_URL. */
  readonly http?: boolean;
  readonly fetchImpl?: typeof fetch;
}

export interface ImagesVerifyFailure {
  readonly key: string | null;
  readonly problem: string;
  /** Active rows affected. */
  readonly rows: number;
}

export interface ImagesVerifyResult {
  readonly checked: number;
  readonly httpChecked: boolean;
  readonly failures: readonly ImagesVerifyFailure[];
}

async function checkPublicUrl(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Only the status and headers matter; do not download the image.
    await response.body?.cancel();
    if (response.status !== 200) return `${url} answered ${response.status}`;
    const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (!type?.startsWith("image/")) return `${url} answered with content type "${type ?? ""}"`;
    return null;
  } catch (error) {
    return `${url} unreachable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function commandImagesVerify(
  runtime: ImagesContext,
  options: ImagesVerifyOptions = {},
): Promise<ImagesVerifyResult> {
  const { storage, config } = runtime;
  const http = options.http === true;
  if (http && !config.storagePublicBaseUrl) {
    throw new ImagesUsageError("--http needs STORAGE_PUBLIC_BASE_URL to be set.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  const { objects, withoutKey } = await loadReferenced(runtime.db);
  const failures: ImagesVerifyFailure[] = [];
  if (withoutKey > 0) {
    failures.push({ key: null, problem: "active image row has no object key", rows: withoutKey });
  }

  const settled = await mapWithConcurrency(
    objects,
    config.imageConcurrency,
    async (object): Promise<string | null> => {
      if (!(await storage.exists(object.key))) return "object missing from the store";
      if (!http) return null;
      const url = storage.urlFor(object.key);
      if (!url) return "no public URL for this key";
      return checkPublicUrl(url, fetchImpl, config.imageTimeoutMs);
    },
  );
  settled.forEach((entry, index) => {
    const object = objects[index] as ReferencedObject;
    const problem = entry.ok
      ? entry.value
      : `check failed: ${entry.error instanceof Error ? entry.error.message : String(entry.error)}`;
    if (problem) failures.push({ key: object.key, problem, rows: object.rows });
  });

  runtime.logger.info("images.verify", {
    checked: objects.length,
    http,
    failures: failures.length,
  });
  return { checked: objects.length, httpChecked: http, failures };
}

// --- CLI glue ---------------------------------------------------------------

const EXIT_OK = 0;
const EXIT_USAGE = 1;
/** The job ran but found problems: same meaning as the CLI's "untrusted". */
const EXIT_PROBLEMS = 2;

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function flagBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}

/** Runs `images:push` or `images:verify`, prints JSON, returns the exit code. */
export async function runImagesCommand(
  command: "images:push" | "images:verify",
  runtime: Runtime,
  flags: Record<string, string | boolean>,
): Promise<number> {
  try {
    if (command === "images:push") {
      const from = flagString(flags, "from");
      const to = flagString(flags, "to");
      if (!from || !to) {
        throw new ImagesUsageError("images:push needs --from <driver> and --to <driver>.");
      }
      const fromDir = flagString(flags, "from-dir");
      const toDir = flagString(flags, "to-dir");
      const result = await commandImagesPush(runtime, {
        from,
        to,
        ...(fromDir !== undefined ? { fromDir } : {}),
        ...(toDir !== undefined ? { toDir } : {}),
        apply: flagBool(flags, "apply"),
      });
      printJson({ command, ...result });
      return result.failed.length > 0 ? EXIT_PROBLEMS : EXIT_OK;
    }

    const result = await commandImagesVerify(runtime, { http: flagBool(flags, "http") });
    printJson({ command, ...result });
    return result.failures.length > 0 ? EXIT_PROBLEMS : EXIT_OK;
  } catch (error) {
    if (error instanceof ImagesUsageError) {
      process.stderr.write(`${error.message}\n`);
      return EXIT_USAGE;
    }
    throw error;
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
