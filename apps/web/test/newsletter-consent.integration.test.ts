import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  contactMessages,
  newsletterSubscribers,
  orderInquiries,
  products,
  sourceSites,
} from "@catalog/db/schema";
import { applyPendingMigrations, createDatabase, type Database } from "@catalog/db";
import type { Notification } from "@/lib/notifications";
// Types only: the modules themselves are imported in `beforeAll`, once the test
// database has been chosen.
import type * as Actions from "@/lib/forms/actions";
import type * as Admin from "@/lib/admin-actions";
import type * as Unsubscribe from "@/app/(site)/newsletter/unsubscribe/actions";
import type * as Page from "@/app/(site)/newsletter/unsubscribe/page";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * Newsletter consent, end to end against a real database: the two ticked
 * checkboxes, the operator's "add to newsletter", the unsubscribe token and the
 * page that uses it, and `closed_at`.
 *
 * Next.js request APIs are replaced with small fakes, and the notification sink
 * with one that records, so nothing here can reach a mail provider.
 */

let requestCounter = 0;
vi.mock("next/headers", () => ({
  // A different caller for every request, so the form limiters never get in the way.
  headers: async () =>
    new Headers({
      "x-forwarded-for": `10.0.${Math.floor(requestCounter / 250)}.${requestCounter++ % 250}`,
    }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

let signedIn = true;
vi.mock("@/lib/auth", () => ({
  isSignedIn: async () => signedIn,
  isAdminConfigured: () => true,
  createSession: async () => undefined,
  destroySession: async () => undefined,
  passwordMatches: () => false,
}));

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const IDLE = { status: "idle" } as const;

suite("newsletter consent (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let url: string;
  let sent: Notification[];
  let actions: typeof Actions;
  let admin: typeof Admin;
  let unsubscribeModule: typeof Unsubscribe;
  let page: typeof Page;

  beforeAll(async () => {
    ({ db, close, url } = await useTestDatabase("newsletter_consent"));

    const { setNotificationSink } = await import("@/lib/notifications");
    setNotificationSink({
      name: "capture",
      async send(notification) {
        sent.push(notification);
      },
    });
    actions = await import("@/lib/forms/actions");
    admin = await import("@/lib/admin-actions");
    unsubscribeModule = await import("@/app/(site)/newsletter/unsubscribe/actions");
    page = await import("@/app/(site)/newsletter/unsubscribe/page");

    await db.execute(sql`truncate table source_sites restart identity cascade`);
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "consent-test",
        name: "Consent test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    await db.insert(products).values({
      sourceSiteId: site!.id,
      sourceKey: "consent-coffee",
      sourceUrl: "https://example.test/consent-coffee/",
      sourcePath: "/consent-coffee/",
      slug: "consent-coffee",
      semanticHash: "consent-test",
      name: "Тестово кафе",
    });
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    sent = [];
    signedIn = true;
    await db.execute(
      sql`truncate table order_inquiries, contact_messages, newsletter_subscribers, rate_limit_buckets restart identity cascade`,
    );
    await db.execute(sql`drop trigger if exists fail_subscribe on newsletter_subscribers`);
  });

  const subscribers = () => db.select().from(newsletterSubscribers);

  const order = (extra: Record<string, string> = {}) =>
    actions.submitOrderInquiry(
      IDLE,
      form({ productSlug: "consent-coffee", phone: "0888 123 456", website: "", ...extra }),
    );

  const contact = (extra: Record<string, string> = {}) =>
    actions.submitContactMessage(
      IDLE,
      form({
        name: "Мария Иванова",
        email: "maria@example.test",
        message: "Здравейте, искам да попитам нещо.",
        website: "",
        ...extra,
      }),
    );

  describe("the quick order", () => {
    it("does not subscribe anyone when the box is not ticked", async () => {
      const result = await order({ email: "buyer@example.test" });
      expect(result.status).toBe("success");
      expect(await db.select().from(orderInquiries)).toHaveLength(1);
      expect(await subscribers()).toHaveLength(0);
    });

    it("subscribes, naming the form, when the box is ticked and an email was given", async () => {
      const before = Date.now();
      const result = await order({ email: "Buyer@Example.test", newsletterConsent: "on" });
      expect(result.status).toBe("success");

      const [row] = await subscribers();
      expect(row).toMatchObject({ email: "buyer@example.test", consentSource: "quick_order_form" });
      expect(row!.unsubscribedAt).toBeNull();
      expect(row!.consentAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row!.unsubscribeToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it("ignores a ticked box when no email was given, and the order is still saved", async () => {
      const result = await order({ newsletterConsent: "on" });
      expect(result.status).toBe("success");
      expect(await db.select().from(orderInquiries)).toHaveLength(1);
      expect(await subscribers()).toHaveLength(0);
    });

    it("never fails the order because the subscription could not be written", async () => {
      await db.execute(sql`
        create or replace function fail_subscribe_fn() returns trigger language plpgsql as
        $$ begin raise exception 'newsletter table unavailable'; end $$`);
      await db.execute(sql`
        create trigger fail_subscribe before insert on newsletter_subscribers
        for each row execute function fail_subscribe_fn()`);
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const result = await order({ email: "buyer@example.test", newsletterConsent: "on" });
        expect(result.status).toBe("success");
        expect(await db.select().from(orderInquiries)).toHaveLength(1);
        expect(await subscribers()).toHaveLength(0);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("newsletter.consent_failed"));
        // The shop is still told about the order.
        expect(sent.map((n) => n.kind)).toEqual(["order_inquiry"]);
      } finally {
        log.mockRestore();
        await db.execute(sql`drop trigger if exists fail_subscribe on newsletter_subscribers`);
      }
    });

    it("rejects a malformed email the same way as before", async () => {
      const result = await order({ email: "not-an-email", newsletterConsent: "on" });
      expect(result.status).toBe("error");
      expect(await subscribers()).toHaveLength(0);
      expect(await db.select().from(orderInquiries)).toHaveLength(0);
    });

    it("a honeypot hit stores nothing, subscribes nothing, and looks like success", async () => {
      const bot = await order({
        email: "bot@example.test",
        newsletterConsent: "on",
        website: "http://spam.test",
      });
      const person = await order({ phone: "0899 000 111" });
      expect(bot.status).toBe("success");
      // The bot is shown exactly what a person is shown.
      expect(bot).toEqual(person);
      expect(await db.select().from(orderInquiries)).toHaveLength(1);
      expect(await subscribers()).toHaveLength(0);
    });

    it("a repeated press with the box ticked still records the tick", async () => {
      await order({ phone: "0888 555 666" });
      const again = await order({
        phone: "0888 555 666",
        email: "late@example.test",
        newsletterConsent: "on",
      });
      expect(again.status).toBe("success");
      expect(await db.select().from(orderInquiries)).toHaveLength(1);
      expect((await subscribers()).map((s) => s.email)).toEqual(["late@example.test"]);
    });

    it("tells the customer what happens next, from the opening hours", async () => {
      const result = await order();
      expect(result.status).toBe("success");
      if (result.status !== "success") return;
      expect(result.message).toMatch(
        /Ще ви се обадим (днес|утре|в \S+|във \S+|в следващ\S+ \S+), в работно време/,
      );
      expect(result.message).toContain("Пон–Пет, 9:00–18:00");
    });
  });

  describe("the contact form", () => {
    it("does not subscribe anyone when the box is not ticked", async () => {
      expect((await contact()).status).toBe("success");
      expect(await db.select().from(contactMessages)).toHaveLength(1);
      expect(await subscribers()).toHaveLength(0);
    });

    it("subscribes, naming the form, when the box is ticked", async () => {
      expect((await contact({ newsletterConsent: "on" })).status).toBe("success");
      const [row] = await subscribers();
      expect(row).toMatchObject({ email: "maria@example.test", consentSource: "contact_form" });
    });

    it("keeps the message when the subscription fails", async () => {
      await db.execute(sql`
        create or replace function fail_subscribe_fn() returns trigger language plpgsql as
        $$ begin raise exception 'newsletter table unavailable'; end $$`);
      await db.execute(sql`
        create trigger fail_subscribe before insert on newsletter_subscribers
        for each row execute function fail_subscribe_fn()`);
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect((await contact({ newsletterConsent: "on" })).status).toBe("success");
        expect(await db.select().from(contactMessages)).toHaveLength(1);
      } finally {
        log.mockRestore();
        await db.execute(sql`drop trigger if exists fail_subscribe on newsletter_subscribers`);
      }
    });

    it("a honeypot hit subscribes nothing", async () => {
      await contact({ newsletterConsent: "on", website: "http://spam.test" });
      expect(await db.select().from(contactMessages)).toHaveLength(0);
      expect(await subscribers()).toHaveLength(0);
    });
  });

  describe("the footer form", () => {
    const footer = (email: string, source = "footer") =>
      actions.subscribeToNewsletter(IDLE, form({ email, source, website: "" }));

    it("keeps a known source and replaces an invented one", async () => {
      await footer("a@example.test");
      await footer("b@example.test", "<script>alert(1)</script>");
      const rows = await subscribers();
      expect(rows.find((r) => r.email === "a@example.test")?.consentSource).toBe("footer");
      expect(rows.find((r) => r.email === "b@example.test")?.consentSource).toBe("unknown");
    });

    it("a second signup does not overwrite the first consent", async () => {
      await footer("a@example.test");
      const [first] = await subscribers();
      await actions.submitContactMessage(
        IDLE,
        form({
          name: "Мария",
          email: "a@example.test",
          message: "Здравейте, искам да попитам нещо.",
          newsletterConsent: "on",
          website: "",
        }),
      );
      const [after] = await subscribers();
      expect(after!.consentSource).toBe("footer");
      expect(after!.consentAt).toEqual(first!.consentAt);
      expect(after!.unsubscribeToken).toBe(first!.unsubscribeToken);
    });

    it("signing up again after unsubscribing is a fresh consent, on the same token", async () => {
      await footer("a@example.test");
      const [first] = await subscribers();
      await db
        .update(newsletterSubscribers)
        .set({ unsubscribedAt: new Date(), consentAt: new Date("2020-01-01T00:00:00Z") })
        .where(eq(newsletterSubscribers.id, first!.id));

      await actions.submitContactMessage(
        IDLE,
        form({
          name: "Мария",
          email: "a@example.test",
          message: "Здравейте, искам да попитам нещо.",
          newsletterConsent: "on",
          website: "",
        }),
      );
      const [after] = await subscribers();
      expect(after!.unsubscribedAt).toBeNull();
      expect(after!.consentSource).toBe("contact_form");
      expect(after!.consentAt.getFullYear()).toBeGreaterThanOrEqual(2026);
      expect(after!.unsubscribeToken).toBe(first!.unsubscribeToken);
    });
  });

  describe("the operator's 'add to newsletter'", () => {
    const makeOrder = async (email: string | null) => {
      const [row] = await db
        .insert(orderInquiries)
        .values({ phone: "+359888000111", email, productName: "Кафе" })
        .returning({ id: orderInquiries.id });
      return row!.id;
    };
    const makeMessage = async (email: string | null) => {
      const [row] = await db
        .insert(contactMessages)
        .values({ name: "Иван", email, message: "Въпрос за кафе." })
        .returning({ id: contactMessages.id });
      return row!.id;
    };
    const add = (fields: Record<string, string>) => admin.addToNewsletter({}, form(fields));

    it("records the chosen basis and the time against the address on the record", async () => {
      const id = await makeOrder("Client@Example.test");
      const result = await add({ recordId: id, kind: "order", basis: "operator:phone" });
      expect(result).toEqual({ done: "subscribed" });

      const [row] = await subscribers();
      expect(row).toMatchObject({ email: "client@example.test", consentSource: "operator:phone" });
      expect(Math.abs(row!.consentAt.getTime() - Date.now())).toBeLessThan(60_000);
      expect(row!.requestMetadata).toMatchObject({
        via: "admin",
        recordKind: "order",
        recordId: id,
      });
    });

    it("works from a contact message too, with the other basis", async () => {
      const id = await makeMessage("writer@example.test");
      expect(await add({ recordId: id, kind: "contact", basis: "operator:email" })).toEqual({
        done: "subscribed",
      });
      expect((await subscribers())[0]?.consentSource).toBe("operator:email");
    });

    it("refuses without a basis, with an unknown one, and with the form's own codes", async () => {
      const id = await makeOrder("client@example.test");
      for (const basis of [
        undefined,
        "",
        "phone",
        "footer",
        "contact_form",
        "operator:",
        "x".repeat(300),
      ]) {
        const fields: Record<string, string> = { recordId: id, kind: "order" };
        if (basis !== undefined) fields.basis = basis;
        const result = await add(fields);
        expect(result.error, String(basis)).toMatch(/Изберете как/);
        expect(result.done).toBeUndefined();
      }
      expect(await subscribers()).toHaveLength(0);
    });

    it("refuses a signed-out caller and stores nothing", async () => {
      const id = await makeOrder("client@example.test");
      signedIn = false;
      const result = await add({ recordId: id, kind: "order", basis: "operator:phone" });
      expect(result.error).toMatch(/Сесията/);
      expect(await subscribers()).toHaveLength(0);
    });

    it("takes the address from the record, not from the form", async () => {
      const id = await makeOrder("real@example.test");
      await add({
        recordId: id,
        kind: "order",
        basis: "operator:phone",
        email: "other@example.test",
      });
      expect((await subscribers()).map((s) => s.email)).toEqual(["real@example.test"]);
    });

    it("refuses a record with no email, or no record", async () => {
      const id = await makeOrder(null);
      expect((await add({ recordId: id, kind: "order", basis: "operator:phone" })).error).toMatch(
        /имейл/,
      );
      const none = "00000000-0000-4000-8000-000000000000";
      expect((await add({ recordId: none, kind: "order", basis: "operator:phone" })).error).toMatch(
        /не е намерен/,
      );
      expect((await add({ recordId: id, kind: "wrong", basis: "operator:phone" })).error).toMatch(
        /Непознат/,
      );
      expect(await subscribers()).toHaveLength(0);
    });

    it("does not undo an unsubscribe", async () => {
      const id = await makeOrder("gone@example.test");
      await add({ recordId: id, kind: "order", basis: "operator:phone" });
      await db.update(newsletterSubscribers).set({ unsubscribedAt: new Date() });

      const result = await add({ recordId: id, kind: "order", basis: "operator:email" });
      expect(result.error).toMatch(/отписал/);
      const [row] = await subscribers();
      expect(row!.unsubscribedAt).not.toBeNull();
      expect(row!.consentSource).toBe("operator:phone");
    });

    it("leaves the first consent in place when the address is already subscribed", async () => {
      const id = await makeOrder("twice@example.test");
      await add({ recordId: id, kind: "order", basis: "operator:phone" });
      const [first] = await subscribers();
      expect(await add({ recordId: id, kind: "order", basis: "operator:email" })).toEqual({
        done: "already_subscribed",
      });
      const [after] = await subscribers();
      expect(after).toMatchObject({ consentSource: "operator:phone", consentAt: first!.consentAt });
    });

    it("every row it creates can answer who, when and how", async () => {
      const id = await makeOrder("q@example.test");
      await add({ recordId: id, kind: "order", basis: "operator:in_person" });
      await order({ email: "w@example.test", newsletterConsent: "on", phone: "0877 111 222" });
      await actions.subscribeToNewsletter(
        IDLE,
        form({ email: "e@example.test", source: "footer", website: "" }),
      );
      for (const row of await subscribers()) {
        expect(row.email).toMatch(/@/);
        expect(row.consentAt).toBeInstanceOf(Date);
        expect(row.consentSource).toBeTruthy();
      }
    });
  });

  describe("unsubscribing by token", () => {
    const subscribe = async (email = "reader@example.test") => {
      await actions.subscribeToNewsletter(IDLE, form({ email, source: "footer", website: "" }));
      return (
        await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, email))
      )[0]!;
    };

    const press = async (token: string): Promise<string> => {
      try {
        await unsubscribeModule.unsubscribe(form({ token }));
      } catch (error) {
        return (error as { to: string }).to;
      }
      throw new Error("expected a redirect");
    };

    const render = async (params: Record<string, string>) => {
      const { renderToStaticMarkup } = await import("react-dom/server");
      const element = await page.default({ searchParams: Promise.resolve(params) });
      return renderToStaticMarkup(element);
    };

    it("a GET shows the confirmation and changes nothing", async () => {
      const row = await subscribe();
      const html = await render({ token: row.unsubscribeToken });
      expect(html).toContain("Отпиши ме");
      expect(html).toContain("re***@example.test");
      expect(html).not.toContain("reader@example.test");
      expect(html).toContain(`value="${row.unsubscribeToken}"`);

      await render({ token: row.unsubscribeToken });
      const [after] = await subscribers();
      expect(after!.unsubscribedAt).toBeNull();
    });

    it("the POST from that page unsubscribes, and keeps the consent record", async () => {
      const row = await subscribe();
      expect(await press(row.unsubscribeToken)).toBe("/newsletter/unsubscribe?status=done");
      const [after] = await subscribers();
      expect(after!.unsubscribedAt).toBeInstanceOf(Date);
      expect(after!.consentSource).toBe("footer");
      expect(after!.consentAt).toEqual(row.consentAt);
    });

    it("a used token gets the same calm page as an unknown one", async () => {
      const row = await subscribe();
      await press(row.unsubscribeToken);

      const used = await render({ token: row.unsubscribeToken });
      const unknown = await render({ token: "f".repeat(64) });
      const garbage = await render({ token: "nope" });
      const missing = await render({});
      for (const html of [used, unknown, garbage, missing]) {
        expect(html).toContain("Връзката не е активна");
        expect(html).not.toContain("Отпиши ме");
        expect(html).not.toContain("reader@example.test");
        expect(html).not.toContain("re***");
      }
      expect(used).toBe(unknown);
    });

    it("pressing twice is harmless", async () => {
      const row = await subscribe();
      expect(await press(row.unsubscribeToken)).toContain("status=done");
      expect(await press(row.unsubscribeToken)).toContain("status=done");
    });

    it("an unknown token changes nothing and reveals nothing", async () => {
      await subscribe();
      expect(await press("f".repeat(64))).toBe("/newsletter/unsubscribe?status=invalid");
      expect(await press("short")).toBe("/newsletter/unsubscribe?status=invalid");
      expect((await subscribers())[0]!.unsubscribedAt).toBeNull();
    });

    it("the result pages carry no data and are not indexable", async () => {
      expect(await render({ status: "done" })).toContain("Отписахте се");
      expect(page.metadata.robots).toEqual({ index: false, follow: false });
      // Not "no-referrer": that sends `Origin: null` on the POST, which Next.js refuses.
      expect(page.metadata.referrer).toBe("same-origin");
    });

    it("tokens are unique and unguessable", async () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 20; i += 1)
        tokens.add((await subscribe(`p${i}@example.test`)).unsubscribeToken);
      expect(tokens.size).toBe(20);
      for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("the migration", () => {
    it("gives every existing subscriber its own token, and is safe to run twice", async () => {
      // Put the table back the way it was before this change: no column, three rows.
      await db.execute(sql`alter table newsletter_subscribers drop column unsubscribe_token`);
      for (const email of ["x@example.test", "y@example.test", "z@example.test"]) {
        await db.execute(
          sql`insert into newsletter_subscribers (email, consent_source) values (${email}, 'footer')`,
        );
      }

      const { sql: client, close: closeClient } = createDatabase({ url, max: 1 });
      try {
        await applyPendingMigrations(client);
        await applyPendingMigrations(client);
      } finally {
        await closeClient();
      }

      const rows = await subscribers();
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.unsubscribeToken)).size).toBe(3);
      for (const row of rows) expect(row.unsubscribeToken).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("when a contact message closed", () => {
    const makeMessage = async (
      status: "new" | "contacted" | "converted" | "cancelled" | "spam" = "new",
    ) => {
      const [row] = await db
        .insert(contactMessages)
        .values({ name: "Иван", email: "i@example.test", message: "Въпрос за кафе.", status })
        .returning({ id: contactMessages.id });
      return row!.id;
    };
    const setStatus = (id: string, status: string) =>
      admin.updateContactStatus(form({ id, status }));
    const read = async (id: string) =>
      (await db.select().from(contactMessages).where(eq(contactMessages.id, id)))[0]!;

    it("sets closed_at when the status moves to a closed one", async () => {
      const id = await makeMessage();
      expect((await read(id)).closedAt).toBeNull();
      await setStatus(id, "converted");
      const row = await read(id);
      expect(row.status).toBe("converted");
      expect(Math.abs(row.closedAt!.getTime() - Date.now())).toBeLessThan(60_000);
    });

    it("clears it when the message is reopened", async () => {
      const id = await makeMessage();
      await setStatus(id, "spam");
      await setStatus(id, "contacted");
      expect((await read(id)).closedAt).toBeNull();
      await setStatus(id, "new");
      expect((await read(id)).closedAt).toBeNull();
    });

    it("keeps the earlier time when one closed status becomes another", async () => {
      const id = await makeMessage();
      await setStatus(id, "converted");
      const earlier = new Date("2026-01-01T00:00:00Z");
      await db.update(contactMessages).set({ closedAt: earlier }).where(eq(contactMessages.id, id));
      await setStatus(id, "spam");
      expect((await read(id)).closedAt).toEqual(earlier);
    });

    it("does not move between open statuses", async () => {
      const id = await makeMessage();
      await setStatus(id, "contacted");
      expect((await read(id)).closedAt).toBeNull();
    });

    it("refuses a signed-out caller", async () => {
      const id = await makeMessage();
      signedIn = false;
      await setStatus(id, "spam");
      expect((await read(id)).status).toBe("new");
    });
  });
});
