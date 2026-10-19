import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@catalog/db";
import { products } from "@catalog/db/schema";
import { silentLogger } from "@catalog/shared";
import { loadConfig } from "../src/config.ts";
import type { SourceCheck } from "../src/catalog/copywriter/apply.ts";
import { ClaudeRunError } from "../src/catalog/copywriter/claude.ts";
import type { CopyBatch, CopyOutput } from "../src/catalog/copywriter/contract.ts";
import { type CopyGenerator, runCatalogCopy } from "../src/catalog/copywriter/run.ts";
import { runCatalogSync } from "../src/catalog/sync.ts";
import { Fetcher } from "../src/fetch/fetcher.ts";
import { LocalStorageDriver } from "../src/storage/driver.ts";
import { type FakeProduct, baseCatalog, createFakeFetch } from "./helpers/fakeSource.ts";
/*
 * Its own database: the sync integration suite truncates every catalog table,
 * and Vitest runs test files in parallel. The helper reads the name when it is
 * first imported, so it is set before that import.
 */
process.env.TEST_DATABASE_NAME =
  `${process.env.TEST_DATABASE_NAME ?? "catalog_test"}_copywriter`.slice(0, 60);
const { isDatabaseAvailable, resetTestDatabase, setupTestDatabase } =
  await import("./helpers/testDb.ts");

/**
 * The catalog copywriter against a real database and a real sync. Only the
 * model is replaced, by a function that answers the batch file it is given,
 * and the check of cited pages, by one that agrees.
 */

const available = await isDatabaseAvailable();
const describeIntegration = available ? describe : describe.skip;

/* Distinct Bulgarian texts: the audit refuses two products the same summary. */
const ANGLES = [
  "плътно тяло",
  "мек аромат",
  "гъста крема",
  "лек послевкус",
  "наситен вкус",
  "чиста киселинност",
  "кадифена текстура",
  "дълъг финал",
  "сладникав оттенък",
  "балансиран профил",
  "силен характер",
  "нежна горчивина",
  "ясен аромат",
  "топъл завършек",
];

function copyFor(index: number) {
  const angle = ANGLES[index % ANGLES.length] as string;
  return {
    summary: `Кафе за всеки ден, в което личи ${angle} — подходящо и за еспресо, и за по-дълга чаша сутрин.`,
    body: [
      `Чашата се отличава с ${angle}, без да натежава и без остри ръбове в края.`,
      `Номер ${index} в нашата подборка: подходящо е за автоматична кафемашина и за кафе с мляко.`,
    ],
  };
}

const agree: SourceCheck = async () => null;

