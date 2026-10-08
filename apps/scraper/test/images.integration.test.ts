import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@catalog/db";
import { productImages, products, sourceSites } from "@catalog/db/schema";
import { silentLogger } from "@catalog/shared";
import { LocalStorageDriver, buildImageKey, loadConfig } from "@catalog/scraper-core";
import {
  type ImagesContext,
  commandImagesPush,
  commandImagesVerify,
  ImagesUsageError,
} from "../src/commands-images.ts";
/*
 * Its own database: the sync integration suite truncates every catalog table,
 * and Vitest runs test files in parallel. The helper reads the name when it is
 * first imported, so it is set before that import.
 */
process.env.TEST_DATABASE_NAME = `${process.env.TEST_DATABASE_NAME ?? "catalog_test"}_images`.slice(
  0,
  60,
);
const { isDatabaseAvailable, resetTestDatabase, setupTestDatabase } =
  await import("../../../packages/scraper-core/test/helpers/testDb.ts");

/**
 * images:push and images:verify against two local directories and rows seeded
 * into a real database. Nothing leaves the machine.
 */

const available = await isDatabaseAvailable();
const describeIntegration = available ? describe : describe.skip;

const PNG = (seed: string): Buffer =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(seed)]);

function keyFor(bytes: Buffer): string {
  return buildImageKey(createHash("sha256").update(bytes).digest("hex"), "image/png");
}

