import { type Logger, mapWithConcurrency, silentLogger, sleep } from "@catalog/shared";
import type { ScraperConfig } from "../config.ts";
import { type StorageDriver, contentHash } from "./driver.ts";

/**
 * Product image mirroring.
 *
 * The storefront must never hotlink the source's images, so every image is
 * copied into our own object storage under a content-addressed key.
 *
 * Content addressing gives de-duplication for free: two products sharing a
 * photo store one object, and an unchanged image is never downloaded twice
 * because the key already exists.
 */

const ALLOWED_MIME_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/** Magic-byte sniffing: never trust a `content-type` header alone. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  // ISO-BMFF `ftyp` box with an AVIF brand.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = Buffer.from(b.subarray(8, 12)).toString("ascii");
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  const head = Buffer.from(b.subarray(0, 256)).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return null;
}

export function extensionFor(mimeType: string): string {
  return ALLOWED_MIME_TYPES[mimeType.toLowerCase()] ?? "bin";
}

/**
 * Deterministic, content-addressed object key.
 *
 * Keyed purely by content, so re-uploading the same bytes is a no-op and two
 * products sharing an image share one object.
 *
 * The source site's name is deliberately **not** part of the path. These keys
 * become public image URLs on the storefront, and a path segment naming the
 * site we mirror would put its brand in front of every customer. Content
 * addressing is globally unique on its own, and the database already records
 * which source each product came from.
 */
export function buildImageKey(hash: string, mimeType: string): string {
  const ext = extensionFor(mimeType);
  // Two-level fan-out keeps any single storage prefix from growing unbounded.
  return `catalog/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.${ext}`;
}

export interface ImageMirrorRequest {
  readonly productKey: string;
  readonly sourceUrl: string;
  readonly ordinal: number;
  readonly alt: string | null;
  /** Content hash already stored for this source URL, if any. */
  readonly knownContentHash?: string | null;
  readonly knownObjectKey?: string | null;
}

export type ImageMirrorOutcome = "mirrored" | "skipped_unchanged" | "skipped_deduplicated" | "failed";

export interface ImageMirrorResult {
  readonly request: ImageMirrorRequest;
  readonly outcome: ImageMirrorOutcome;
  readonly objectKey: string | null;
  readonly publicUrl: string | null;
  readonly contentHash: string | null;
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  readonly error: string | null;
}

export interface ImageMirrorOptions {
  readonly config: ScraperConfig;
  readonly storage: StorageDriver;
  readonly logger?: Logger;
  readonly fetchImpl?: typeof fetch;
}

export class ImageMirror {
  private readonly config: ScraperConfig;
  private readonly storage: StorageDriver;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  /** Hashes already confirmed present in storage during this run. */
  private readonly seenHashes = new Set<string>();
  /** Shared pacing gate: image downloads must be as polite as page fetches. */
  private nextSlotAt = 0;

