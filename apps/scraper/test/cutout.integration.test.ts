import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { imageCutouts, productImages, products, sourceSites } from "@catalog/db/schema";
import { silentLogger } from "@catalog/shared";
import { LocalStorageDriver, loadConfig } from "@catalog/scraper-core";
import {
  CUTOUT_MAX_ATTEMPTS,
  type CutoutReport,
  type CutoutRunner,
  commandCutout,
  cutoutEnvironment,
  cutoutKey,
  loadCutoutCandidates,
  loadRedoCandidates,
  photoExtension,
} from "../src/commands-cutout.ts";
import type { ImagesContext } from "../src/commands-images.ts";
import { ModelAccountError, ModelError, type Segmenter } from "../src/cutout-model.ts";

process.env.TEST_DATABASE_NAME = `${process.env.TEST_DATABASE_NAME ?? "catalog_test"}_cutout`.slice(
  0,
  60,
);
const { isDatabaseAvailable, resetTestDatabase, setupTestDatabase } =
  await import("../../../packages/scraper-core/test/helpers/testDb.ts");

/**
 * images:cutout against a real database and a local store, with the model
 * and the Python tool replaced by stand-ins that answer as they would. What is
 * checked is this side's contract: which photos are sent where, what is
 * stored, what each row says, that a decided row is never touched, and that a
 * refused account spends nothing.
 */

const available = await isDatabaseAvailable();
const describeIntegration = available ? describe : describe.skip;

const JPEG = (seed: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(seed)]);
const PNG = (seed: string) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(seed)]);

/** A runner that cuts every photo it is given, as told by `outcome`. */
function fakeTool(
  outcome: (hash: string) => CutoutReport[string],
): CutoutRunner & { seen: string[]; modelled: string[]; envs: NodeJS.ProcessEnv[] } {
  const seen: string[] = [];
  const modelled: string[] = [];
  const envs: NodeJS.ProcessEnv[] = [];
  const runner = async ({ inDir, outDir, onLine, env }: Parameters<CutoutRunner>[0]) => {
    envs.push(env);
    const report: Record<string, CutoutReport[string]> = {};
    const files = await readdir(inDir);
    for (const file of files) {
      if (file.endsWith(".model.png")) continue;
      const hash = file.split(".")[0]!;
      seen.push(hash);
      if (files.includes(`${hash}.model.png`)) modelled.push(hash);
      const entry = outcome(hash);
      if (entry.file) await writeFile(path.join(outDir, entry.file), PNG(`cut-${hash}`));
      report[hash] = entry;
      onLine(JSON.stringify({ [hash]: entry }));
    }
    await writeFile(path.join(outDir, "report.json"), JSON.stringify(report));
    return 0;
  };
  return Object.assign(runner, { seen, modelled, envs });
}

/**
 * A model that cuts every photo it is sent, unless `fail` (told the address and
 * how many calls came before) says otherwise; remembers the addresses.
 */
function fakeModel(fail: (url: string, before: number) => Error | null = () => null) {
  const calls: string[] = [];
  const answered: string[] = [];
  const segment: Segmenter = async (url) => {
    const error = fail(url, calls.length);
    calls.push(url);
    if (error) throw error;
    answered.push(url);
    return new Uint8Array(PNG(`model-${url}`));
  };
  return { segment, calls, answered };
}

/** The photo key `seedPhoto` stores a hash under. */
const photoKey = (hash: string) => `catalog/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.jpg`;

const AUTO = (hash: string) => ({
  file: `${hash}.png`,
  width: 300,
  height: 500,
  shape: { holes: 0, dents: [], box: null, added: 0, reflection: false },
  status: "auto" as const,
  models: ["fal-ai/bria/background/remove"],
  version: 3,
});

