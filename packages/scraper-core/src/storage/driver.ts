import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveFromWorkspaceRoot } from "../reference/paths.ts";

/**
 * Object storage abstraction.
 *
 * Three drivers: `local` for development and tests (so nothing about running
 * this project locally requires a cloud account), `s3`, and `vercel-blob` for
 * a deployment hosted on Vercel. Remote SDKs are imported lazily so the local
 * path does not pay for them.
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
  readonly kind: "local" | "s3" | "vercel-blob";
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
    // Resolved outside the try: an unsafe key is a caller bug, not "absent".
    const target = this.resolve(key);
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const target = this.resolve(key);
    try {
      return await readFile(target);
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
    const fullKey = this.fullKey(key);
    await this.ensureClient();
    try {
      await this.client!.send(
        new this.commands!.HeadObjectCommand({ Bucket: this.bucket, Key: fullKey }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const fullKey = this.fullKey(key);
    await this.ensureClient();
    try {
      const result = (await this.client!.send(
        new this.commands!.GetObjectCommand({ Bucket: this.bucket, Key: fullKey }),
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

/**
 * The subset of the Vercel Blob SDK this driver uses, with "not found"
 * already turned into `null`. Injectable so the driver is tested without a
 * network and without the SDK.
 */
export interface BlobClientLike {
  put(
    pathname: string,
    body: Buffer,
    options: { contentType?: string; cacheControlMaxAge?: number },
  ): Promise<void>;
  head(pathname: string): Promise<{ size: number } | null>;
  get(pathname: string): Promise<Uint8Array | null>;
  del(pathname: string): Promise<void>;
}

/** `max-age` of a Cache-Control value in seconds, if it has one. */
function maxAgeSeconds(cacheControl: string | undefined): number | undefined {
  const match = /max-age=(\d+)/i.exec(cacheControl ?? "");
  return match ? Number.parseInt(match[1] as string, 10) : undefined;
}

/**
 * Real client over `@vercel/blob`, loaded on first use.
 *
 * Every write passes `addRandomSuffix: false` so the object name is exactly
 * our content-addressed key, and `allowOverwrite: true` so writing the same
 * key again (same bytes, by construction) is not an error. Objects are
 * `public`: they are product photos served from the store's own origin.
 */
export async function createVercelBlobClient(token: string): Promise<BlobClientLike> {
  const sdk = await import("@vercel/blob");
  return {
    async put(pathname, body, options) {
      await sdk.put(pathname, body, {
        access: "public",
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        ...(options.contentType ? { contentType: options.contentType } : {}),
        ...(options.cacheControlMaxAge !== undefined
          ? { cacheControlMaxAge: options.cacheControlMaxAge }
          : {}),
      });
    },
    async head(pathname) {
      try {
        const result = await sdk.head(pathname, { token });
        return { size: result.size };
      } catch (error) {
        if (error instanceof sdk.BlobNotFoundError) return null;
        throw error;
      }
    },
    async get(pathname) {
      const result = await sdk.get(pathname, { access: "public", token, useCache: false });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async del(pathname) {
      await sdk.del(pathname, { token });
    },
  };
}

export class VercelBlobStorageDriver implements StorageDriver {
  readonly kind = "vercel-blob" as const;
  private client: BlobClientLike | null;

  constructor(
    private readonly token: string,
    private readonly publicBaseUrl: string,
    client: BlobClientLike | null = null,
  ) {
    this.client = client;
  }

  /** Loaded on demand so local development never needs the Blob SDK. */
  private async ensureClient(): Promise<BlobClientLike> {
    this.client ??= await createVercelBlobClient(this.token);
    return this.client;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    assertSafeKey(input.key);
    const client = await this.ensureClient();
    const body =
      typeof input.body === "string" ? Buffer.from(input.body, "utf8") : Buffer.from(input.body);
    const maxAge = maxAgeSeconds(input.cacheControl);
    await client.put(input.key, body, {
      ...(input.contentType ? { contentType: input.contentType } : {}),
      // The store's minimum is one minute.
      ...(maxAge !== undefined ? { cacheControlMaxAge: Math.max(60, maxAge) } : {}),
    });
    return { key: input.key, size: body.byteLength, url: this.urlFor(input.key) };
  }

  /**
   * Unlike the S3 driver this does not turn every failure into "absent":
   * a bad token or an outage must not look like a missing image, or
   * `images:push` would try to re-upload everything and `images:verify`
   * would report the wrong problem.
   */
  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    return (await (await this.ensureClient()).head(key)) !== null;
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeKey(key);
    return (await this.ensureClient()).get(key);
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await (await this.ensureClient()).del(key);
  }

  urlFor(key: string): string {
    assertSafeKey(key);
    return joinUrl(this.publicBaseUrl, key);
  }
}

export interface StorageConfigLike {
  readonly storageDriver: "local" | "s3" | "vercel-blob";
  readonly blobToken?: string;
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
export function createStorageDriver(
  config: StorageConfigLike,
  deps: { readonly blobClient?: BlobClientLike } = {},
): StorageDriver {
  if (config.storageDriver === "vercel-blob") {
    if (!config.blobToken) {
      throw new Error("STORAGE_DRIVER=vercel-blob requires BLOB_READ_WRITE_TOKEN to be set.");
    }
    if (!config.storagePublicBaseUrl) {
      throw new Error(
        "STORAGE_DRIVER=vercel-blob requires STORAGE_PUBLIC_BASE_URL to be set " +
          "(the store's public origin, e.g. https://<store-id>.public.blob.vercel-storage.com).",
      );
    }
    return new VercelBlobStorageDriver(
      config.blobToken,
      config.storagePublicBaseUrl,
      deps.blobClient ?? null,
    );
  }
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
