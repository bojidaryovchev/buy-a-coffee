import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { sourceSites, syncRuns } from "@catalog/db/schema";
import type { Database } from "@catalog/db";
import type { Notification } from "@/lib/notifications";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * A manual `catalog:link` writes a `sync_runs` row of its own. It must not count
 * as a sync when the alarm works out the last success, nor on the sync page.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

suite("manual link runs and the sync alarm (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let siteId: string;
  let sent: Notification[];

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("sync_manual_link"));
    const { setNotificationSink } = await import("@/lib/notifications");
    setNotificationSink({
      name: "capture",
      async send(notification) {
        sent.push(notification);
      },
    });
    await db.execute(sql`truncate table source_sites restart identity cascade`);
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "manual-link-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    sent = [];
    await db.execute(sql`truncate table sync_runs, sync_alerts restart identity cascade`);
  });

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  const real = (h: number) =>
    db.insert(syncRuns).values({
      sourceSiteId: siteId,
      status: "succeeded",
      startedAt: hoursAgo(h),
      completedAt: hoursAgo(h),
      catalogSource: "filter_init",
      parserConfidence: "1.000",
    });

  const link = (h: number) =>
    db.insert(syncRuns).values({
      sourceSiteId: siteId,
      status: "succeeded",
      startedAt: hoursAgo(h),
      completedAt: hoursAgo(h),
      movedCount: 1,
      metadata: { kind: "manual_link", slug: "some-product" },
    });

  it("the alarm still fires when the only recent success is a manual link", async () => {
    await real(40);
    await link(0.5);
    const { runSyncHealthCheck } = await import("@/lib/sync-health-check");

    const report = await runSyncHealthCheck();

    expect(report.conditions.map((c) => c.condition)).toContain("no_recent_success");
    expect(sent.map((n) => n.kind)).toEqual(["sync_alert"]);
  });

  it("stays quiet when a real sync is recent, link or no link", async () => {
    await real(2);
    await link(0.5);
    const { runSyncHealthCheck } = await import("@/lib/sync-health-check");

    expect((await runSyncHealthCheck()).conditions).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("a burst of links cannot push the real runs out of the window that is read", async () => {
    await real(2);
    for (let i = 0; i < 60; i += 1) await link(0.1 + i / 1000);
    const { runSyncHealthCheck } = await import("@/lib/sync-health-check");

    const report = await runSyncHealthCheck();

    expect(report.conditions).toEqual([]);
    expect(report.runsRead).toBe(1);
  });

  it("the sync page's 'last synchronised' skips manual links", async () => {
    await real(5);
    await link(0.5);
    const { lastSuccessfulSync } = await import("@/lib/admin-queries");

    const last = await lastSuccessfulSync();

    expect(last).not.toBeNull();
    // Five hours ago, not half an hour.
    expect(Date.now() - last!.at.getTime()).toBeGreaterThan(4 * 3_600_000);
  });

  it("with nothing but a manual link there is no last success", async () => {
    await link(0.5);
    const { lastSuccessfulSync } = await import("@/lib/admin-queries");
    expect(await lastSuccessfulSync()).toBeNull();
  });
});