describeIntegration("images:cutout", () => {
  let db: Database;
  let closeDb: () => Promise<void>;
  let root: string;
  let store: LocalStorageDriver;
  let runtime: ImagesContext;
  let model: ReturnType<typeof fakeModel>;
  let seq = 0;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    closeDb = setup.close;
    root = await mkdtemp(path.join(tmpdir(), "cutout-cmd-"));
  }, 120_000);

  afterAll(async () => {
    await closeDb?.();
    if (root) await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetTestDatabase(db);
    await rm(path.join(root, "store"), { recursive: true, force: true });
    store = new LocalStorageDriver(path.join(root, "store"), "https://store.test/media");
    runtime = {
      db,
      logger: silentLogger,
      config: loadConfig({}, { STORAGE_PUBLIC_BASE_URL: "https://store.test/media" }),
      storage: store,
    };
    model = fakeModel();
  });

  /** A product with one photo in the store; returns the photo's hash. */
  async function seedPhoto(
    options: { status?: "active" | "orphaned"; ordinal?: number; mimeType?: string | null } = {},
  ) {
    seq += 1;
    const hash = `${String(seq).padStart(2, "0")}${"a".repeat(62)}`;
    const key = `catalog/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.jpg`;
    await store.put({ key, body: JPEG(hash), contentType: "image/jpeg" });
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
        sourceKey: `p${seq}`,
        sourceUrl: `https://src.test/p${seq}`,
        sourcePath: `/p${seq}`,
        name: `Product ${seq}`,
        slug: `product-${seq}`,
        semanticHash: `hash-${seq}`,
      })
      .returning();
    await db.insert(productImages).values({
      productId: product!.id,
      sourceUrl: `https://src.test/img${seq}.jpg`,
      sourceContentHash: hash,
      objectKey: key,
      // Early syncs recorded no type: the command reads it from the bytes.
      mimeType: options.mimeType === undefined ? "image/jpeg" : options.mimeType,
      ordinal: options.ordinal ?? 0,
      status: options.status ?? "active",
    });
    return hash;
  }

  const rowFor = (hash: string) =>
    db.query.imageCutouts.findFirst({ where: (t, { eq }) => eq(t.sourceContentHash, hash) });

  it("cuts every active photo once, stores the PNG under cutouts/ and records it", async () => {
    const a = await seedPhoto();
    const b = await seedPhoto({ mimeType: null });
    await seedPhoto({ status: "orphaned" });
    const tool = fakeTool((hash) =>
      hash === b ? { ...AUTO(hash), status: "pending" } : AUTO(hash),
    );

    const result = await commandCutout(runtime, { segment: model.segment, runner: tool });

    expect(result).toEqual({ candidates: 2, auto: 1, pending: 1, failed: 0 });
    expect(tool.seen.sort()).toEqual([a, b].sort());
    const row = await rowFor(a);
    expect(row).toMatchObject({
      status: "auto",
      width: 300,
      height: 500,
      agreement: null,
      attempts: 1,
    });
    expect(row!.objectKey).toBe(cutoutKey(PNG(`cut-${a}`)));
    expect(row!.objectKey).toMatch(/^cutouts\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
    const stored = Buffer.from((await store.get(row!.objectKey!))!);
    expect(stored.equals(PNG(`cut-${a}`))).toBe(true);
    expect((await rowFor(b))!.status).toBe("pending");

    // Nothing is left to do, and a second run cuts nothing.
    expect(await loadCutoutCandidates(db)).toEqual([]);
    expect(
      await commandCutout(runtime, { segment: model.segment, runner: fakeTool(AUTO) }),
    ).toMatchObject({
      candidates: 0,
    });
  });

  it("records a failure, retries it, and gives up after a few attempts", async () => {
    const hash = await seedPhoto();
    const failing = fakeTool(() => ({ error: "ValueError: the models found no pack" }));
    for (let attempt = 1; attempt <= CUTOUT_MAX_ATTEMPTS; attempt++) {
      await commandCutout(runtime, { segment: model.segment, runner: failing });
      expect(await rowFor(hash)).toMatchObject({ status: "failed", attempts: attempt });
    }
    expect((await rowFor(hash))!.lastError).toContain("found no pack");
    expect(await loadCutoutCandidates(db)).toEqual([]);
  });

  it("a failed photo that later succeeds is recorded as made", async () => {
    const hash = await seedPhoto();
    await commandCutout(runtime, {
      segment: model.segment,
      runner: fakeTool(() => ({ error: "boom" })),
    });
    await commandCutout(runtime, { segment: model.segment, runner: fakeTool(AUTO) });
    expect(await rowFor(hash)).toMatchObject({ status: "auto", attempts: 2, lastError: null });
  });

  it("never touches a decided row: a rejected cut-out is not made again", async () => {
    const hash = await seedPhoto();
    await db
      .insert(imageCutouts)
      .values({ sourceContentHash: hash, status: "rejected", decidedBy: "owner" });
    const tool = fakeTool(AUTO);
    expect(await commandCutout(runtime, { segment: model.segment, runner: tool })).toMatchObject({
      candidates: 0,
    });
    expect(tool.seen).toEqual([]);
    expect((await rowFor(hash))!.status).toBe("rejected");
  });

  it("redoes a settled photo by name: the new cut-out waits for a person", async () => {
    const rejected = await seedPhoto();
    const live = await seedPhoto();
    const untouched = await seedPhoto();
    for (const [hash, status] of [
      [rejected, "rejected"],
      [live, "approved"],
      [untouched, "auto"],
    ] as const) {
      await db.insert(imageCutouts).values({
        sourceContentHash: hash,
        objectKey: `cutouts/old/${hash}.png`,
        status,
        attempts: 1,
        ...(status === "auto" ? {} : { decidedBy: "owner", decidedAt: new Date() }),
      });
    }
    const tool = fakeTool(AUTO);

    const result = await commandCutout(runtime, {
      segment: model.segment,
      runner: tool,
      redo: [rejected, live, "f".repeat(64)],
    });

    expect(result).toEqual({ candidates: 2, auto: 0, pending: 2, failed: 0 });
    expect(tool.seen.sort()).toEqual([rejected, live].sort());
    for (const hash of [rejected, live]) {
      const row = await rowFor(hash);
      expect(row).toMatchObject({
        status: "pending",
        decidedBy: null,
        decidedAt: null,
        attempts: 2,
      });
      expect(row!.objectKey).toBe(cutoutKey(PNG(`cut-${hash}`)));
      expect(row!.madeBy).toBe("tools/cutout v3 fal-ai/bria/background/remove");
    }
    expect(await rowFor(untouched)).toMatchObject({
      status: "auto",
      objectKey: `cutouts/old/${untouched}.png`,
    });
  });

  it("a redo that fails leaves the settled row as it was", async () => {
    const hash = await seedPhoto();
    await db.insert(imageCutouts).values({
      sourceContentHash: hash,
      objectKey: `cutouts/old/${hash}.png`,
      status: "approved",
      decidedBy: "owner",
      attempts: 1,
    });
    const result = await commandCutout(runtime, {
      segment: model.segment,
      runner: fakeTool(() => ({ error: "boom" })),
      redo: [hash],
    });
    expect(result).toMatchObject({ failed: 1 });
    expect(await rowFor(hash)).toMatchObject({
      status: "approved",
      decidedBy: "owner",
      objectKey: `cutouts/old/${hash}.png`,
      lastError: null,
    });
  });

  it("a redo leaves a decision the owner made while it ran", async () => {
    const hash = await seedPhoto();
    await db.insert(imageCutouts).values({
      sourceContentHash: hash,
      objectKey: `cutouts/old/${hash}.png`,
      status: "pending",
      attempts: 1,
    });
    const cut = fakeTool(AUTO);
    const ownerDecidesMeanwhile: CutoutRunner = async (input) => {
      await db
        .update(imageCutouts)
        .set({ status: "approved", decidedBy: "owner", updatedAt: new Date() })
        .where(eq(imageCutouts.sourceContentHash, hash));
      return cut(input);
    };
    const result = await commandCutout(runtime, {
      segment: model.segment,
      runner: ownerDecidesMeanwhile,
      redo: [hash],
    });
    expect(result).toMatchObject({ pending: 0, failed: 1 });
    expect(await rowFor(hash)).toMatchObject({
      status: "approved",
      decidedBy: "owner",
      objectKey: `cutouts/old/${hash}.png`,
    });
  });

  it("finds a redo's photos only among active ones", async () => {
    const active = await seedPhoto();
    const orphaned = await seedPhoto({ status: "orphaned" });
    expect((await loadRedoCandidates(db, [active, orphaned])).map((c) => c.hash)).toEqual([active]);
    expect(await loadRedoCandidates(db, [])).toEqual([]);
  });

  it("a photo missing from the store fails without stopping the others", async () => {
    const present = await seedPhoto();
    const gone = await seedPhoto();
    await store.delete(`catalog/${gone.slice(0, 2)}/${gone.slice(2, 4)}/${gone}.jpg`);
    const result = await commandCutout(runtime, { segment: model.segment, runner: fakeTool(AUTO) });
    expect(result).toMatchObject({ auto: 1, failed: 1 });
    expect((await rowFor(present))!.status).toBe("auto");
    expect((await rowFor(gone))!.lastError).toContain("not in the store");
  });

  it("sends each photo's public address to the model, and hands the tool its answer", async () => {
    const hash = await seedPhoto();
    const tool = fakeTool(AUTO);
    await commandCutout(runtime, { segment: model.segment, runner: tool });
    expect(model.calls).toEqual([
      `https://store.test/media/catalog/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.jpg`,
    ]);
    expect(tool.modelled).toEqual([hash]);
  });

  it("a photo the model could not cut fails alone, and is tried again next run", async () => {
    const fine = await seedPhoto();
    const refused = await seedPhoto();
    const picky = fakeModel((url) =>
      url.includes(refused)
        ? new ModelError("fal answered HTTP 422: image_url unreachable", 422)
        : null,
    );
    const result = await commandCutout(runtime, { segment: picky.segment, runner: fakeTool(AUTO) });
    expect(result).toMatchObject({ auto: 1, failed: 1 });
    expect((await rowFor(fine))!.status).toBe("auto");
    expect(await rowFor(refused)).toMatchObject({ status: "failed", attempts: 1 });
    expect((await rowFor(refused))!.lastError).toContain("the model failed: fal answered HTTP 422");
    expect((await loadCutoutCandidates(db)).map((c) => c.hash)).toEqual([refused]);
  });

  it("an account the model refuses stops the run, and no photo spends an attempt", async () => {
    const hash = await seedPhoto();
    const locked = fakeModel(
      () =>
        new ModelAccountError(
          "fal refused the account (HTTP 403): User is locked. Reason: TOP_UP.",
        ),
    );
    const tool = fakeTool(AUTO);
    const result = await commandCutout(runtime, { segment: locked.segment, runner: tool });
    expect(result).toMatchObject({ auto: 0, failed: 0, deferred: 1 });
    expect(result.stopped).toContain("TOP_UP");
    expect(tool.seen).toEqual([]);
    expect(await rowFor(hash)).toBeUndefined();
    expect((await loadCutoutCandidates(db)).map((c) => c.hash)).toEqual([hash]);
  });

  it("a refusal mid-run stops the asking, and what was paid for is still recorded", async () => {
    const hashes: string[] = [];
    for (let i = 0; i < 12; i++) hashes.push(await seedPhoto());
    const runsDry = fakeModel((_url, before) =>
      before >= 3 ? new ModelAccountError("fal refused the account (HTTP 403): TOP_UP") : null,
    );
    const result = await commandCutout(runtime, {
      segment: runsDry.segment,
      runner: fakeTool(AUTO),
    });
    expect(runsDry.answered).toHaveLength(3);
    expect(runsDry.calls.length).toBeLessThan(12);
    expect(result).toMatchObject({ auto: 3, failed: 0, deferred: 9 });
    expect(result.stopped).toContain("TOP_UP");
    for (const url of runsDry.answered) {
      const hash = hashes.find((h) => url.includes(h))!;
      expect((await rowFor(hash))!.status).toBe("auto");
    }
    expect(await loadCutoutCandidates(db)).toHaveLength(9); // asked again next run, no attempt spent
  });

  it("a model that answers nothing is an outage: nothing is recorded, no attempt spent", async () => {
    for (let i = 0; i < 12; i++) await seedPhoto();
    const down = fakeModel(() => new ModelError("fal answered HTTP 503: unavailable", 503));
    const tool = fakeTool(AUTO);
    const result = await commandCutout(runtime, { segment: down.segment, runner: tool });
    expect(result.stopped).toContain("answered none of the first 4");
    expect(result).toMatchObject({ auto: 0, failed: 0, deferred: 12 });
    expect(down.calls.length).toBeLessThan(12);
    expect(tool.seen).toEqual([]);
    const waiting = await loadCutoutCandidates(db);
    expect(waiting).toHaveLength(12);
    expect(waiting.every((c) => c.attempts === 0)).toBe(true);
  });

  it("a store that fails stops the run before anything is recorded", async () => {
    const hash = await seedPhoto();
    const failing = {
      ...runtime,
      storage: Object.assign(Object.create(Object.getPrototypeOf(store)), store, {
        get: async () => {
          throw new Error("store unavailable");
        },
      }),
    };
    await expect(
      commandCutout(failing, { segment: model.segment, runner: fakeTool(AUTO) }),
    ).rejects.toThrow("store unavailable");
    expect(model.calls).toEqual([]);
    expect(await rowFor(hash)).toBeUndefined();
  });

  it("the model's key reaches neither the tool's environment nor anything it is given", async () => {
    await seedPhoto();
    const saved = process.env.FAL_KEY;
    process.env.FAL_KEY = "key-id:sentinel-secret";
    try {
      const tool = fakeTool(AUTO);
      await commandCutout(runtime, { segment: model.segment, runner: tool });
      expect(tool.envs).toHaveLength(1);
      expect(Object.keys(tool.envs[0]!)).not.toContain("FAL_KEY");
      expect(JSON.stringify(tool.envs[0])).not.toContain("sentinel-secret");
    } finally {
      if (saved === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = saved;
    }
  });

  it("a photo with no public address is not sent anywhere", async () => {
    const hash = await seedPhoto();
    const unpublished = {
      ...runtime,
      storage: new LocalStorageDriver(path.join(root, "store"), "http://store.test/media"),
    };
    const result = await commandCutout(unpublished, {
      segment: model.segment,
      runner: fakeTool(AUTO),
    });
    expect(result).toMatchObject({ failed: 1 });
    expect(model.calls).toEqual([]);
    expect((await rowFor(hash))!.lastError).toContain("no public address");
  });

  it("a dry run lists the photos and calls no model", async () => {
    await seedPhoto();
    const result = await commandCutout(runtime, {
      segment: model.segment,
      runner: fakeTool(AUTO),
      dryRun: true,
    });
    expect(result).toMatchObject({ candidates: 1, auto: 0 });
    expect(model.calls).toEqual([]);
  });

  it("refuses to start without a usable FAL_KEY, before any photo is touched", async () => {
    const hash = await seedPhoto();
    const saved = process.env.FAL_KEY;
    try {
      delete process.env.FAL_KEY;
      await expect(commandCutout(runtime, { runner: fakeTool(AUTO) })).rejects.toThrow(
        "FAL_KEY is not set",
      );
      process.env.FAL_KEY = "key-id:broken\nsecret-part";
      const refusal = commandCutout(runtime, { runner: fakeTool(AUTO) });
      await expect(refusal).rejects.toThrow("is not a fal key");
      await expect(refusal).rejects.not.toThrow("secret-part");
    } finally {
      if (saved === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = saved;
    }
    expect(await rowFor(hash)).toBeUndefined();
    expect(photoKey(hash)).toContain(hash);
  });

  it("cuts primary photos first when limited", async () => {
    const second = await seedPhoto({ ordinal: 1 });
    const primary = await seedPhoto({ ordinal: 0 });
    const [first] = await loadCutoutCandidates(db, 1);
    expect(first!.hash).toBe(primary);
    expect(second).not.toBe(primary);
  });
});

describe("photoExtension", () => {
  it("reads the format from the first bytes, whatever the row says", () => {
    expect(photoExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(photoExtension(new Uint8Array(PNG("x")))).toBe("png");
    expect(
      photoExtension(
        new Uint8Array(
          Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]),
        ),
      ),
    ).toBe("webp");
    expect(photoExtension(new Uint8Array(Buffer.from("GIF89a")))).toBeNull();
  });
});

describe("cutoutEnvironment", () => {
  it("passes what Python needs and nothing secret", () => {
    const env = cutoutEnvironment({
      PATH: "/usr/bin",
      VIRTUAL_ENV: "/venv",
      DATABASE_URL: "postgres://user:secret@db/catalog",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_secret",
      FAL_KEY: "key-id:secret",
      STORAGE_PUBLIC_BASE_URL: "https://store.test",
    });
    expect(env).toMatchObject({ PATH: "/usr/bin", VIRTUAL_ENV: "/venv", PYTHONUNBUFFERED: "1" });
    expect(Object.keys(env)).not.toContain("DATABASE_URL");
    expect(Object.keys(env)).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(Object.keys(env)).not.toContain("FAL_KEY");
    expect(JSON.stringify(env)).not.toContain("secret");
  });
});
