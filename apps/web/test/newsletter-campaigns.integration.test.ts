import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import {
  newsletterCampaigns,
  newsletterDeliveries,
  newsletterSubscribers,
} from "@catalog/db/schema";
import { createDatabase, type Database } from "@catalog/db";
// Types only: the modules are imported in `beforeAll`, once the test database is chosen.
import type * as Actions from "@/lib/newsletter/actions";
import type * as Campaigns from "@/lib/newsletter/campaigns";
import type * as Send from "@/lib/newsletter/send";
import type * as SyncModule from "@/lib/newsletter/sync";
import type { Resend } from "resend";
import type * as UnsubscribeRoute from "@/app/api/newsletter/unsubscribe/route";
import type { BatchClient, BatchEmail, BatchResponse } from "@/lib/newsletter/batch";
import { isDatabaseAvailable, runMigrationFile, useTestDatabase } from "./helpers/test-db";

/**
 * The newsletter, from a draft to every subscriber's copy, against a real
 * database and a stand-in for Resend that behaves like Resend where it
 * matters here: it delivers, it remembers an idempotency key and answers a
 * repeat from memory, and it refuses a different payload under a used key.
 *
 * Nothing here reaches Resend: the SDK is replaced, and the key is not a key.
 * What is pinned is the promise of `lib/newsletter/send.ts` — every active
 * subscriber gets exactly one copy, through interruptions, refusals and
 * resumes — and the one-click unsubscribe endpoint every copy names.
 */

/* -- Resend, as far as the sender can tell ---------------------------------- */

/**
 * What the stand-in does with a request it has not seen the key of before:
 * deliver it; deliver it and lose the answer; lose it before it arrives
 * ("drop"); or answer with a refusal. The second argument counts every
 * request made, from 0.
 */
type Behaviour = (
  emails: BatchEmail[],
  call: number,
) => "deliver" | "deliver-then-drop" | "drop" | BatchResponse;

class FakeResend implements BatchClient {
  /** Every copy that reached an inbox, in order. */
  delivered: { to: string; key: string; email: BatchEmail }[] = [];
  requests: { key: string; count: number }[] = [];
  private memory = new Map<string, { payload: string; ids: string[] }>();
  private next = 0;
  constructor(public behaviour: Behaviour = () => "deliver") {}

  async send(emails: BatchEmail[], { idempotencyKey: key }: { idempotencyKey: string }) {
    const call = this.requests.length;
    this.requests.push({ key, count: emails.length });
    const payload = JSON.stringify(emails);
    const remembered = this.memory.get(key);
    if (remembered) {
      if (remembered.payload !== payload) {
        return refusal("invalid_idempotent_request", 409);
      }
      return { data: remembered.ids.map((id) => ({ id })), error: null };
    }
    const decision = this.behaviour(emails, call);
    if (typeof decision === "object") return decision;
    if (decision === "drop") return refusal("application_error", null);
    const ids = emails.map(() => `re_${(this.next += 1)}`);
    for (const email of emails) this.delivered.push({ to: email.to, key, email });
    this.memory.set(key, { payload, ids });
    if (decision === "deliver-then-drop") return refusal("application_error", null);
    return { data: ids.map((id) => ({ id })), error: null };
  }

  copiesTo(address: string): number {
    return this.delivered.filter((copy) => copy.to === address).length;
  }
}

function refusal(name: string, statusCode: number | null): BatchResponse {
  return { data: null, error: { name, statusCode, message: name }, headers: null };
}

/* -- the framework, stood in for -------------------------------------------- */

const harness = vi.hoisted(() => ({
  after: [] as (() => Promise<void>)[],
  resend: null as unknown as { send: BatchClient["send"] },
}));

vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => harness.after.push(task),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth", () => ({ isSignedIn: async () => true }));
/* The copy into Resend after the response is not under test here; the repair
   that runs in the request (`resync.ts`) is, against a stand-in client. */
