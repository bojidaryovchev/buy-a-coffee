import type { BlobClientLike } from "../../src/storage/driver.ts";

type PutOptions = { contentType?: string; cacheControlMaxAge?: number };

/** In-memory stand-in for the Blob SDK adapter; records what it was asked. */
export class FakeBlobClient implements BlobClientLike {
  readonly objects = new Map<string, Buffer>();
  readonly putCalls: { pathname: string; options: PutOptions }[] = [];
  failWith: Error | null = null;

  async put(pathname: string, body: Buffer, options: PutOptions): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.putCalls.push({ pathname, options });
    this.objects.set(pathname, Buffer.from(body));
  }

  async head(pathname: string): Promise<{ size: number } | null> {
    if (this.failWith) throw this.failWith;
    const found = this.objects.get(pathname);
    return found ? { size: found.byteLength } : null;
  }

  async get(pathname: string): Promise<Uint8Array | null> {
    if (this.failWith) throw this.failWith;
    const found = this.objects.get(pathname);
    return found ? new Uint8Array(found) : null;
  }

  async del(pathname: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.objects.delete(pathname);
  }
}