  constructor(options: ImageMirrorOptions) {
    this.config = options.config;
    this.storage = options.storage;
    this.logger = options.logger ?? silentLogger;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async mirrorAll(requests: readonly ImageMirrorRequest[]): Promise<ImageMirrorResult[]> {
    const settled = await mapWithConcurrency(
      requests,
      this.config.imageConcurrency,
      async (request) => this.mirrorOne(request),
    );
    return settled.map((entry, index) =>
      entry.ok
        ? entry.value
        : {
            request: requests[index] as ImageMirrorRequest,
            outcome: "failed" as const,
            objectKey: null,
            publicUrl: null,
            contentHash: null,
            mimeType: null,
            byteSize: null,
            error: entry.error instanceof Error ? entry.error.message : String(entry.error),
          },
    );
  }

  /** Space image downloads apart, mirroring the page fetcher's pacing. */
  private async waitForSlot(): Promise<void> {
    const spacing = this.config.imageMinDelayMs;
    if (spacing <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + spacing;
    if (slot > now) await sleep(slot - now);
  }

  async mirrorOne(request: ImageMirrorRequest): Promise<ImageMirrorResult> {
    const fail = (error: string): ImageMirrorResult => ({
      request,
      outcome: "failed",
      objectKey: null,
      publicUrl: null,
      contentHash: null,
      mimeType: null,
      byteSize: null,
      error,
    });

    // Already mirrored and unchanged: do not download it again.
    if (request.knownContentHash && request.knownObjectKey) {
      if (this.seenHashes.has(request.knownContentHash)) {
        return {
          request,
          outcome: "skipped_unchanged",
          objectKey: request.knownObjectKey,
          publicUrl: this.storage.urlFor(request.knownObjectKey),
          contentHash: request.knownContentHash,
          mimeType: null,
          byteSize: null,
          error: null,
        };
      }
      if (await this.storage.exists(request.knownObjectKey)) {
        this.seenHashes.add(request.knownContentHash);
        return {
          request,
          outcome: "skipped_unchanged",
          objectKey: request.knownObjectKey,
          publicUrl: this.storage.urlFor(request.knownObjectKey),
          contentHash: request.knownContentHash,
          mimeType: null,
          byteSize: null,
          error: null,
        };
      }
    }

    await this.waitForSlot();

    let bytes: Uint8Array;
    let headerType: string | null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.imageTimeoutMs);
      try {
        const response = await this.fetchImpl(request.sourceUrl, {
          signal: controller.signal,
          headers: { "user-agent": this.config.userAgent, accept: "image/*" },
          redirect: "follow",
        });
        if (!response.ok) return fail(`HTTP ${response.status}`);

        const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
        if (Number.isFinite(declared) && declared > this.config.imageMaxBytes) {
          return fail(`declared size ${declared} exceeds limit`);
        }
        headerType = response.headers.get("content-type");
        const buffer = await response.arrayBuffer();
        bytes = new Uint8Array(buffer);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }

    if (bytes.byteLength === 0) return fail("empty response body");
    if (bytes.byteLength > this.config.imageMaxBytes) {
      return fail(`size ${bytes.byteLength} exceeds limit ${this.config.imageMaxBytes}`);
    }

    // The sniffed type wins: a mislabelled or hostile content-type must not
    // decide what we store or how it is later served.
    const sniffed = sniffImageType(bytes);
    const declaredType = headerType?.split(";")[0]?.trim().toLowerCase() ?? null;
    const mimeType = sniffed ?? (declaredType && ALLOWED_MIME_TYPES[declaredType] ? declaredType : null);
    if (!mimeType) return fail(`unrecognised image content (declared: ${declaredType ?? "none"})`);
    if (!ALLOWED_MIME_TYPES[mimeType]) return fail(`disallowed image type ${mimeType}`);

    const hash = contentHash(bytes);
    const objectKey = buildImageKey(hash, mimeType);

    if (this.seenHashes.has(hash) || (await this.storage.exists(objectKey))) {
      this.seenHashes.add(hash);
      return {
        request,
        outcome: "skipped_deduplicated",
        objectKey,
        publicUrl: this.storage.urlFor(objectKey),
        contentHash: hash,
        mimeType,
        byteSize: bytes.byteLength,
        error: null,
      };
    }

    await this.storage.put({
      key: objectKey,
      body: bytes,
      contentType: mimeType,
      // Content-addressed keys are immutable, so they can be cached forever.
      cacheControl: "public, max-age=31536000, immutable",
      metadata: { sourceSite: this.config.sourceKey },
    });
    this.seenHashes.add(hash);

    this.logger.debug("image.mirrored", {
      objectKey,
      bytes: bytes.byteLength,
      mimeType,
      productKey: request.productKey,
    });

    return {
      request,
      outcome: "mirrored",
      objectKey,
      publicUrl: this.storage.urlFor(objectKey),
      contentHash: hash,
      mimeType,
      byteSize: bytes.byteLength,
      error: null,
    };
  }
}
