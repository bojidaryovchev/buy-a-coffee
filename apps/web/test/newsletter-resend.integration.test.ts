import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { newsletterSubscribers, orderInquiries } from "@catalog/db/schema";
import type { Database } from "@catalog/db";
// Types only: the modules themselves are imported in `beforeAll`, once the test
// database has been chosen.
import type * as Actions from "@/lib/forms/actions";
import type * as Admin from "@/lib/admin-actions";
import type * as Unsubscribe from "@/lib/forms/unsubscribe";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * The newsletter's two ends in Resend, against a real database: which writes
 * hand a row to the sync, and the rule the contact webhook applies when Resend
 * reports an unsubscribe.
 *
 * The sync itself is replaced with two spies — it has its own tests, against a
 * stand-in SDK, in `newsletter-sync.test.ts` — so nothing here reaches Resend.
 * What is pinned is the "who may opt somebody in" rule: the person's own form,
 * always; the operator, only for a row it created.
 */

vi.mock("next/headers", () => {
  let n = 0;
  return {
    // A different caller for every request, so the form limiters never get in the way.
    headers: async () => new Headers({ "x-forwarded-for": `10.1.${n >> 8}.${n++ & 255}` }),
    cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  isSignedIn: async () => true,
  isAdminConfigured: () => true,
  createSession: async () => undefined,
  destroySession: async () => undefined,
  passwordMatches: () => false,
}));

const sync = vi.hoisted(() => ({
  syncSubscribedLater: vi.fn(),
  syncUnsubscribedLater: vi.fn(),
}));
vi.mock("@/lib/newsletter/sync", () => sync);

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const IDLE = { status: "idle" } as const;

