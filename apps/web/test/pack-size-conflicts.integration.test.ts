import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { sql } from "drizzle-orm";
import { products, sourceSites, syncRuns } from "@catalog/db/schema";
import type { Database } from "@catalog/db";
import type { Notification } from "@/lib/notifications";
import { applyPackSizes, planPackSizes } from "../scripts/catalog-pack-size-lib";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * The owner is told when the source states two pack sizes for one product:
 * on the admin's sync page, from what the sync (or `catalog:pack-size`) stored
 * on the product, and never by mail.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const CONFLICT = { inName: "18 бр.", inPackField: "100 бр." };

suite("pack-size conflicts on the sync page (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let siteId: string;
  let sent: Notification[];

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("pack_conflicts"));
    const { setNotificationSink } = await import("@/lib/notifications");
    setNotificationSink({
      name: "capture",
      async send(notification) {
        sent.push(notification);
      },
    });
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    sent = [];
    await db.execute(sql`truncate table source_sites, sync_alerts restart identity cascade`);
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "pack-conflict-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
    // A healthy, recent sync: whatever the page says is about the data.
    await db.insert(syncRuns).values({
      sourceSiteId: siteId,
      status: "succeeded",
      startedAt: new Date(Date.now() - 3_600_000),
      completedAt: new Date(Date.now() - 3_600_000),
      catalogSource: "filter_init",
      parserConfidence: "1.000",
    });
  });

  const add = (input: {
    key: string;
    name: string;
    sourceData: Record<string, unknown>;
    status?: "active" | "missing" | "removed";
    weight?: string;
    weightValue?: string;
  }) =>
    db.insert(products).values({
      sourceSiteId: siteId,
      sourceKey: input.key,
      sourceUrl: `https://example.test${input.key}`,
      sourcePath: input.key,
      name: input.name,
      slug: input.key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      currentPrice: "9.20",
      weight: input.weight ?? "18 бр.",
      weightValue: input.weightValue ?? "18",
      weightUnit: "pc",
      servings: input.weightValue ?? "18",
      servingsEstimated: false,
      status: input.status ?? "active",
      semanticHash: input.key,
      sourceData: input.sourceData,
    });

  const page = async (): Promise<string> => {
    const { default: AdminSyncPage } = await import("@/app/(admin)/admin/(panel)/sinhron/page");
    return renderToStaticMarkup(await AdminSyncPage({ searchParams: Promise.resolve({}) }));
  };

  it("lists a product whose two sizes disagree, by the source's name, with both sizes", async () => {
    await add({
      key: "/illy-decaffeinato-18/",
      name: "Дозети Illy Decaffeinato 18бр.",
      sourceData: { packField: "100 бр.", packSizeConflict: CONFLICT },
    });
    await add({
      key: "/illy-classico-18/",
      name: "Дозети Illy Classico 18бр.",
      sourceData: { packField: "18 бр.", packSizeConflict: null },
    });
    // Stored before the sync recorded anything about pack fields.
    await add({ key: "/lavazza-oro-18/", name: "Дозети Lavazza Oro 18бр.", sourceData: {} });
    const { listPackSizeConflicts } = await import("@/lib/admin-queries");

    expect(await listPackSizeConflicts()).toEqual([
      {
        id: expect.any(String),
        name: "Дозети Illy Decaffeinato 18бр.",
        slug: "illy-decaffeinato-18",
        status: "active",
        inName: "18 бр.",
        inPackField: "100 бр.",
      },
    ]);
  });

  it("keeps listing a product that is missing, and drops one that was removed", async () => {
    await add({
      key: "/missing-tin/",
      name: "Дозети Missing 18бр.",
      status: "missing",
      sourceData: { packSizeConflict: CONFLICT },
    });
    await add({
      key: "/removed-tin/",
      name: "Дозети Removed 18бр.",
      status: "removed",
      sourceData: { packSizeConflict: CONFLICT },
    });
    const { listPackSizeConflicts } = await import("@/lib/admin-queries");

    expect((await listPackSizeConflicts()).map((row) => row.name)).toEqual([
      "Дозети Missing 18бр.",
    ]);
  });

  it("ignores a stored value that is not a conflict", async () => {
    await add({
      key: "/odd/",
      name: "Дозети Odd 18бр.",
      sourceData: { packSizeConflict: "100 бр." },
    });
    await add({
      key: "/half/",
      name: "Дозети Half 18бр.",
      sourceData: { packSizeConflict: { inName: "18 бр." } },
    });
    const { listPackSizeConflicts } = await import("@/lib/admin-queries");

    expect(await listPackSizeConflicts()).toEqual([]);
  });

  it("shows it on the sync page, in the box the owner reads first and in a table of its own", async () => {
    await add({
      key: "/illy-decaffeinato-18/",
      name: "Дозети Illy Decaffeinato 18бр.",
      sourceData: { packField: "100 бр.", packSizeConflict: CONFLICT },
    });

    const html = await page();

    expect(html).toContain("Грешка в данните при източника.");
    expect(html).toContain("За 1 продукт източникът посочва");
    expect(html).not.toContain("Нищо за отбелязване.");
    const section = html.slice(
      html.indexOf('id="razmer"'),
      html.indexOf('aria-labelledby="sync-copy"'),
    );
    expect(section).toContain("Разминаване в размера на опаковката");
    expect(section).toContain("Дозети Illy Decaffeinato 18бр.");
    expect(section).toContain('href="/bg/illy-decaffeinato-18"');
    expect(section).toMatch(/<td[^>]*>18 бр\.<\/td><td[^>]*>100 бр\.<\/td><td[^>]*>18 бр\.<\/td>/);
    // One heading per section, in order, and still a single h1.
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("says nothing about pack sizes when no product is in conflict", async () => {
    await add({
      key: "/illy-classico-18/",
      name: "Дозети Illy Classico 18бр.",
      sourceData: { packField: "18 бр.", packSizeConflict: null },
    });

    const html = await page();

    expect(html).toContain("Нищо за отбелязване.");
    expect(html).not.toContain("Грешка в данните при източника.");
    expect(html).not.toContain('id="razmer"');
  });

  it("lists a product as soon as `catalog:pack-size` has corrected it, without a sync", async () => {
    await add({
      key: "/illy-decaffeinato-18/",
      name: "Дозети Illy Decaffeinato 18бр.",
      weight: "100 бр.",
      weightValue: "100",
      sourceData: { weight: "100 бр.", weightCanonical: "100pc" },
    });
    const { listPackSizeConflicts } = await import("@/lib/admin-queries");
    expect(await listPackSizeConflicts()).toEqual([]);

    await applyPackSizes(db, await planPackSizes(db));

    expect(await listPackSizeConflicts()).toMatchObject([
      { name: "Дозети Illy Decaffeinato 18бр.", inName: "18 бр.", inPackField: "100 бр." },
    ]);
  });

  it("is not a sync alarm: nothing is mailed for it", async () => {
    await add({
      key: "/illy-decaffeinato-18/",
      name: "Дозети Illy Decaffeinato 18бр.",
      sourceData: { packField: "100 бр.", packSizeConflict: CONFLICT },
    });
    const { runSyncHealthCheck } = await import("@/lib/sync-health-check");

    const report = await runSyncHealthCheck();

    expect(report.conditions).toEqual([]);
    expect(sent).toEqual([]);
  });
});
