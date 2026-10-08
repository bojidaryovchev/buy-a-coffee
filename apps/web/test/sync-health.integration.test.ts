import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { sourceSites, syncAlerts, syncRuns } from "@catalog/db/schema";
import type { Database } from "@catalog/db";
import type { Notification } from "@/lib/notifications";
import type { runSyncHealthCheck } from "@/lib/sync-health-check";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";
import type { SyncCondition } from "@/lib/sync-health";

/**
 * The sync-health check against a real database: each condition, simulated by
 * writing the `sync_runs` row that causes it, produces exactly one notification,
 * and asking again the same day produces none.
 *
 * Skipped, loudly, when no PostgreSQL server is reachable — the same stance the
 * scraper's integration tests take.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

suite("sync-health check (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let siteId: string;
  let sent: Notification[];
  let deliver: boolean;
  let run: typeof runSyncHealthCheck;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("sync_health"));

    // After the database is chosen: `@/lib/db` reads DATABASE_URL on import.
    const { setNotificationSink } = await import("@/lib/notifications");
    setNotificationSink({
      name: "capture",
      async send(notification) {
        if (!deliver) throw new Error("mail provider down");
        sent.push(notification);
      },
    });
    ({ runSyncHealthCheck: run } = await import("@/lib/sync-health-check"));
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    sent = [];
    deliver = true;
    await db.execute(
      sql`truncate table sync_alerts, sync_runs, source_sites restart identity cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
  });

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  async function addRun(h: number, over: Partial<typeof syncRuns.$inferInsert> = {}) {
    await db.insert(syncRuns).values({
      sourceSiteId: siteId,
      status: "succeeded",
      startedAt: hoursAgo(h),
      completedAt: hoursAgo(h - 0.1),
      catalogSource: "filter_init",
      parserConfidence: "1.000",
      ...over,
    });
  }

  /** A healthy history: nothing should fire until the test spoils it. */
  const healthy = () => addRun(7);

  const kinds = () => sent.map((n) => n.recordId.split(":")[0]);

  const scenarios: Array<[SyncCondition, () => Promise<void>]> = [
    ["no_recent_success", () => addRun(30)],
    [
      "latest_failed",
      async () => {
        await healthy();
        await addRun(1, {
          status: "failed",
          errorSummary: "boom",
          catalogSource: null,
          parserConfidence: null,
        });
      },
    ],
    [
      "latest_partial",
      async () => {
        await healthy();
        await addRun(1, { status: "partial" });
      },
    ],
    [
      "breaker_open",
      async () => {
        await healthy();
        await addRun(1, {
          circuitBreakerTripped: true,
          circuitBreakerReason: "mass_disappearance",
        });
      },
    ],
    [
      "source_fallback",
      async () => {
        await healthy();
        await addRun(1, { catalogSource: "listing_html" });
      },
    ],
    [
      "low_confidence",
      async () => {
        await healthy();
        await addRun(1, { parserConfidence: "0.700" });
      },
    ],
    [
      "image_failed",
      async () => {
        await healthy();
        await addRun(1, { imagesFailed: 2 });
      },
    ],
  ];

  it.each(scenarios)(
    "%s: one notification, none on the second run the same day",
    async (condition, seed) => {
      await seed();

      const first = await run();
      expect(sent).toHaveLength(1);
      expect(kinds()).toEqual([condition]);
      expect(first.sent).toBe(1);
      expect(first.conditions).toEqual([{ condition, outcome: "sent" }]);

      const second = await run();
      expect(sent).toHaveLength(1);
      expect(second.sent).toBe(0);
      expect(second.conditions).toEqual([{ condition, outcome: "already_sent_today" }]);
    },
  );

  it("an empty history is a missing success, once", async () => {
    await run();
    await run();
    expect(kinds()).toEqual(["no_recent_success"]);
  });

  it("a healthy history sends nothing and records nothing", async () => {
    await healthy();
    await addRun(1);
    const report = await run();
    expect(sent).toEqual([]);
    expect(report.conditions).toEqual([]);
    expect(await db.select().from(syncAlerts)).toEqual([]);
  });

  it("a run as the sync really records a trip yields one notification each for partial and breaker", async () => {
    await healthy();
    await addRun(1, { status: "partial", circuitBreakerTripped: true });
    await run();
    await run();
    expect(kinds().sort()).toEqual(["breaker_open", "latest_partial"]);
  });

  it("ignores dry runs", async () => {
    await healthy();
    await addRun(1, { status: "failed", dryRun: true });
    await run();
    expect(sent).toEqual([]);
  });

  it("alerts again the next day", async () => {
    const now = new Date();
    await run(now);
    await run(new Date(now.getTime() + 24 * 3_600_000));
    expect(kinds()).toEqual(["no_recent_success", "no_recent_success"]);
  });

  it("gives the slot back when delivery fails, so a retry the same day still sends", async () => {
    deliver = false;
    const failed = await run();
    expect(sent).toEqual([]);
    expect(failed.conditions).toEqual([
      { condition: "no_recent_success", outcome: "delivery_failed" },
    ]);
    expect(await db.select().from(syncAlerts)).toEqual([]);

    deliver = true;
    await run();
    expect(kinds()).toEqual(["no_recent_success"]);
  });

  it("two overlapping invocations send once", async () => {
    await Promise.all([run(), run(), run()]);
    expect(kinds()).toEqual(["no_recent_success"]);
  });

  it("carries a link target and a summary, not data", async () => {
    await run();
    const [notification] = sent;
    expect(notification?.kind).toBe("sync_alert");
    expect(notification?.subject).toMatch(/^Синхронизация: /);
    expect(notification?.recordId).toMatch(/^no_recent_success:\d{4}-\d{2}-\d{2}$/);
  });

  describe("the route", () => {
    const SECRET = "integration-secret";
    const call = async (authorization?: string) => {
      const { GET } = await import("@/app/api/cron/sync-health/route");
      return GET(
        new Request("https://example.test/api/cron/sync-health", {
          headers: authorization ? { authorization } : {},
        }),
      );
    };

    it("is a 404 with no secret, and does nothing", async () => {
      delete process.env.CRON_SECRET;
      expect((await call(`Bearer ${SECRET}`)).status).toBe(404);
      expect(sent).toEqual([]);
    });

    it("is a 401 with the wrong secret, and does nothing", async () => {
      process.env.CRON_SECRET = SECRET;
      expect((await call("Bearer wrong")).status).toBe(401);
      expect((await call()).status).toBe(401);
      expect(sent).toEqual([]);
    });

    it("reports what it did as JSON", async () => {
      process.env.CRON_SECRET = SECRET;
      const response = await call(`Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.sent).toBe(1);
      expect(body.conditions).toEqual([{ condition: "no_recent_success", outcome: "sent" }]);
      expect(sent).toHaveLength(1);
    });
  });
});