suite("newsletter and Resend (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actions: typeof Actions;
  let admin: typeof Admin;
  let unsubscribe: typeof Unsubscribe;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("newsletter_resend"));
    const { setNotificationSink } = await import("@/lib/notifications");
    setNotificationSink({ name: "discard", async send() {} });
    actions = await import("@/lib/forms/actions");
    admin = await import("@/lib/admin-actions");
    unsubscribe = await import("@/lib/forms/unsubscribe");
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.execute(
      sql`truncate table order_inquiries, contact_messages, newsletter_subscribers, rate_limit_buckets restart identity cascade`,
    );
  });

  const footer = (email: string) =>
    actions.subscribeToNewsletter(IDLE, form({ email, source: "footer", website: "" }));
  const row = async (email: string) =>
    (
      await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, email))
    )[0]!;

  describe("which writes are mirrored", () => {
    it("a signup hands over the row: id, address and its own unsubscribe token", async () => {
      await footer("Ivan@Example.test");
      const stored = await row("ivan@example.test");

      expect(sync.syncSubscribedLater).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: stored.id,
          email: "ivan@example.test",
          unsubscribeToken: stored.unsubscribeToken,
        }),
      );
    });

    it("a second signup by the person is mirrored again — the retry for a lost first sync", async () => {
      await footer("ivan@example.test");
      await footer("ivan@example.test");
      expect(sync.syncSubscribedLater).toHaveBeenCalledTimes(2);
    });

    it("signing up again after unsubscribing opts back in", async () => {
      await footer("ivan@example.test");
      const { unsubscribeToken } = await row("ivan@example.test");
      await unsubscribe.unsubscribeByToken(unsubscribeToken);
      vi.clearAllMocks();

      await footer("ivan@example.test");
      expect((await row("ivan@example.test")).unsubscribedAt).toBeNull();
      expect(sync.syncSubscribedLater).toHaveBeenCalledOnce();
    });

    it("a ticked box on the contact form is mirrored; an unticked one is not", async () => {
      const message = (extra: Record<string, string>) =>
        actions.submitContactMessage(
          IDLE,
          form({
            name: "Мария",
            email: "maria@example.test",
            message: "Здравейте, искам да попитам нещо.",
            website: "",
            ...extra,
          }),
        );
      await message({});
      expect(sync.syncSubscribedLater).not.toHaveBeenCalled();
      await message({ newsletterConsent: "on", message: "И още един въпрос, моля." });
      expect(sync.syncSubscribedLater).toHaveBeenCalledOnce();
    });

    it("the operator mirrors only a row it created", async () => {
      const [order] = await db
        .insert(orderInquiries)
        .values({ phone: "+359888000111", email: "client@example.test", productName: "Кафе" })
        .returning({ id: orderInquiries.id });
      const add = (basis: string) =>
        admin.addToNewsletter({}, form({ recordId: order!.id, kind: "order", basis }));

      expect(await add("operator:phone")).toEqual({ done: "subscribed" });
      expect(sync.syncSubscribedLater).toHaveBeenCalledOnce();

      // Already on the list: Resend may hold an opt-out the operator must not undo.
      expect(await add("operator:email")).toEqual({ done: "already_subscribed" });
      expect(sync.syncSubscribedLater).toHaveBeenCalledOnce();

      // Unsubscribed: refused, and nothing is mirrored.
      await db.update(newsletterSubscribers).set({ unsubscribedAt: new Date() });
      expect((await add("operator:email")).error).toMatch(/отписал/);
      expect(sync.syncSubscribedLater).toHaveBeenCalledOnce();
    });

    it("an unsubscribe by token opts out, again on a repeat, and not for a stranger's token", async () => {
      await footer("ivan@example.test");
      const stored = await row("ivan@example.test");

      expect(await unsubscribe.unsubscribeByToken(stored.unsubscribeToken)).toBe("unsubscribed");
      expect(sync.syncUnsubscribedLater).toHaveBeenLastCalledWith({
        id: stored.id,
        email: "ivan@example.test",
      });
      expect(await unsubscribe.unsubscribeByToken(stored.unsubscribeToken)).toBe(
        "already_unsubscribed",
      );
      expect(sync.syncUnsubscribedLater).toHaveBeenCalledTimes(2);

      expect(await unsubscribe.unsubscribeByToken("f".repeat(64))).toBe("invalid");
      expect(sync.syncUnsubscribedLater).toHaveBeenCalledTimes(2);
    });

    it("the operator's unsubscribe opts out", async () => {
      await footer("ivan@example.test");
      const stored = await row("ivan@example.test");

      await admin.unsubscribeSubscriber(form({ id: stored.id }));
      expect((await row("ivan@example.test")).unsubscribedAt).not.toBeNull();
      expect(sync.syncUnsubscribedLater).toHaveBeenCalledExactlyOnceWith({
        id: stored.id,
        email: "ivan@example.test",
      });
    });

    it("a write that fails mirrors nothing", async () => {
      await db.execute(sql`
        create or replace function fail_subscribe_fn() returns trigger language plpgsql as
        $$ begin raise exception 'newsletter table unavailable'; end $$`);
      await db.execute(sql`
        create trigger fail_subscribe before insert on newsletter_subscribers
        for each row execute function fail_subscribe_fn()`);
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect((await footer("ivan@example.test")).status).toBe("error");
        expect(sync.syncSubscribedLater).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
        await db.execute(sql`drop trigger if exists fail_subscribe on newsletter_subscribers`);
      }
    });
  });

  describe("an unsubscribe reported by Resend", () => {
    const signup = async (email: string, consentAt: string) => {
      await footer(email);
      await db
        .update(newsletterSubscribers)
        .set({ consentAt: new Date(consentAt) })
        .where(eq(newsletterSubscribers.email, email));
    };

    it("is stamped with when it happened there, matched case-insensitively", async () => {
      await signup("ivan@example.test", "2026-10-01T10:00:00Z");
      const at = new Date("2026-10-18T07:30:00Z");

      expect(await unsubscribe.findSubscriberByEmail("IVAN@example.test")).toMatchObject({
        unsubscribedAt: null,
      });
      expect(await unsubscribe.unsubscribeByEmail("Ivan@Example.test", at)).toBe("unsubscribed");
      expect((await row("ivan@example.test")).unsubscribedAt).toEqual(at);
    });

    it("loses to a signup made after it", async () => {
      await signup("ivan@example.test", "2026-10-18T08:00:00Z");

      expect(
        await unsubscribe.unsubscribeByEmail("ivan@example.test", new Date("2026-10-18T07:30:00Z")),
      ).toBe("stale");
      expect((await row("ivan@example.test")).unsubscribedAt).toBeNull();
    });

    it("leaves an existing stamp alone, and knows an address that is not ours", async () => {
      await signup("ivan@example.test", "2026-10-01T10:00:00Z");
      const first = new Date("2026-10-10T00:00:00Z");
      await unsubscribe.unsubscribeByEmail("ivan@example.test", first);

      expect(
        await unsubscribe.unsubscribeByEmail("ivan@example.test", new Date("2026-10-18T00:00:00Z")),
      ).toBe("already_unsubscribed");
      expect((await row("ivan@example.test")).unsubscribedAt).toEqual(first);

      expect(await unsubscribe.unsubscribeByEmail("other@example.test", new Date())).toBe(
        "not_found",
      );
      expect(await unsubscribe.findSubscriberByEmail("other@example.test")).toBeNull();
    });
  });
});
