import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { products, sourceSites, syncAlerts, syncChanges, syncRuns } from "@catalog/db/schema";
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

  /** A rename, as the sync records an update, in a run of its own that started `h` hours ago. */
  async function addRename(h: number, before: string, after: string, dryRun = false) {
    const [{ id: runId }] = (await db
      .insert(syncRuns)
      .values({
        sourceSiteId: siteId,
        status: "succeeded",
        startedAt: hoursAgo(h),
        completedAt: hoursAgo(h - 0.1),
        catalogSource: "filter_init",
        parserConfidence: "1.000",
        dryRun,
      })
      .returning({ id: syncRuns.id })) as [{ id: string }];
    await db.insert(syncChanges).values({
      syncRunId: runId,
      sourceKey: "/moreno-super-bar-1/::1kg",
      changeType: "updated",
      changedFields: ["currentPrice", "name", "semanticHash"],
      before: { name: before, currentPrice: "20.00" },
      after: { name: after, currentPrice: "25.00" },
      createdAt: hoursAgo(h),
    });
  }

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
    [
      "identity_changed",
      async () => {
        await healthy();
        await addRun(1);
        await addRename(1, "Moreno Espresso Bar 1 кг", "Moreno Super Bar 1 кг");
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

  it("does not name a rename older than the day the check covers, or one in a dry run", async () => {
    await healthy();
    await addRun(1);
    await addRename(30, "A", "B");
    await addRename(2, "C", "D", true);
    const report = await run();
    expect(report.conditions).toEqual([]);
    expect(sent).toEqual([]);
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

  /* --- Flavoured products nobody has classified ------------------------- */

  let serial = 0;
  async function addProduct(
    slug: string,
    over: Partial<typeof products.$inferInsert> = {},
  ): Promise<void> {
    serial += 1;
    await db.insert(products).values({
      sourceSiteId: siteId,
      sourceKey: `/p-${serial}/#16pc`,
      sourceUrl: `https://example.test/p-${serial}/`,
      sourcePath: `/p-${serial}/`,
      name: `Капсули ${slug}`,
      slug,
      semanticHash: `hash-${serial}`,
      status: "active",
      attributes: { aromas: "yes" },
      ...over,
    });
  }

  /** A healthy sync, an audited coffee that says „без кафе“, a drink filed as one, an unflagged pack. */
  async function flavouredCatalog(): Promise<void> {
    await healthy();
    await addRun(1);
    await addProduct("bianchi-hazelnut-aroma-espresso-kapsuli-dolce-gusto-16-br", {
      descriptionText: "Не можете без кафе сутрин? Еспресо с лешник.",
    });
    await addProduct("rema-caffe-matcha-kapsuli-dolce-gusto-16-br");
    await addProduct("new-plain-capsules-16", { attributes: { aromas: "no" } });
  }

  const flavouredMails = () => sent.filter((n) => n.recordId.startsWith("flavoured_unaudited:"));

  it("flavoured_unaudited: names a held-back product once, and never again for it", async () => {
    await flavouredCatalog();
    await addProduct("new-hazelnut-latte-16", {
      descriptionHtmlOverride: "<p>Без&nbsp;кафе: мляко и лешник.</p>",
    });

    const first = await run();
    expect(first.conditions).toEqual([{ condition: "flavoured_unaudited", outcome: "sent" }]);
    expect(first.sent).toBe(1);
    const [mail] = flavouredMails();
    expect(mail?.subject).toBe("Синхронизация: ароматизиран продукт за проверка");
    expect(mail?.summary).toContain("(new-hazelnut-latte-16) — описанието казва „Без кафе“");
    expect(mail?.summary).toContain("apps/web/content/no-coffee.ts");
    // Audited either way, or not flagged: not raised, whatever the words say.
    for (const slug of [
      "bianchi-hazelnut-aroma-espresso-kapsuli-dolce-gusto-16-br",
      "rema-caffe-matcha-kapsuli-dolce-gusto-16-br",
      "new-plain-capsules-16",
    ]) {
      expect(mail?.summary, slug).not.toContain(slug);
    }

    // The same day, and the next: the product is not news any more.
    const again = await run();
    expect(again.conditions).toEqual([
      { condition: "flavoured_unaudited", outcome: "already_raised" },
    ]);
    await run(new Date(Date.now() + 24 * 3_600_000));
    expect(flavouredMails()).toHaveLength(1);
  });

  it("flavoured_unaudited: a product found later is a new occurrence, mailed on its own", async () => {
    await flavouredCatalog();
    await addProduct("new-hazelnut-latte-16");
    await run();
    await addProduct("new-caramel-latte-16");
    // A day later the sync itself is stale too; that is its own condition.
    const later = await run(new Date(Date.now() + 24 * 3_600_000));
    expect(later.conditions).toContainEqual({ condition: "flavoured_unaudited", outcome: "sent" });
    const mails = flavouredMails();
    expect(mails).toHaveLength(2);
    expect(mails[1]?.summary).toContain("(new-caramel-latte-16)");
    expect(mails[1]?.summary).not.toContain("(new-hazelnut-latte-16)");
    expect(mails[1]?.summary).toContain("Още 1 от предишно известие също чака проверка.");
  });

  it("flavoured_unaudited: nothing to say while every flagged product is classified", async () => {
    await flavouredCatalog();
    const report = await run();
    expect(report.conditions).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("flavoured_unaudited: gives the products back when the mail does not go", async () => {
    await flavouredCatalog();
    await addProduct("new-hazelnut-latte-16");
    deliver = false;
    const failed = await run();
    expect(failed.conditions).toEqual([
      { condition: "flavoured_unaudited", outcome: "delivery_failed" },
    ]);
    expect(await db.select().from(syncAlerts)).toEqual([]);
    deliver = true;
    await run();
    expect(flavouredMails()).toHaveLength(1);
  });

  it("flavoured_unaudited: two overlapping checks name a product once", async () => {
    await flavouredCatalog();
    await addProduct("new-hazelnut-latte-16");
    await Promise.all([run(), run(), run()]);
    expect(flavouredMails()).toHaveLength(1);
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