describeIntegration("catalog copywriter (integration)", () => {
  let db: Database;
  let closeDb: () => Promise<void>;
  let storageDir: string;
  let skillDir: string;
  let skillFile: string;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    db = setup.db;
    closeDb = setup.close;
    storageDir = await mkdtemp(path.join(tmpdir(), "catalog-storage-"));
    skillDir = await mkdtemp(path.join(tmpdir(), "catalog-skill-"));
    skillFile = path.join(skillDir, "SKILL.md");
    await writeFile(skillFile, "---\nname: catalog-copy\n---\nTest skill.\n", "utf8");
  }, 120_000);

  afterAll(async () => {
    await closeDb?.();
    for (const dir of [storageDir, skillDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await resetTestDatabase(db);
  });

  /** The tin whose name says 18 pods and whose pack field says 100. */
  const TIN: FakeProduct = {
    h1: "Дозети Illy Decaffeinato 18бр.",
    url: "/illy-decaffeinato-18/",
    price: "€9.20",
    weight: "100 бр.",
    description: "Illy decaffeinated coffee in E.S.E. pods, a smooth cup without caffeine.",
  };
  const catalog = (): FakeProduct[] => [
    ...baseCatalog().map((product, index) => ({
      ...product,
      description: `Source text number ${index + 1}: a balanced blend for espresso machines.`,
    })),
    TIN,
  ];

  async function sync(items: readonly FakeProduct[]) {
    const config = loadConfig(
      {
        baseUrl: "https://fake.test/",
        canonicalHost: "fake.test",
        hostAliases: [],
        minDelayMs: 0,
        imageMinDelayMs: 0,
        maxRetries: 0,
        respectRobotsTxt: false,
        enrichMaxPerRun: 0,
        storageDriver: "local",
        storageLocalDir: storageDir,
      },
      {},
    );
    const { fetchImpl } = createFakeFetch({ products: items });
    return runCatalogSync({
      config,
      db,
      fetcher: new Fetcher({ config, fetchImpl, logger: silentLogger }),
      storage: new LocalStorageDriver(storageDir),
      logger: silentLogger,
      dryRun: false,
      skipImages: true,
    });
  }

  /**
   * A stand-in model: copy for everything asked, and for the tin a confident
   * correction to 20 pods (what the manufacturer would say in this story).
   */
  function fakeModel(onBatch?: (batch: CopyBatch) => Promise<void>) {
    const batches: CopyBatch[] = [];
    const workspaces: string[] = [];
    let written = 0;
    const generate: CopyGenerator = async ({ cwd, batchFile }) => {
      workspaces.push(cwd);
      // The workspace holds the skill and the batch, and nothing of ours.
      const files = (await readdir(cwd, { recursive: true })).map((file) =>
        String(file).split(path.sep).join("/"),
      );
      expect(files.sort()).toEqual(
        [
          ".claude",
          ".claude/skills",
          ".claude/skills/catalog-copy",
          ".claude/skills/catalog-copy/SKILL.md",
          batchFile,
        ].sort(),
      );
      const batch = JSON.parse(await readFile(path.join(cwd, batchFile), "utf8")) as CopyBatch;
      batches.push(batch);
      await onBatch?.(batch);
      const output: CopyOutput = {
        products: batch.products.map((item) => ({
          id: item.id,
          copy: item.task.writeCopy ? copyFor((written += 1)) : null,
          research: item.task.research
            ? {
                verdict: "corrected",
                pack: {
                  value: 20,
                  unit: "pc",
                  confidence: "high",
                  sources: ["https://www.illy.com/en/pods-20", "https://shop.example.de/illy-20"],
                },
                findings: [],
                note: "Two sources list 20 pods.",
              }
            : null,
        })),
      };
      return { output, costUsd: 0.1, turns: 5, durationMs: 1000 };
    };
    return { generate, batches, workspaces };
  }

  const run = (
    generate: CopyGenerator,
    options: { apply?: boolean; limit?: number; checkSources?: SourceCheck } = {},
  ) =>
    runCatalogCopy({
      db,
      logger: silentLogger,
      apply: options.apply ?? true,
      limit: options.limit ?? 40,
      batchSize: 5,
      skillFile,
      model: "claude-opus-5-5",
      generate,
      checkSources: options.checkSources ?? agree,
    });

  const tinRow = async () => {
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.sourcePath, "/illy-decaffeinato-18/"));
    if (!row) throw new Error("the tin is not stored");
    return row;
  };

  it("plans without calling the model or writing", async () => {
    await sync(catalog());
    const model = fakeModel();
    const result = await run(model.generate, { apply: false });
    expect(result.applied).toBe(false);
    expect(result.planned).toHaveLength(13);
    // The tin is researched first.
    expect(result.planned[0]).toMatchObject({ writeCopy: true, research: true });
    expect(model.batches).toHaveLength(0);
    expect((await tinRow()).copyOrigin).toBeNull();
  });

  it("writes copy, corrects the pack, and a resync keeps the correction", async () => {
    await sync(catalog());
    const model = fakeModel();
    const result = await run(model.generate);
    expect(result).toMatchObject({
      applied: true,
      // One prompt for the researched tin, then the rest five at a time.
      batches: 4,
      copyWritten: 13,
      copyRejected: 0,
      researched: 1,
      packsCorrected: 1,
      failedBatches: 0,
      stopped: null,
    });
    // The workspace is gone once the run ends.
    for (const workspace of new Set(model.workspaces)) {
      await expect(readdir(workspace)).rejects.toThrow();
    }

    const tin = await tinRow();
    expect(tin).toMatchObject({
      copyOrigin: "ai",
      copyModel: "claude-opus-5-5",
      copyAttempts: 0,
      copyLastError: null,
      packOverrideValue: "20.0000",
      packOverrideUnit: "pc",
      weightValue: "20.0000",
      weightUnit: "pc",
      servings: "20.0000",
    });
    expect(tin.descriptionTextOverride).toMatch(/^Кафе за всеки ден/);
    expect(tin.descriptionHtmlOverride).toMatch(/^<p>/);
    expect(tin.factsResearch).toMatchObject({ version: 2, verdict: "corrected", applied: true });

    // The source still says 18 and 100; the next sync must not undo the research.
    await sync(catalog());
    expect(await tinRow()).toMatchObject({
      weightValue: "20.0000",
      weightUnit: "pc",
      servings: "20.0000",
      descriptionTextOverride: tin.descriptionTextOverride,
    });

    // And nothing is left to do: the copy is current, the facts are checked.
    const again = await run(fakeModel().generate, { apply: false });
    expect(again.planned).toEqual([]);
  });

  it("keeps the owner's revert: no new research, no re-applied size", async () => {
    await sync(catalog());
    await run(fakeModel().generate);
    const corrected = await tinRow();

    // What "Върни размера на източника" in the admin does.
    await db
      .update(products)
      .set({
        packOverrideValue: null,
        packOverrideUnit: null,
        factsResearch: {
          ...(corrected.factsResearch as Record<string, unknown>),
          applied: false,
          heldBack: null,
          decidedBy: "owner",
          rejected: [{ value: 20, unit: "pc" }],
        },
      })
      .where(eq(products.id, corrected.id));
    await sync(catalog());
    const reverted = await tinRow();
    expect(reverted).toMatchObject({ weightValue: "18.0000", packOverrideValue: null });

    // The supplier's statements have not changed, so the tin is not researched
    // again; its copy is rewritten (the size in force changed), and no more.
    const model = fakeModel();
    const result = await run(model.generate);
    expect(result.researched).toBe(0);
    expect(
      model.batches.flatMap((batch) => batch.products.map((p) => p.task.research)),
    ).not.toContain(true);
    expect(await tinRow()).toMatchObject({ weightValue: "18.0000", packOverrideValue: null });
  });

  it("holds a correction back when the cited pages do not confirm it", async () => {
    await sync(catalog());
    const result = await run(fakeModel().generate, {
      checkSources: async () => "0 от цитираните сайтове се отвориха и посочват 20 (нужни са 2)",
    });
    expect(result.packsCorrected).toBe(0);
    const tin = await tinRow();
    expect(tin).toMatchObject({ weightValue: "18.0000", packOverrideValue: null });
    expect(tin.factsResearch).toMatchObject({
      applied: false,
      heldBack: expect.stringMatching(/цитираните сайтове/),
    });
  });

  it("never replaces a text a person published while the model was writing", async () => {
    await sync(catalog());
    const model = fakeModel(async (batch) => {
      const first = batch.products[0];
      if (!first) return;
      await db
        .update(products)
        .set({ descriptionTextOverride: "Ръчно написано.", copyOrigin: "hand" })
        .where(eq(products.id, first.id));
    });
    const result = await run(model.generate, { limit: 1 });
    expect(result.copyWritten).toBe(0);
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.id, model.batches[0]?.products[0]?.id as string));
    expect(row).toMatchObject({ descriptionTextOverride: "Ръчно написано.", copyOrigin: "hand" });
  });

  it("charges an attempt for a failed batch, but nothing for a service failure", async () => {
    await sync(catalog());
    const limited: CopyGenerator = async () => {
      throw new ClaudeRunError("usage limit", "Claude AI usage limit reached", "service");
    };
    const stopped = await run(limited);
    expect(stopped.stopped).toMatch(/^service/);
    expect(stopped.failedBatches).toBe(1);
    expect((await db.select().from(products)).every((row) => row.copyAttempts === 0)).toBe(true);

    const broken: CopyGenerator = async () => {
      throw new ClaudeRunError("out of turns", "", "batch");
    };
    const failed = await run(broken, { limit: 6 });
    expect(failed.stopped).toBeNull();
    const charged = (await db.select().from(products)).filter((row) => row.copyAttempts === 1);
    expect(charged).toHaveLength(6);
    expect(charged[0]?.copyLastError).toMatch(/out of turns/);
  });
});
