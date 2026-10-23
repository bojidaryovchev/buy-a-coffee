import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { imageCutouts } from "@catalog/db/schema";
import type { Database } from "@catalog/db";
// Types only: the module is imported in `beforeAll`, once the test database is chosen.
import type * as Actions from "@/lib/cutout-review-actions";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * The owner's decisions on /admin/snimki name the cut-out they were looking
 * at. A redo (`pnpm images:cutout --redo`) can put a new cut-out on the same
 * row while the screen still shows the old one; a click on the old one must
 * decide nothing.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({ isSignedIn: async () => true }));

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const HASH = "ab".repeat(32);
const OLD = `cutouts/0a/0a/${"0a".repeat(32)}.png`;
const NEW = `cutouts/0b/0b/${"0b".repeat(32)}.png`;

suite("cut-out decisions (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actions: typeof Actions;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("cutout_review"));
    actions = await import("@/lib/cutout-review-actions");
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table image_cutouts`);
  });

  const form = (key: string) => {
    const data = new FormData();
    data.set("hash", HASH);
    data.set("key", key);
    return data;
  };
  const row = async () =>
    (await db.select().from(imageCutouts).where(eq(imageCutouts.sourceContentHash, HASH)))[0]!;

  it("approves the cut-out that was shown", async () => {
    await db
      .insert(imageCutouts)
      .values({ sourceContentHash: HASH, objectKey: NEW, status: "pending" });
    await actions.approveCutout(form(NEW));
    expect(await row()).toMatchObject({ status: "approved", decidedBy: "owner" });
  });

  it("does not approve a cut-out a redo put in its place", async () => {
    await db
      .insert(imageCutouts)
      .values({ sourceContentHash: HASH, objectKey: NEW, status: "pending" });
    await actions.approveCutout(form(OLD));
    expect(await row()).toMatchObject({ status: "pending", decidedBy: null });
  });

  it("does not take down a cut-out a redo put in its place", async () => {
    await db
      .insert(imageCutouts)
      .values({ sourceContentHash: HASH, objectKey: NEW, status: "pending" });
    await actions.rejectCutout(form(OLD));
    expect((await row()).status).toBe("pending");
    await actions.rejectCutout(form(NEW));
    expect((await row()).status).toBe("rejected");
  });

  it("ignores a decision that names no cut-out", async () => {
    await db
      .insert(imageCutouts)
      .values({ sourceContentHash: HASH, objectKey: NEW, status: "pending" });
    const data = new FormData();
    data.set("hash", HASH);
    await actions.approveCutout(data);
    expect((await row()).status).toBe("pending");
  });

  it("lists every cut-out the shop shows, not only the latest sixty", async () => {
    const hex = (n: number, seed: string) =>
      `${seed}${n.toString(16).padStart(4, "0")}`.padEnd(64, "0");
    const live = Array.from({ length: 70 }, (_, n) => ({
      sourceContentHash: hex(n, "a"),
      objectKey: `cutouts/0c/0c/${hex(n, "c")}.png`,
      status: n % 2 ? ("auto" as const) : ("approved" as const),
    }));
    const failed = Array.from({ length: 65 }, (_, n) => ({
      sourceContentHash: hex(n, "f"),
      status: "failed" as const,
      attempts: 1,
    }));
    await db.insert(imageCutouts).values([...live, ...failed]);
    const review = await (await import("@/lib/cutout-review")).loadCutoutReview();
    expect(review.live).toHaveLength(70);
    expect(review.failed).toHaveLength(60); // a failed list stays short
  });
});
