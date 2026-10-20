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
 * draft once, in the month's first week — two runs at once make one draft and
 * one notice to the owner — and not at all after the 7th, when there is
 * nothing to say, a letter already went out this month, or the owner started
 * one; a notice that fails leaves the draft alone. A send that stopped for a
 * reason another run gets past, within 23 hours of its start, is picked up
 * and finished without mailing anybody twice; one stopped by the account, or
 * started long ago, waits for the owner, who can also end it ("Спри
 * изпращането"). Nothing is ever sent to the list that nobody started.
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
  /** The 3rd of this Sofia month, 09:00 there: inside the week the draft is made in. */
  const firstWeek = () =>
    new Date(sofiaMonthStart(new Date()).getTime() + 2 * DAY + 7 * 60 * 60 * 1000);
  const run = (options: Cron.CronOptions = {}, now = firstWeek()) =>
    cron.runNewsletterCron(now, options);

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
      // Started weeks ago and still waiting: the month's letter is coming.
      const own = await campaigns.createDraft({ subject: "Моят", template: "monthly" });
      await db
        .update(newsletterCampaigns)
        .set({ createdAt: new Date(Date.now() - 40 * DAY) })
        .where(eq(newsletterCampaigns.id, own));
      expect((await run()).draft).toBe("owner_draft");
      expect(await all()).toHaveLength(1);
      expect(notices).toHaveLength(0);
    });

    it("is not made after the month's first week: a run on the 21st makes no draft", async () => {
      await arrival("nov");
      const the21st = new Date(
        sofiaMonthStart(new Date()).getTime() + 20 * DAY + 7 * 60 * 60 * 1000,
      );
      expect(await run({}, the21st)).toMatchObject({ draft: "not_first_week", draftsCreated: 0 });
      // And the 7th still does.
      const the7th = new Date(
        sofiaMonthStart(new Date()).getTime() + 6 * DAY + 20 * 60 * 60 * 1000,
      );
      expect((await run({}, the7th)).draft).toBe("created");
      expect(await all()).toHaveLength(1);
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

    it("keeps the plan it was written from: when it was prepared, and the promotions it names", async () => {
      await arrival("nov");
      const now = firstWeek();
      await run({}, now);
      const [draft] = await all();
      expect(draft!.attachments).toEqual([
        expect.objectContaining({
          kind: "letter-plan",
          preparedAt: now.toISOString(),
          promotionIds: [],
        }),
      ]);
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

    it("leaves a send that started long ago to the owner: a 180-day-old partial is not resumed", async () => {
      const id = await startedCampaign(150);
      await send.runCampaign(id, { client: new Inbox(2), sleep: async () => {} });
      await db
        .update(newsletterCampaigns)
        .set({ startedAt: new Date(Date.now() - 180 * DAY) })
        .where(eq(newsletterCampaigns.id, id));
      const inbox = new Inbox();
      expect(await run({ client: inbox })).toMatchObject({ resumed: 0, awaitingOwner: 1 });
      expect(inbox.requests).toBe(0);
      expect((await campaigns.getCampaign(id))!.status).toBe("partial");
    });

    it("leaves a send the account stopped to the owner, whose Продължи still works", async () => {
      const id = await startedCampaign(3);
      const refusing: BatchClient = {
        async send() {
          return {
            data: null,
            error: { name: "invalid_api_key", message: "API key is invalid", statusCode: 401 },
          };
        },
      };
      await send.runCampaign(id, { client: refusing, sleep: async () => {} });
      const stopped = (await campaigns.getCampaign(id))!;
      expect(stopped.status).toBe("partial");
      expect(stopped.attachments).toContainEqual(
        expect.objectContaining({ kind: "run-stop", cause: "account" }),
      );
      const inbox = new Inbox();
      expect(await run({ client: inbox })).toMatchObject({ resumed: 0, awaitingOwner: 1 });
      expect(inbox.requests).toBe(0);

      // The owner fixed the key and presses "Продължи": as before.
      expect(await campaigns.claimResume(id)).toBe(true);
      await send.runCampaign(id, { client: inbox, sleep: async () => {} });
      expect((await campaigns.getCampaign(id))!.status).toBe("sent");
      expect(inbox.delivered).toHaveLength(3);
      // Done: the stop is forgotten with it.
      expect(
        (await campaigns.getCampaign(id))!.attachments.some((entry) => entry.kind === "run-stop"),
      ).toBe(false);
    });

    it("leaves a send whose own products stopped it to the owner", async () => {
      const id = await startedCampaign(2);
      await db
        .update(newsletterCampaigns)
        .set({ body: "Здравейте,\n\n[[промоций]]" })
        .where(eq(newsletterCampaigns.id, id));
      expect(
        (await send.runCampaign(id, { client: new Inbox(), sleep: async () => {} })).status,
      ).toBe("stopped");
      expect((await campaigns.getCampaign(id))!.attachments).toContainEqual(
        expect.objectContaining({ kind: "run-stop", cause: "products" }),
      );
      expect(await run({ client: new Inbox() })).toMatchObject({ resumed: 0, awaitingOwner: 1 });
    });

    it("is ended by the owner's Спри: nobody waiting gets it, and the record says so", async () => {
      const id = await startedCampaign(150);
      const first = new Inbox(2);
      await send.runCampaign(id, { client: first, sleep: async () => {} });
      expect(first.delivered).toHaveLength(100);
      // One copy was handed over and its answer lost: it may have arrived.
      const [inFlight] = await db
        .select({ id: newsletterDeliveries.id })
        .from(newsletterDeliveries)
        .where(eq(newsletterDeliveries.status, "pending"))
        .limit(1);
      await db
        .update(newsletterDeliveries)
        .set({ status: "sending", batchKey: "newsletter/x/one/y", attemptedAt: new Date() })
        .where(eq(newsletterDeliveries.id, inFlight!.id));

      expect(await send.stopRun(id)).toBe(true);
      const rows = await db
        .select({ status: newsletterDeliveries.status, error: newsletterDeliveries.error })
        .from(newsletterDeliveries)
        .where(eq(newsletterDeliveries.campaignId, id));
      const by = (status: string) => rows.filter((row) => row.status === status);
      expect(by("sent")).toHaveLength(100);
      expect(by("skipped")).toHaveLength(49);
      expect(by("failed")).toEqual([
        expect.objectContaining({
          error: expect.stringMatching(/^Изпращането беше спряно, докато/),
        }),
      ]);
      expect(by("pending").length + by("sending").length).toBe(0);
      const ended = (await campaigns.getCampaign(id))!;
      expect(ended).toMatchObject({ status: "partial", sentCount: 100, failedCount: 1 });
      expect(ended.lastError).toMatch(/^Изпращането е спряно\. 49 писма не бяха изпратени/);
      expect(ended.sentAt).toBeInstanceOf(Date);
      // Nothing left to resume, and nothing left to stop.
      expect(await run({ client: new Inbox() })).toMatchObject({ resumed: 0, awaitingOwner: 0 });
      expect(await send.stopRun(id)).toBe(false);
    });

    it("refuses Спри for a send that is still going", async () => {
      const id = await startedCampaign(2);
      expect(await send.stopRun(id)).toBe(false);
      expect((await campaigns.getCampaign(id))!.status).toBe("sending");
    });

    it("shows the owner every send that waits, not only the newest", async () => {
      const waiting = await startedCampaign(150);
      await send.runCampaign(waiting, { client: new Inbox(2), sleep: async () => {} });
      // A newer one that ended partial with failures only: nothing waits on it.
      const [newer] = await db
        .insert(newsletterCampaigns)
        .values({
          subject: "По-нов",
          body: "Текст",
          status: "partial",
          startedAt: new Date(Date.now() + 60_000),
        })
        .returning({ id: newsletterCampaigns.id });
      expect(newer).toBeTruthy();
      expect(await campaigns.newsletterNextStep()).toMatchObject({ kind: "stalled", id: waiting });
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

  describe("one step failing", () => {
    it("does not keep the other from running, and is counted", async () => {
      const id = await (async () => {
        await subscribe(150);
        const created = await campaigns.createDraft({ subject: "Т", body: "Текст." });
        await campaigns.startCampaign(created, 150);
        return created;
      })();
      await send.runCampaign(id, { client: new Inbox(2), sleep: async () => {} });
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      // A date the calendar cannot read: the draft step fails; the resume still runs.
      const report = await cron.runNewsletterCron(new Date(Number.NaN), { client: new Inbox() });
      expect(report).toMatchObject({ draft: "error", errors: 1, resumed: 1 });
      expect(errors.mock.calls.flat().join(" ")).toContain("newsletter.cron.draft_failed");
      errors.mockRestore();
      expect((await campaigns.getCampaign(id))!.status).toBe("sent");
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
        [
          "awaitingOwner",
          "checkedAt",
          "draft",
          "draftsCreated",
          "errors",
          "ownerNotified",
          "resumeSkipped",
          "resumed",
        ].sort(),
      );
      expect(body).toMatchObject({ errors: 0 });
      // Counts and words, nothing of the letter or the list.
      expect(JSON.stringify(body)).not.toMatch(/nov|@|[0-9a-f]{8}-[0-9a-f]{4}/);
    });
  });
});