vi.mock("@/lib/newsletter/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof SyncModule>()),
  syncSubscribedLater: vi.fn(),
  syncUnsubscribedLater: vi.fn(),
}));
/* The SDK's own shape: `{ data: { data: [{ id }] }, error, headers }`. */
vi.mock("resend", () => ({
  Resend: class {
    batch = {
      send: async (emails: BatchEmail[], options: { idempotencyKey: string }) => {
        const answer = await harness.resend.send(emails, options);
        return {
          data: answer.data ? { data: answer.data } : null,
          error: answer.error,
          headers: answer.headers ?? null,
        };
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

suite("newsletter campaigns (integration)", () => {
  let db: Database;
  let url: string;
  let close: () => Promise<void>;
  let actions: typeof Actions;
  let campaigns: typeof Campaigns;
  let send: typeof Send;
  let route: typeof UnsubscribeRoute;

  beforeAll(async () => {
    process.env.RESEND_API_KEY = "re_test_not_a_real_key";
    // Configured, to show the send does not use it.
    process.env.RESEND_NEWSLETTER_TOPIC_ID = "topic-buy-a-coffee";
    ({ db, url, close } = await useTestDatabase("newsletter_campaigns"));
    actions = await import("@/lib/newsletter/actions");
    campaigns = await import("@/lib/newsletter/campaigns");
    send = await import("@/lib/newsletter/send");
    route = await import("@/app/api/newsletter/unsubscribe/route");
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    harness.after.length = 0;
    await db.execute(
      sql`truncate table newsletter_deliveries, newsletter_campaigns, newsletter_subscribers restart identity cascade`,
    );
  });

  const subscribe = async (count: number, prefix = "reader") => {
    const rows = Array.from({ length: count }, (_, index) => ({
      email: `${prefix}${String(index).padStart(3, "0")}@example.test`,
      consentSource: "footer",
    }));
    for (const part of [rows.slice(0, 500), rows.slice(500)]) {
      if (part.length > 0) await db.insert(newsletterSubscribers).values(part);
    }
    return rows.map((row) => row.email);
  };

  const draft = async (subject = "Новите кафета") => {
    const id = await campaigns.createDraft();
    await campaigns.saveDraft(id, {
      subject,
      preheader: "Две нови марки.",
      body: "Здравейте,\n\nВ магазина има **нови** кафета.",
      attachments: [],
    });
    return id;
  };

  const started = async (subscribers: number) => {
    const id = await draft();
    const outcome = await campaigns.startCampaign(id, subscribers);
    expect(outcome).toEqual({ ok: true, recipients: subscribers });
    return id;
  };

  const run = (id: string, client: BatchClient, extra: Partial<Send.RunOptions> = {}) =>
    send.runCampaign(id, { client, sleep: async () => {}, ...extra });

  const deliveries = (id: string) =>
    db
      .select()
      .from(newsletterDeliveries)
      .where(eq(newsletterDeliveries.campaignId, id))
      .orderBy(asc(newsletterDeliveries.email));

  const campaign = async (id: string) => (await campaigns.getCampaign(id))!;
  const versionOf = async (id: string) => campaigns.draftVersion(await campaign(id));

  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  describe("from the composer", () => {
    it("saves, starts after the answer, and gives every active subscriber one copy", async () => {
      const addresses = await subscribe(3);
      await db.insert(newsletterSubscribers).values({
        email: "left@example.test",
        unsubscribedAt: new Date(),
      });
      const fake = new FakeResend();
      harness.resend = fake;
      const id = await campaigns.createDraft();

      const answer = actions.submitNewsletter(
        {},
        form({
          id,
          version: await versionOf(id),
          intent: "send",
          subject: "Новите кафета",
          preheader: "",
          body: "Здравейте,\n\n**Нови** кафета.",
          attachments: "[]",
          confirmCount: "3",
        }),
      );
      await expect(answer).rejects.toThrow(`REDIRECT /admin/byuletin/${id}`);

      // The request has its answer; nothing has been sent yet.
      expect(fake.delivered).toHaveLength(0);
      expect((await campaign(id)).status).toBe("sending");
      expect(harness.after).toHaveLength(1);

      await harness.after[0]!();

      expect(fake.delivered.map((copy) => copy.to).sort()).toEqual(addresses);
      expect(fake.copiesTo("left@example.test")).toBe(0);

      const rows = await deliveries(id);
      expect(rows.map((row) => row.status)).toEqual(["sent", "sent", "sent"]);
      expect(rows.every((row) => row.resendEmailId?.startsWith("re_"))).toBe(true);

      const done = await campaign(id);
      expect(done).toMatchObject({
        status: "sent",
        recipientCount: 3,
        sentCount: 3,
        failedCount: 0,
      });
      expect(done.sentAt).toBeInstanceOf(Date);

      // Each copy: its reader's own one-click link, the campaign tag, and no topic.
      const tokens = await db
        .select({
          email: newsletterSubscribers.email,
          token: newsletterSubscribers.unsubscribeToken,
        })
        .from(newsletterSubscribers);
      for (const copy of fake.delivered) {
        const token = tokens.find((row) => row.email === copy.to)!.token;
        expect(copy.email.headers["List-Unsubscribe"]).toContain(
          `/api/newsletter/unsubscribe?token=${token}`,
        );
        expect(copy.email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
        expect(copy.email.html).toContain(`otpisvane?token=${token}`);
        expect(Object.keys(copy.email)).not.toContain("topicId");
        expect(copy.email.tags).toContainEqual({ name: "campaign", value: id });
      }
    });

    it("starts nothing when the list changed since the confirmation", async () => {
      await subscribe(3);
      const id = await campaigns.createDraft();
      const answer = await actions.submitNewsletter(
        {},
        form({
          id,
          version: await versionOf(id),
          intent: "send",
          subject: "Тема",
          preheader: "",
          body: "Текст",
          attachments: "[]",
          confirmCount: "2",
        }),
      );
      expect(answer.error).toMatch(/вече са 3/);
      expect((await campaign(id)).status).toBe("draft");
      expect(await deliveries(id)).toHaveLength(0);
      expect(harness.after).toHaveLength(0);
    });

    it("refuses to send an empty newsletter, and to edit one that went out", async () => {
      await subscribe(1);
      const id = await campaigns.createDraft();
      const empty = await actions.submitNewsletter(
        {},
        form({
          id,
          version: await versionOf(id),
          intent: "send",
          subject: "",
          preheader: "",
          body: "",
          attachments: "[]",
          confirmCount: "1",
        }),
      );
      expect(empty.fieldErrors).toMatchObject({
        subject: expect.any(String),
        body: expect.any(String),
      });

      await campaigns.saveDraft(id, {
        subject: "Тема",
        preheader: "",
        body: "Текст",
        attachments: [],
      });
      await campaigns.startCampaign(id, 1);
      expect(
        await campaigns.saveDraft(id, {
          subject: "Друга",
          preheader: "",
          body: "x",
          attachments: [],
        }),
      ).toEqual({ ok: false, reason: "not_draft" });
      expect(await campaigns.deleteDraft(id)).toBe(false);
    });
  });

  describe("sending", () => {
    it("sends in requests of at most a hundred", async () => {
      await subscribe(205);
      const id = await started(205);
      const fake = new FakeResend();
      const report = await run(id, fake);

      expect(report).toMatchObject({ status: "done", requests: 3 });
      expect(fake.requests.map((request) => request.count)).toEqual([100, 100, 5]);
      expect(new Set(fake.delivered.map((copy) => copy.to)).size).toBe(205);
      expect(await campaign(id)).toMatchObject({ status: "sent", sentCount: 205 });
    });

    it("skips whoever left the list after the snapshot", async () => {
      const [first, second] = await subscribe(2);
      const id = await started(2);
      await db
        .update(newsletterSubscribers)
        .set({ unsubscribedAt: new Date() })
        .where(eq(newsletterSubscribers.email, second!));

      const fake = new FakeResend();
      await run(id, fake);

      expect(fake.delivered.map((copy) => copy.to)).toEqual([first]);
      const rows = await deliveries(id);
      expect(rows.find((row) => row.email === second)).toMatchObject({ status: "skipped" });
      expect(await campaign(id)).toMatchObject({ status: "sent", sentCount: 1, failedCount: 0 });
    });

    it("finds the one address a request was refused for, and sends the rest", async () => {
      const addresses = await subscribe(4);
      const bad = addresses[2]!;
      const id = await started(4);
      const fake = new FakeResend((emails) =>
        emails.some((email) => email.to === bad) ? refusal("validation_error", 422) : "deliver",
      );

      await run(id, fake);

      expect(fake.copiesTo(bad)).toBe(0);
      for (const address of addresses.filter((a) => a !== bad))
        expect(fake.copiesTo(address)).toBe(1);
      const rows = await deliveries(id);
      expect(rows.find((row) => row.email === bad)).toMatchObject({ status: "failed" });
      expect(await campaign(id)).toMatchObject({ status: "partial", sentCount: 3, failedCount: 1 });
    });

    it("stops on a refusal of the account, keeps everybody waiting, and continues later", async () => {
      const addresses = await subscribe(3);
      const id = await started(3);

      const refusing = new FakeResend(() => refusal("invalid_api_key", 403));
      const report = await run(id, refusing);
      expect(report.status).toBe("stopped");
      expect(refusing.delivered).toHaveLength(0);
      expect((await deliveries(id)).map((row) => row.status)).toEqual([
        "pending",
        "pending",
        "pending",
      ]);
      const stopped = await campaign(id);
      expect(stopped.status).toBe("partial");
      expect(stopped.lastError).toMatch(/invalid_api_key/);

      expect(await campaigns.claimResume(id)).toBe(true);
      // A second press while the first resume is running starts nothing.
      expect(await campaigns.claimResume(id)).toBe(false);
      const working = new FakeResend();
      await run(id, working);
      expect(working.delivered.map((copy) => copy.to).sort()).toEqual(addresses);
      expect(await campaign(id)).toMatchObject({ status: "sent", sentCount: 3 });
    });
  });

  describe("resuming", () => {
    it("never sends twice when the answer to a delivered request was lost", async () => {
      const addresses = await subscribe(150);
      const id = await started(150);

      /* The first request reaches Resend and its answer is lost; the function
         is then killed while it waits to retry. */
      const fake = new FakeResend(() => "deliver-then-drop");
      const killed = run(id, fake, {
        sleep: async () => {
          throw new Error("function killed");
        },
      });
      await expect(killed).rejects.toThrow("function killed");
      expect(fake.delivered).toHaveLength(100);

      const inFlight = (await deliveries(id)).filter((row) => row.status === "sending");
      expect(inFlight).toHaveLength(100);
      const firstKey = inFlight[0]!.batchKey;
      expect(inFlight.every((row) => row.batchKey === firstKey)).toBe(true);

      // Still "sending" with no heartbeat: only a stale campaign may be resumed.
      expect(await campaigns.claimResume(id)).toBe(false);
      expect(await campaigns.claimResume(id, new Date(Date.now() + 11 * 60 * 1000))).toBe(true);

      // Resend works again, and remembers the key.
      fake["behaviour"] = () => "deliver";
      const report = await run(id, fake);
      expect(report.status).toBe("done");

      for (const address of addresses) expect(fake.copiesTo(address), address).toBe(1);
      // The lost request was asked again under its own key and answered from memory.
      expect(fake.requests.filter((request) => request.key === firstKey)).toHaveLength(2);
      expect(await campaign(id)).toMatchObject({ status: "sent", sentCount: 150, failedCount: 0 });
    });

    it("does not resend a request older than Resend's memory of its key", async () => {
      const [address] = await subscribe(1);
      const id = await started(1);
      await db
        .update(newsletterDeliveries)
        .set({
          status: "sending",
          batchKey: "newsletter/old/key",
          attemptedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        })
        .where(eq(newsletterDeliveries.campaignId, id));

      const fake = new FakeResend();
      await run(id, fake);

      expect(fake.copiesTo(address!)).toBe(0);
      expect((await deliveries(id))[0]).toMatchObject({
        status: "failed",
        error: send.UNKNOWN_OUTCOME,
      });
      expect(await campaign(id)).toMatchObject({ status: "failed", failedCount: 1 });
    });

    it("marks a campaign whose run died as stopped, so the panel offers to continue", async () => {
      await subscribe(1);
      const id = await started(1);
      await send.abandonRun(id, new Error("boom"));
      const stopped = await campaign(id);
      expect(stopped.status).toBe("partial");
      expect(stopped.lastError).toMatch(/boom/);
      expect(campaigns.isResumable(stopped, 1)).toBe(true);
      // A stopped campaign with nobody waiting has nothing to resume.
      expect(campaigns.isResumable(stopped, 0)).toBe(false);
    });
  });

  describe("one-click unsubscribe", () => {
    const at = (token: string | null) =>
      `http://localhost:3000/api/newsletter/unsubscribe${token ? `?token=${token}` : ""}`;

    it("unsubscribes on the POST a mail client sends", async () => {
      const [address] = await subscribe(1);
      const [row] = await db
        .select()
        .from(newsletterSubscribers)
        .where(eq(newsletterSubscribers.email, address!));

      const response = await route.POST(
        new Request(at(row!.unsubscribeToken), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "List-Unsubscribe=One-Click",
        }),
      );
      expect(response.status).toBe(200);
      const [after] = await db
        .select()
        .from(newsletterSubscribers)
        .where(eq(newsletterSubscribers.email, address!));
      expect(after!.unsubscribedAt).toBeInstanceOf(Date);

      // A second click is not an error.
      const again = await route.POST(new Request(at(row!.unsubscribeToken), { method: "POST" }));
      expect(again.status).toBe(200);
    });

    it("refuses a token that is not ours, and never unsubscribes on GET", async () => {
      expect((await route.POST(new Request(at("x"), { method: "POST" }))).status).toBe(400);
      expect((await route.POST(new Request(at("f".repeat(64)), { method: "POST" }))).status).toBe(
        404,
      );

      const [address] = await subscribe(1);
      const [row] = await db
        .select()
        .from(newsletterSubscribers)
        .where(eq(newsletterSubscribers.email, address!));
      const response = await route.GET(new Request(at(row!.unsubscribeToken)));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toMatch(
        new RegExp(`/bg/byuletin/otpisvane\\?token=${row!.unsubscribeToken}$`),
      );
      const [still] = await db
        .select()
        .from(newsletterSubscribers)
        .where(eq(newsletterSubscribers.email, address!));
      expect(still!.unsubscribedAt).toBeNull();
    });
  });

  describe("splitting a refused request", () => {
    it("survives an outage mid-split: every valid address once, nothing untried failed", async () => {
      const addresses = await subscribe(6);
      const bad = addresses[1]!;
      const id = await started(6);

      /* The whole request is refused for one address; split, the second
         single attempt meets an outage that outlasts its retries. */
      let outage = true;
      const fake = new FakeResend((emails) => {
        if (emails.some((email) => email.to === bad)) return refusal("validation_error", 422);
        if (emails.length === 1 && outage && fake.delivered.length >= 1) {
          return refusal("internal_server_error", 503);
        }
        return "deliver";
      });

      const first = await run(id, fake);
      expect(first.status).toBe("stopped");

      const rows = await deliveries(id);
      // Never attempted under its own key: still waiting, keyed, not failed.
      const untried = rows.filter((row) => row.status === "sending" && row.attemptedAt === null);
      expect(untried.length).toBeGreaterThan(0);
      for (const row of untried) expect(row.batchKey).toMatch(/\/one\//);
      // Nothing failed but, at most, the one address Resend refused.
      for (const row of rows.filter((row) => row.status === "failed")) expect(row.email).toBe(bad);
      expect((await campaign(id)).status).toBe("partial");

      outage = false;
      expect(await campaigns.claimResume(id)).toBe(true);
      const second = await run(id, fake);
      expect(second.status).toBe("done");

      for (const address of addresses.filter((a) => a !== bad)) {
        expect(fake.copiesTo(address), address).toBe(1);
      }
      expect(fake.copiesTo(bad)).toBe(0);
      const after = await deliveries(id);
      expect(after.filter((row) => row.status === "sent")).toHaveLength(5);
      expect(after.find((row) => row.email === bad)).toMatchObject({
        status: "failed",
        error: expect.stringContaining("Resend отказа този адрес"),
      });
    });

    it("splits a resent request that Resend refuses for its content", async () => {
      /* A request left `sending` by an earlier run, then refused with a 422
         when resent: had the first attempt gone, Resend would have answered
         from memory, so nothing went — split it, do not fail it. */
      const addresses = await subscribe(3);
      const bad = addresses[2]!;
      const id = await started(3);
      const fake = new FakeResend(() => "drop");
      const killed = run(id, fake, {
        sleep: async () => {
          throw new Error("function killed");
        },
      });
      await expect(killed).rejects.toThrow("function killed");
      expect(await campaigns.claimResume(id, new Date(Date.now() + 11 * 60 * 1000))).toBe(true);

      fake.behaviour = (emails) =>
        emails.some((email) => email.to === bad) ? refusal("validation_error", 422) : "deliver";
      await run(id, fake);

      for (const address of addresses.slice(0, 2)) expect(fake.copiesTo(address)).toBe(1);
      expect((await deliveries(id)).find((row) => row.email === bad)).toMatchObject({
        status: "failed",
      });
    });

    it("stops after three identical refusals and puts the rest back in the queue", async () => {
      // Every copy refused alike: a setting, not ten bad addresses.
      await subscribe(10);
      const id = await started(10);
      const fake = new FakeResend(() => refusal("validation_error", 422));
      const report = await run(id, fake);

      expect(report.status).toBe("stopped");
      expect(report.reason).toMatch(/3 поредни адреса/);
      const rows = await deliveries(id);
      expect(rows.filter((row) => row.status === "failed")).toHaveLength(3);
      const waiting = rows.filter((row) => row.status === "pending");
      expect(waiting).toHaveLength(7);
      expect(waiting.every((row) => row.batchKey === null && row.attemptedAt === null)).toBe(true);
      expect((await campaign(id)).status).toBe("partial");
    });
  });

  describe("an answer that may have gone", () => {
    it("never releases or splits a request whose earlier attempt went unanswered", async () => {
      /* The first attempt is lost on the way; the retry is refused with a
         422. The first attempt may have been processed, so the copies wait,
         keyed, for a later run — not split, not back in the queue. */
      const addresses = await subscribe(2);
      const id = await started(2);
      const fake = new FakeResend((_, call) =>
        call === 0 ? "drop" : refusal("validation_error", 422),
      );
      await run(id, fake);

      const rows = await deliveries(id);
      expect(rows.map((row) => row.status)).toEqual(["sending", "sending"]);
      expect(new Set(rows.map((row) => row.batchKey)).size).toBe(1);
      expect(rows[0]!.batchKey).not.toMatch(/\/one\//);
      expect((await campaign(id)).lastError).toMatch(/чакат потвърждение/);

      fake.behaviour = () => "deliver";
      await campaigns.claimResume(id);
      await run(id, fake);
      for (const address of addresses) expect(fake.copiesTo(address)).toBe(1);
    });

    it("waits rather than failing when Resend answers a resend with a different payload", async () => {
      await subscribe(1);
      const id = await started(1);
      const fake = new FakeResend(() => refusal("invalid_idempotent_request", 409));
      await run(id, fake);
      const [row] = await deliveries(id);
      expect(row).toMatchObject({ status: "sending" });
      expect(row!.error).toBeNull();
    });
  });

  describe("the time budget", () => {
    it("is checked inside a split, and the rest wait under their own keys", async () => {
      const addresses = await subscribe(4);
      const bad = addresses[0]!;
      const id = await started(4);
      let clock = 1_000_000;
      const fake = new FakeResend((emails) => {
        clock += 60_000; // every request takes a minute
        return emails.some((email) => email.to === bad)
          ? refusal("validation_error", 422)
          : "deliver";
      });
      const report = await run(id, fake, { now: () => clock, budgetMs: 100_000 });
      expect(report.reason).toMatch(/времето на една заявка/);
      const untried = (await deliveries(id)).filter(
        (row) => row.status === "sending" && row.attemptedAt === null,
      );
      expect(untried.length).toBeGreaterThan(0);

      await campaigns.claimResume(id);
      await run(id, fake);
      for (const address of addresses.slice(1)) expect(fake.copiesTo(address)).toBe(1);
    });

    it("is checked before resending what an earlier run left in flight", async () => {
      await subscribe(2);
      const id = await started(2);
      const fake = new FakeResend(() => "drop");
      await run(id, fake);
      const requestsBefore = fake.requests.length;

      await campaigns.claimResume(id);
      const report = await run(id, fake, { budgetMs: 0 });
      expect(report.reason).toMatch(/времето на една заявка/);
      expect(fake.requests.length).toBe(requestsBefore);
    });
  });

  describe("a campaign stuck sending", () => {
    it("with nobody left waiting is finished by the resume control", async () => {
      await subscribe(2);
      const id = await started(2);
      await run(id, new FakeResend());
      // The run died after its last request, before writing the end.
      await db
        .update(newsletterCampaigns)
        .set({ status: "sending", updatedAt: new Date(Date.now() - 11 * 60 * 1000) })
        .where(eq(newsletterCampaigns.id, id));

      const stuck = await campaign(id);
      expect(campaigns.isResumable(stuck, 0)).toBe(true);
      expect(await campaigns.claimResume(id)).toBe(true);
      const report = await run(id, new FakeResend());
      expect(report).toMatchObject({ status: "done", requests: 0 });
      expect((await campaign(id)).status).toBe("sent");
    });

    it("says what happened to a copy whose subscriber was deleted mid-send", async () => {
      await subscribe(2);
      const id = await started(2);
      await run(id, new FakeResend(() => "drop"));
      const [first] = await deliveries(id);
      await db
        .delete(newsletterSubscribers)
        .where(eq(newsletterSubscribers.id, first!.subscriberId!));

      await campaigns.claimResume(id);
      await run(id, new FakeResend());
      const gone = (await deliveries(id)).find((row) => row.id === first!.id)!;
      expect(gone.status).toBe("failed");
      expect(gone.error).toMatch(/изтрит/);
      expect(gone.error).not.toBe(send.UNKNOWN_OUTCOME);
    });
  });

  describe("two tabs on one draft", () => {
    it("refuses a save or a send from a tab that has not seen the latest save", async () => {
      await subscribe(1);
      const id = await campaigns.createDraft();
      const drawn = Number(await versionOf(id));
      const letter = { subject: "Тема", preheader: "", body: "Текст", attachments: [] };

      const tabA = await campaigns.saveDraft(id, letter, drawn);
      expect(tabA.ok).toBe(true);
      const tabB = await campaigns.saveDraft(id, { ...letter, body: "Друго" }, drawn);
      expect(tabB).toEqual({ ok: false, reason: "conflict" });

      expect(await campaigns.startCampaign(id, 1, drawn)).toEqual({ ok: false, reason: "changed" });
      expect((await campaign(id)).status).toBe("draft");
      if (!tabA.ok) throw new Error("unreachable");
      expect(await campaigns.startCampaign(id, 1, Number(tabA.version))).toEqual({
        ok: true,
        recipients: 1,
      });
    });

    it("tells the stale tab, and keeps what it typed out of the database", async () => {
      await subscribe(1);
      const id = await campaigns.createDraft();
      const stale = await versionOf(id);
      await campaigns.saveDraft(id, {
        subject: "Новата",
        preheader: "",
        body: "x",
        attachments: [],
      });

      const answer = await actions.submitNewsletter(
        {},
        form({
          id,
          version: stale,
          intent: "send",
          subject: "Старата",
          preheader: "",
          body: "y",
          attachments: "[]",
          confirmCount: "1",
        }),
      );
      expect(answer.error).toMatch(/друг раздел/);
      expect(await campaign(id)).toMatchObject({ subject: "Новата", status: "draft" });
    });
  });

  describe("bounces and complaints", () => {
    it("mark the copy and take the subscriber off the list, matched by Resend's id", async () => {
      const addresses = await subscribe(2);
      const id = await started(2);
      await run(id, new FakeResend());
      const [first] = await deliveries(id);
      const { recordDeliveryProblem } = await import("@/lib/newsletter/bounces");

      expect(await recordDeliveryProblem("bounced", first!.resendEmailId!, "550", new Date())).toBe(
        "recorded",
      );
      expect((await deliveries(id))[0]).toMatchObject({ status: "bounced" });
      const [left] = await db
        .select()
        .from(newsletterSubscribers)
        .where(eq(newsletterSubscribers.email, addresses[0]!));
      expect(left!.unsubscribedAt).toBeInstanceOf(Date);

      // The same event again, and a complaint after it.
      expect(await recordDeliveryProblem("bounced", first!.resendEmailId!, "550", new Date())).toBe(
        "already_recorded",
      );
      expect(
        await recordDeliveryProblem("complained", first!.resendEmailId!, "spam", new Date()),
      ).toBe("recorded");
      expect((await deliveries(id))[0]).toMatchObject({ status: "complained" });

      // Another site's mail to the same address names no copy of ours.
      expect(await recordDeliveryProblem("complained", "re_other_site", "spam", new Date())).toBe(
        "not_ours",
      );
      const [other] = await db
        .select()
        .from(newsletterSubscribers)
        .where(eq(newsletterSubscribers.email, addresses[1]!));
      expect(other!.unsubscribedAt).toBeNull();

      // Accepted copies still count as sent on the campaign.
      const counts = await campaigns.deliveryCounts(id);
      expect(counts).toMatchObject({ sent: 1, complained: 1 });
    });
  });

  describe("copying the list into Resend again", () => {
    it("mirrors every active subscriber, reports counts, and carries on from where it stopped", async () => {
      await subscribe(3);
      await db
        .insert(newsletterSubscribers)
        .values({ email: "left@example.test", unsubscribedAt: new Date() });
      process.env.RESEND_NEWSLETTER_SEGMENT_ID = "";
      const created: string[] = [];
      const resend = {
        contacts: {
          create: async ({ email }: { email: string }) => {
            created.push(email);
            return email.startsWith("reader001")
              ? {
                  data: null,
                  error: { message: "boom", name: "application_error", statusCode: 500 },
                }
              : { data: { id: `c_${email}` }, error: null };
          },
          update: async () => ({
            data: null,
            error: { message: "boom", name: "x", statusCode: 500 },
          }),
          get: async () => ({ data: { unsubscribed: false }, error: null }),
          segments: {
            list: async () => ({ data: { data: [] }, error: null }),
            add: async () => ({}),
          },
          topics: {
            update: async () => ({
              data: null,
              error: { message: "boom", name: "x", statusCode: 500 },
            }),
          },
        },
      } as unknown as Resend;
      const { resyncActiveSubscribers } = await import("@/lib/newsletter/resync");

      let clock = 0;
      const partial = await resyncActiveSubscribers({
        resend,
        now: () => (clock += 1),
        budgetMs: 2, // time for two subscribers
      });
      if ("error" in partial) throw new Error(partial.error);
      expect(partial.synced + partial.failed).toBe(2);
      expect(partial.remaining).toBe(1);
      expect(partial.next).not.toBeNull();

      const rest = await resyncActiveSubscribers({ resend, after: partial.next });
      if ("error" in rest) throw new Error(rest.error);
      expect(rest).toMatchObject({ remaining: 0, next: null });
      expect(rest.synced + rest.failed).toBe(1);

      /* Everybody active, in two presses (a failed create is tried once more
         without properties, so an address may appear twice); nobody who
         left; one failure, named. */
      expect([...new Set(created)].sort()).toEqual([
        "reader000@example.test",
        "reader001@example.test",
        "reader002@example.test",
      ]);
      expect(partial.synced + rest.synced).toBe(2);
      expect(partial.failed + rest.failed).toBe(1);
      expect(partial.firstError ?? rest.firstError).toMatch(/boom/);
    });
  });

  it("has a migration that is safe to run again over a database that has it", async () => {
    await subscribe(2);
    const id = await started(2);
    const { sql: client, close: closeClient } = createDatabase({ url, max: 1 });
    try {
      await runMigrationFile(client, "0009_newsletter_campaigns");
      await runMigrationFile(client, "0009_newsletter_campaigns");
    } finally {
      await closeClient();
    }
    expect(await deliveries(id)).toHaveLength(2);
    // The one-copy-per-person index is there: a second snapshot adds nobody.
    await db.execute(sql`
      insert into newsletter_deliveries (campaign_id, subscriber_id, email)
      select ${id}::uuid, id, email from newsletter_subscribers
      on conflict (campaign_id, subscriber_id) do nothing
    `);
    expect(await deliveries(id)).toHaveLength(2);
  });

  it("keeps the counts the list screen shows", async () => {
    await subscribe(3);
    await db
      .insert(newsletterSubscribers)
      .values({ email: "gone@example.test", unsubscribedAt: new Date() });
    expect(await campaigns.subscriberCounts()).toEqual({ active: 3, unsubscribed: 1 });
    expect(await campaigns.countActiveSubscribers()).toBe(3);
    const page = await campaigns.listSubscribersPage({
      page: 2,
      pageSize: 2,
      includeUnsubscribed: true,
    });
    expect(page).toHaveLength(2);
    expect((await campaigns.allSubscribers(false)).map((row) => row.email)).not.toContain(
      "gone@example.test",
    );
    expect(await db.select().from(newsletterCampaigns)).toHaveLength(0);
  });
});
