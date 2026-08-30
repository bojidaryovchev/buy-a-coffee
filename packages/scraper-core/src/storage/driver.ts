import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveFromWorkspaceRoot } from "../reference/paths.ts";

/**
 * Object storage abstraction.
 *
 * Two drivers: `local` for development and tests (so nothing about running
 * this project locally requires an AWS account), and `s3` for production.
 * The S3 client is imported lazily so the local path does not pay for the SDK.
 */

export interface PutObjectInput {
  readonly key: string;
  readonly body: Uint8Array | string;
  readonly contentType?: string;
  readonly cacheControl?: string;
  readonly metadata?: Record<string, string>;
}

export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly url: string | null;
}

export interface StorageDriver {
  readonly kind: "local" | "s3";
  put(input: PutObjectInput): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** Public/CDN URL for a key, when one is configured. */
  urlFor(key: string): string | null;
}

function joinUrl(base: string, key: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedKey = key.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedKey}`;
}

/** Reject keys that could escape the storage root. */
export function assertSafeKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\")) {
    throw new Error(`Unsafe object key: ${JSON.stringify(key)}`);
  }
}

export class LocalStorageDriver implements StorageDriver {
  readonly kind = "local" as const;

  constructor(
    private readonly rootDir: string,
    private readonly publicBaseUrl: string | null = null,
  ) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    return path.join(this.rootDir, key);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const target = this.resolve(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    const body =
      typeof input.body === "string" ? Buffer.from(input.body, "utf8") : Buffer.from(input.body);
    await writeFile(target, body);
    return { key: input.key, size: body.byteLength, url: this.urlFor(input.key) };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.resolve(key));
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /**
   * Returns null when no public base URL is configured.
   *
   * Returning a `file://` path instead would be worse than useless: it would
   * be stored as the product's public image URL and then need unpicking by
   * whatever renders it. A null says plainly "there is no public URL", and the
   * consumer falls back to the object key.
   */
  urlFor(key: string): string | null {
    assertSafeKey(key);
    return this.publicBaseUrl ? joinUrl(this.publicBaseUrl, key) : null;
  }
}

interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

export class S3StorageDriver implements StorageDriver {
  readonly kind = "s3" as const;
  private client: S3ClientLike | null = null;
  private commands: {
    PutObjectCommand: new (input: Record<string, unknown>) => unknown;
    HeadObjectCommand: new (input: Record<string, unknown>) => unknown;
    GetObjectCommand: new (input: Record<string, unknown>) => unknown;
    DeleteObjectCommand: new (input: Record<string, unknown>) => unknown;
  } | null = null;

  constructor(
    private readonly bucket: string,
    private readonly region: string,
    private readonly publicBaseUrl: string | null = null,
    private readonly prefix: string = "",
  ) {}

  /** Loaded on demand so local development never needs the AWS SDK. */
  private async ensureClient(): Promise<void> {
    if (this.client && this.commands) return;
    const sdk = (await import("@aws-sdk/client-s3")) as unknown as {
      S3Client: new (config: Record<string, unknown>) => S3ClientLike;
      PutObjectCommand: new (input: Record<string, unknown>) => unknown;
      HeadObjectCommand: new (input: Record<string, unknown>) => unknown;
      GetObjectCommand: new (input: Record<string, unknown>) => unknown;
      DeleteObjectCommand: new (input: Record<string, unknown>) => unknown;
    };
    this.client = new sdk.S3Client({ region: this.region });
    this.commands = {
      PutObjectCommand: sdk.PutObjectCommand,
      HeadObjectCommand: sdk.HeadObjectCommand,
      GetObjectCommand: sdk.GetObjectCommand,
      DeleteObjectCommand: sdk.DeleteObjectCommand,
    };
  }

  private fullKey(key: string): string {
    assertSafeKey(key);
    return this.prefix ? `${this.prefix.replace(/\/+$/, "")}/${key}` : key;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    await this.ensureClient();
    const body =
      typeof input.body === "string" ? Buffer.from(input.body, "utf8") : Buffer.from(input.body);
    await this.client!.send(
      new this.commands!.PutObjectCommand({
        Bucket: this.bucket,
        Key: this.fullKey(input.key),
        Body: body,
        ...(input.contentType ? { ContentType: input.contentType } : {}),
        ...(input.cacheControl ? { CacheControl: input.cacheControl } : {}),
        ...(input.metadata ? { Metadata: input.metadata } : {}),
      }),
    );
    return { key: input.key, size: body.byteLength, url: this.urlFor(input.key) };
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureClient();
    try {
      await this.client!.send(
        new this.commands!.HeadObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    await this.ensureClient();
    try {
      const result = (await this.client!.send(
        new this.commands!.GetObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
      )) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } };
      const bytes = await result.Body?.transformToByteArray?.();
      return bytes ?? null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.ensureClient();
    await this.client!.send(
      new this.commands!.DeleteObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }),
    );
  }

  urlFor(key: string): string | null {
    const full = this.fullKey(key);
    if (this.publicBaseUrl) return joinUrl(this.publicBaseUrl, full);
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${full}`;
  }
}

export interface StorageConfigLike {
  readonly storageDriver: "local" | "s3";
  readonly storageLocalDir: string;
  readonly storagePublicBaseUrl: string;
  readonly s3Bucket: string;
  readonly s3Region: string;
  readonly s3Prefix: string;
}

/**
 * Build the configured storage driver.
 *
 * The local directory is resolved against the workspace root, not the current
 * working directory. Without that, `pnpm --filter @catalog/scraper sync` writes
 * images into `apps/scraper/.storage` while the web app looks for them at the
 * repository root, and every image 404s with nothing obviously wrong.
 */
export function createStorageDriver(config: StorageConfigLike): StorageDriver {
  if (config.storageDriver === "s3") {
    return new S3StorageDriver(
      config.s3Bucket,
      config.s3Region,
      config.storagePublicBaseUrl || null,
      config.s3Prefix,
    );
  }
  return new LocalStorageDriver(
    resolveFromWorkspaceRoot(config.storageLocalDir),
    config.storagePublicBaseUrl || null,
  );
}

/** Content hash used for image de-duplication and deterministic keys. */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
