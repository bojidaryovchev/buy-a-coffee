import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";

/**
 * Local media serving for development.
 *
 * The default storage driver writes mirrored images to disk so the project
 * runs with no AWS account. This route serves them back.
 *
 * In production images come from S3 or a CDN via `NEXT_PUBLIC_IMAGE_BASE_URL`,
 * and this route refuses to serve anything at all — a public file-reading
 * endpoint has no business existing on a production deployment.
 */

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  if (process.env.NEXT_PUBLIC_IMAGE_BASE_URL) {
    return new Response("Not found", { status: 404 });
  }

  const { key } = await context.params;
  // turbopackIgnore keeps this dynamic path out of the build trace; without
  // it the bundler pulls the entire project into the server output.
  const storageRoot = path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_LOCAL_DIR ?? ".storage");

  /*
   * Path traversal guard. The joined path is resolved and then checked to be
   * inside the storage root, so `../../etc/passwd` cannot escape however it is
   * encoded.
   */
  const requested = path.resolve(storageRoot, ...key);
  const relative = path.relative(storageRoot, requested);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return new Response("Forbidden", { status: 403 });
  }

  const extension = path.extname(requested).toLowerCase();
  const contentType = MIME_TYPES[extension];
  if (!contentType) return new Response("Unsupported media type", { status: 415 });

  let size: number;
  try {
    const stats = statSync(requested);
    if (!stats.isFile()) return new Response("Not found", { status: 404 });
    size = stats.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(requested)) as unknown as ReadableStream;

  return new Response(stream, {
    headers: {
      "content-type": contentType,
      "content-length": String(size),
      // Object keys are content-addressed, so the bytes never change.
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
