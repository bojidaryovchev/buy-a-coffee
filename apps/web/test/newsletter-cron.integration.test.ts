import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  brands,
  newsletterCampaigns,
  newsletterDeliveries,
  newsletterSubscribers,
  products,
  sourceSites,
  syncChanges,
  syncRuns,
} from "@catalog/db/schema";
import type { Database } from "@catalog/db";
// Types only: the modules are imported in `beforeAll`, once the test database is chosen.
import type * as Campaigns from "@/lib/newsletter/campaigns";
import type * as Cron from "@/lib/newsletter/cron";
import type * as Send from "@/lib/newsletter/send";
import type * as Route from "@/app/api/cron/newsletter/route";
import type { Notification } from "@/lib/notifications";
import type { BatchClient, BatchEmail, BatchResponse } from "@/lib/newsletter/batch";
import { sofiaMonthStart, sofiaPeriod } from "@/lib/newsletter/sofia";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * The newsletter's daily job against a real database: it prepares the month's
 * draft once — two runs at once make one draft and one notice to the owner —
 * and not at all when there is nothing to say, a letter already went out this
 * month, or the owner started one; a notice that fails leaves the draft
 * alone; and every send that stopped is picked up and finished, as the
 * panel's "Продължи" would, without mailing anybody twice. Nothing is ever
 * sent to the list that nobody started.
 *
 * Nothing reaches Resend: the sender is handed a stand-in client, and the
 * owner's notice a stand-in sink.
 */

vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("resend", () => ({
  Resend: class {
    batch = {
      send: () => {
        throw new Error("the cron test hands the sender its own client");
      },
    };
    emails = {
      send: () => {
        throw new Error("a test must not send single mail");
      },
    };
  },
}));

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

/** Delivers every copy, or refuses with a rate limit from the `refuseFrom`-th request on. */
class Inbox implements BatchClient {
  delivered: BatchEmail[] = [];
  requests = 0;
  constructor(private readonly refuseFrom = Number.POSITIVE_INFINITY) {}
  async send(emails: BatchEmail[]): Promise<BatchResponse> {
    this.requests += 1;
    if (this.requests >= this.refuseFrom) {
      return {
        data: null,
        error: { name: "rate_limit_exceeded", message: "slow down", statusCode: 429 },
      };
    }
    this.delivered.push(...emails);
    return {
      data: emails.map((_, index) => ({ id: `re_${this.requests}_${index}` })),
      error: null,
    };
  }
}