describeIntegration("images:push and images:verify", () => {
  let db: Database;
  let closeDb: () => Promise<void>;
  let root: string;
  let from: LocalStorageDriver;
  let to: LocalStorageDriver;
  let runtime: ImagesContext;
  let productSeq = 0;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    closeDb = setup.close;
    root = await mkdtemp(path.join(tmpdir(), "images-cmd-"));
  }, 120_000);

  afterAll(async () => {
    await closeDb?.();
    if (root) await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTestDatabase(db);
    await rm(path.join(root, "from"), { recursive: true, force: true });
    await rm(path.join(root, "to"), { recursive: true, force: true });
    from = new LocalStorageDriver(path.join(root, "from"), "http://from.test/media");
    to = new LocalStorageDriver(path.join(root, "to"), "http://to.test/media");
    runtime = {
      db,
      logger: silentLogger,
      config: loadConfig({}, { STORAGE_PUBLIC_BASE_URL: "http://to.test/media" }),
      storage: to,
    };
  });

  /** Seed one product with one image row. */
  async function seedImage(
    key: string | null,
    status: "active" | "orphaned" | "failed" = "active",
  ): Promise<void> {
    productSeq += 1;
    const [site] = await db
      .insert(sourceSites)
      .values({ key: "src", name: "Src", baseUrl: "https://src.test", canonicalHost: "src.test" })
      .onConflictDoNothing()
      .returning();
    const siteId =
      site?.id ??
      (await db.query.sourceSites.findFirst({ where: (t, { eq }) => eq(t.key, "src") }))!.id;
    const [product] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceKey: `p${productSeq}`,
        sourceUrl: `https://src.test/p${productSeq}`,
        sourcePath: `/p${productSeq}`,
        name: `Product ${productSeq}`,
        slug: `product-${productSeq}`,
        semanticHash: `hash-${productSeq}`,
      })
      .returning();
    await db.insert(productImages).values({
      productId: product!.id,
      sourceUrl: `https://src.test/img${productSeq}.png`,
      objectKey: key,
      mimeType: key ? "image/png" : null,
      status,
    });
  }

  async function seedObject(store: LocalStorageDriver, bytes: Buffer): Promise<string> {
    const key = keyFor(bytes);
    await store.put({ key, body: bytes, contentType: "image/png" });
    return key;
  }

  it("a plan reports what it would copy and copies nothing", async () => {
    const a = await seedObject(from, PNG("a"));
    await seedImage(a);

    const result = await commandImagesPush(runtime, {
      from: "local",
      to: "local",
      source: from,
      target: to,
    });

    expect(result).toMatchObject({
      applied: false,
      referenced: 1,
      copied: 0,
      toCopy: 1,
      skipped: 0,
    });
    expect(result.failed).toEqual([]);
    expect(await to.exists(a)).toBe(false);
  });

  it("--apply copies, a second run skips, and only active rows are referenced", async () => {
    const a = await seedObject(from, PNG("a"));
    const b = await seedObject(from, PNG("b"));
    const gone = await seedObject(from, PNG("orphan"));
    await seedImage(a);
    await seedImage(b);
    await seedImage(a); // shared photo: one object, two rows
    await seedImage(gone, "orphaned");

    const first = await commandImagesPush(runtime, {
      from: "local",
      to: "local",
      source: from,
      target: to,
      apply: true,
    });
    expect(first).toMatchObject({ applied: true, referenced: 2, copied: 2, skipped: 0 });
    expect(await to.exists(a)).toBe(true);
    expect(await to.exists(b)).toBe(true);
    expect(await to.exists(gone)).toBe(false);
    expect(Buffer.from((await to.get(a))!).equals(PNG("a"))).toBe(true);

    const second = await commandImagesPush(runtime, {
      from: "local",
      to: "local",
      source: from,
      target: to,
      apply: true,
    });
    expect(second).toMatchObject({ copied: 0, skipped: 2 });
    expect(second.failed).toEqual([]);
  });

  it("reports an object missing from the source as failed, in a plan and in an apply", async () => {
    const present = await seedObject(from, PNG("present"));
    const missing = keyFor(PNG("never stored"));
    await seedImage(present);
    await seedImage(missing);

    for (const apply of [false, true]) {
      const result = await commandImagesPush(runtime, {
        from: "local",
        to: "local",
        source: from,
        target: to,
        apply,
      });
      expect(result.failed).toEqual([{ key: missing, error: "missing in source store" }]);
    }
    expect(await to.exists(present)).toBe(true);
  });

  it("refuses to copy bytes that do not match the hash in the key", async () => {
    const key = keyFor(PNG("claimed"));
    await from.put({ key, body: PNG("different") });
    await seedImage(key);

    const result = await commandImagesPush(runtime, {
      from: "local",
      to: "local",
      source: from,
      target: to,
      apply: true,
    });
    expect(result.copied).toBe(0);
    expect(result.failed[0]?.error).toMatch(/content hash/);
    expect(await to.exists(key)).toBe(false);
  });

  it("resolves drivers by name and rejects an unknown or identical pair", async () => {
    const a = await seedObject(from, PNG("a"));
    await seedImage(a);

    const result = await commandImagesPush(runtime, {
      from: "local",
      to: "local",
      fromDir: path.join(root, "from"),
      toDir: path.join(root, "to"),
      apply: true,
    });
    expect(result.copied).toBe(1);
    expect(await to.exists(a)).toBe(true);

    await expect(commandImagesPush(runtime, { from: "nope", to: "local" })).rejects.toBeInstanceOf(
      ImagesUsageError,
    );
    await expect(commandImagesPush(runtime, { from: "s3", to: "s3" })).rejects.toThrow(
      /same store/,
    );
    // A remote destination that is not configured fails with what to set.
    await expect(commandImagesPush(runtime, { from: "local", to: "vercel-blob" })).rejects.toThrow(
      /BLOB_READ_WRITE_TOKEN/,
    );
  });

  describe("verify", () => {
    it("passes when every active object is present", async () => {
      const a = await seedObject(to, PNG("a"));
      await seedImage(a);
      await seedImage(keyFor(PNG("orphan only")), "orphaned");
      const result = await commandImagesVerify(runtime);
      expect(result).toEqual({ checked: 1, httpChecked: false, failures: [] });
    });

    it("lists missing objects and rows without a key", async () => {
      const present = await seedObject(to, PNG("a"));
      const missing = keyFor(PNG("missing"));
      await seedImage(present);
      await seedImage(missing);
      await seedImage(null);

      const result = await commandImagesVerify(runtime);
      expect(result.failures).toEqual(
        expect.arrayContaining([
          { key: missing, problem: "object missing from the store", rows: 1 },
          { key: null, problem: "active image row has no object key", rows: 1 },
        ]),
      );
      expect(result.failures).toHaveLength(2);
    });

    it("--http checks status and image content type of the public URL", async () => {
      const good = await seedObject(to, PNG("good"));
      const notFound = await seedObject(to, PNG("404"));
      const html = await seedObject(to, PNG("html"));
      for (const key of [good, notFound, html]) await seedImage(key);

      const fetchImpl = (async (url: string) => {
        if (url.endsWith(notFound)) return new Response("no", { status: 404 });
        if (url.endsWith(html)) {
          return new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response(PNG("x"), { status: 200, headers: { "content-type": "image/png" } });
      }) as unknown as typeof fetch;

      const result = await commandImagesVerify(runtime, { http: true, fetchImpl });
      expect(result.httpChecked).toBe(true);
      expect(result.failures.map((f) => f.key).sort()).toEqual([html, notFound].sort());
      expect(result.failures.find((f) => f.key === notFound)?.problem).toMatch(/answered 404/);
      expect(result.failures.find((f) => f.key === html)?.problem).toMatch(/text\/html/);
    });

    it("--http without a public base URL is a usage error", async () => {
      const noBase = { ...runtime, config: loadConfig({}, {}) };
      await expect(commandImagesVerify(noBase, { http: true })).rejects.toBeInstanceOf(
        ImagesUsageError,
      );
    });
  });
});