suite("the newsletter's daily job (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let campaigns: typeof Campaigns;
  let cron: typeof Cron;
  let send: typeof Send;
  let route: typeof Route;
  let siteId: string;
  let brandId: string;
  const notices: Notification[] = [];
  let failNotices = false;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("newsletter_cron"));
    campaigns = await import("@/lib/newsletter/campaigns");
    cron = await import("@/lib/newsletter/cron");
    send = await import("@/lib/newsletter/send");
    route = await import("@/app/api/cron/newsletter/route");
    const { setNotificationSink } = await import("@/lib/notifications");
    setNotificationSink({
      name: "test",
      async send(notification) {
        if (failNotices) throw new Error("Resend is down");
        notices.push(notification);
      },
    });
  });

  afterAll(async () => {
    delete process.env.CRON_SECRET;
    await close?.();
  });

  beforeEach(async () => {
    notices.length = 0;
    failNotices = false;
    delete process.env.RESEND_API_KEY;
    await db.execute(
      sql`truncate table newsletter_deliveries, newsletter_campaigns, newsletter_subscribers, sync_changes, sync_runs, products, brands, source_sites restart identity cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "cron-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
    const [brand] = await db
      .insert(brands)
      .values({ sourceSiteId: siteId, sourceKey: "lavazza", name: "Lavazza", slug: "lavazza" })
      .returning({ id: brands.id });
    brandId = brand!.id;
  });

  /** A product that arrived `daysOld` days ago (or at an instant) with an ordinary sync run. */
  const arrival = async (slug: string, daysOld: number | Date = 2) => {
    const [row] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceKey: `/${slug}/`,
        sourceUrl: `https://example.test/${slug}/`,
        sourcePath: `/${slug}/`,
        semanticHash: slug,
        slug,
        name: `Кафе на зърна Lavazza ${slug} 1кг.`,
        brandId,
        currentPrice: "20.00",
        currency: "EUR",
        status: "active",
        availability: "in_stock",
        firstSeenAt: daysOld instanceof Date ? daysOld : new Date(Date.now() - daysOld * DAY),
      })
      .returning({ id: products.id });
    const [run] = await db
      .insert(syncRuns)
      .values({ sourceSiteId: siteId, status: "succeeded" })
      .returning({ id: syncRuns.id });
    await db.insert(syncChanges).values({
      syncRunId: run!.id,
      productId: row!.id,
      sourceKey: `/${slug}/`,
      changeType: "created",
    });
  };

  const subscribe = async (count: number) => {
    await db.insert(newsletterSubscribers).values(
      Array.from({ length: count }, (_, index) => ({
        email: `reader${String(index).padStart(3, "0")}@example.test`,
      })),
    );
  };

  const all = () => db.select().from(newsletterCampaigns);
  const run = (options: Cron.CronOptions = {}) => cron.runNewsletterCron(new Date(), options);

  describe("the month's draft", () => {
    it("is made once however many runs meet, and the owner is told once", async () => {
      await arrival("nov");
      const reports = await Promise.all([run(), run(), run()]);

      const rows = await all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: "draft",
        template: "monthly",
        autoPeriod: sofiaPeriod(new Date()),
      });
      expect(rows[0]!.body).toContain("[[продукти: nov]]");
      expect(reports.map((report) => report.draftsCreated).sort()).toEqual([0, 0, 1]);
      expect(reports.filter((report) => report.draft === "exists")).toHaveLength(2);

      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ kind: "newsletter_draft", recordId: rows[0]!.id });
      expect(notices[0]!.summary).toContain("1 нов продукт");

      // Tomorrow, and the day after: nothing more.
      expect((await run()).draft).toBe("exists");
      expect(await all()).toHaveLength(1);
      expect(notices).toHaveLength(1);
    });

    it("stays thrown away when the owner deletes it: the month is not prepared again", async () => {
      await arrival("nov");
      await run();
      const [draft] = await all();
      expect(await campaigns.deleteDraft(draft!.id)).toBe(true);
      // Out of every list and page, emptied, and still the month's claim.
      expect(await campaigns.listCampaigns()).toEqual([]);
      expect(await campaigns.getCampaign(draft!.id)).toMatchObject({
        status: "dismissed",
        body: "",
        autoPeriod: sofiaPeriod(new Date()),
      });
      expect(await campaigns.duplicateCampaign(draft!.id)).toBeNull();
      expect(await campaigns.newsletterNextStep()).toBeNull();

      expect((await run()).draft).toBe("exists");
      expect(notices).toHaveLength(1);
      expect(await all()).toHaveLength(1);

      // A draft the owner started is deleted outright, as before.
      const own = await campaigns.createDraft({ subject: "Моят" });
      expect(await campaigns.deleteDraft(own)).toBe(true);
      expect(await campaigns.getCampaign(own)).toBeNull();
    });

    it("is not made when there is nothing new and nothing reduced", async () => {
      const report = await run();
      expect(report).toMatchObject({ draft: "nothing_new", draftsCreated: 0, ownerNotified: 0 });
      expect(await all()).toHaveLength(0);
      expect(notices).toHaveLength(0);
    });

    it("is not made when a letter already went out this month, or the owner started one", async () => {
      await arrival("nov");
      const [sent] = await db
        .insert(newsletterCampaigns)
        .values({ subject: "Вече", body: "Текст", status: "sent", startedAt: new Date() })
        .returning({ id: newsletterCampaigns.id });
      expect((await run()).draft).toBe("sent_this_month");

      await db.delete(newsletterCampaigns).where(eq(newsletterCampaigns.id, sent!.id));
      await campaigns.createDraft({ subject: "Моят", template: "monthly" });
      expect((await run()).draft).toBe("owner_draft");
      expect(await all()).toHaveLength(1);
      expect(notices).toHaveLength(0);
    });

    it("keeps the draft when the notice cannot be delivered, and does not make it again", async () => {
      await arrival("nov");
      failNotices = true;
      const report = await run();
      expect(report).toMatchObject({ draft: "created", draftsCreated: 1, ownerNotified: 0 });
      failNotices = false;
      expect((await run()).draft).toBe("exists");
      expect(await all()).toHaveLength(1);
    });

    it("counts what is new since the last letter", async () => {
      // The last letter went out the day before this month began.
      const monthStart = sofiaMonthStart(new Date());
      const lastLetter = new Date(monthStart.getTime() - DAY);
      await db.insert(newsletterCampaigns).values({
        subject: "Миналия месец",
        body: "Текст",
        status: "sent",
        startedAt: lastLetter,
      });
      await arrival("predi", new Date(lastLetter.getTime() - DAY));
      await arrival("sled", new Date(monthStart.getTime() - 12 * 60 * 60 * 1000));
      expect((await run()).draft).toBe("created");
      const draft = (await all()).find((row) => row.autoPeriod !== null)!;
      expect(draft.body).toContain("[[продукти: sled]]");
      expect(draft.body).not.toContain("predi");
    });

    it("never sends anything to the list", async () => {
      await arrival("nov");
      await subscribe(3);
      const inbox = new Inbox();
      await run({ client: inbox });
      expect(inbox.delivered).toHaveLength(0);
      expect(await db.select().from(newsletterDeliveries)).toHaveLength(0);
      expect((await all())[0]!.status).toBe("draft");
    });
  });

  describe("a send that stopped", () => {
    const startedCampaign = async (subscribers: number) => {
      await subscribe(subscribers);
      const id = await campaigns.createDraft({
        subject: "Новите кафета",
        body: "Здравейте,\n\nНови кафета.",
      });
      expect(await campaigns.startCampaign(id, subscribers)).toEqual({
        ok: true,
        recipients: subscribers,
      });
      return id;
    };

    it("is picked up and finished, and nobody gets the letter twice", async () => {
      const id = await startedCampaign(150);
      const first = new Inbox(2);
      await send.runCampaign(id, { client: first, sleep: async () => {} });
      expect((await campaigns.getCampaign(id))!.status).toBe("partial");

      const second = new Inbox();
      const report = await run({ client: second });
      expect(report).toMatchObject({ resumed: 1, resumeSkipped: 0 });
      expect((await campaigns.getCampaign(id))!.status).toBe("sent");
      const everyone = [...first.delivered, ...second.delivered].map((email) => email.to);
      expect(everyone).toHaveLength(150);
      expect(new Set(everyone).size).toBe(150);

      // Done is done: the next day finds nothing to pick up.
      expect(await run({ client: new Inbox() })).toMatchObject({ resumed: 0, resumeSkipped: 0 });
    });

    it("picks up a send whose sender vanished, and leaves one that is still going", async () => {
      const stale = await startedCampaign(2);
      await db
        .update(newsletterCampaigns)
        .set({ updatedAt: new Date(Date.now() - 11 * 60 * 1000) })
        .where(eq(newsletterCampaigns.id, stale));
      const inbox = new Inbox();
      expect(await run({ client: inbox })).toMatchObject({ resumed: 1 });
      expect(inbox.delivered).toHaveLength(2);
      expect((await campaigns.getCampaign(stale))!.status).toBe("sent");

      // A send that wrote its heartbeat a minute ago is somebody else's.
      await db.execute(
        sql`truncate table newsletter_deliveries, newsletter_campaigns, newsletter_subscribers cascade`,
      );
      const live = await startedCampaign(2);
      expect(await run({ client: new Inbox() })).toMatchObject({ resumed: 0, resumeSkipped: 0 });
      expect((await campaigns.getCampaign(live))!.status).toBe("sending");
    });

    it("waits without a key, and says how many", async () => {
      const id = await startedCampaign(150);
      await send.runCampaign(id, { client: new Inbox(2), sleep: async () => {} });
      expect(await run()).toMatchObject({ resumed: 0, resumeSkipped: 1 });
      expect((await campaigns.getCampaign(id))!.status).toBe("partial");
    });

    it("starts no resume it has no time left for", async () => {
      const id = await startedCampaign(150);
      await send.runCampaign(id, { client: new Inbox(2), sleep: async () => {} });
      expect(await run({ client: new Inbox(), budgetMs: 5_000 })).toMatchObject({
        resumed: 0,
        resumeSkipped: 1,
      });
      expect((await campaigns.getCampaign(id))!.status).toBe("partial");
    });
  });

  describe("the route", () => {
    it("does not exist without a secret, refuses a wrong one, and answers in counts", async () => {
      delete process.env.CRON_SECRET;
      const ask = (authorization?: string) =>
        route.GET(
          new Request("http://localhost/api/cron/newsletter", {
            headers: authorization ? { authorization } : {},
          }),
        );
      expect((await ask("Bearer x")).status).toBe(404);
      process.env.CRON_SECRET = "cron-test-secret";
      expect((await ask("Bearer wrong")).status).toBe(401);

      await arrival("nov");
      const answer = await ask("Bearer cron-test-secret");
      expect(answer.status).toBe(200);
      const body = (await answer.json()) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(
        ["checkedAt", "draft", "draftsCreated", "ownerNotified", "resumeSkipped", "resumed"].sort(),
      );
      expect(body).toMatchObject({ draft: "created", draftsCreated: 1, ownerNotified: 1 });
      // Counts and words, nothing of the letter or the list.
      expect(JSON.stringify(body)).not.toMatch(/nov|@|[0-9a-f]{8}-[0-9a-f]{4}/);
    });
  });
});
