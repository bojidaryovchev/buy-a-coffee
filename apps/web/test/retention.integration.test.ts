import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { contactMessages, orderInquiries } from "@catalog/db/schema";
import type { Database } from "@catalog/db";
import type { runRetention as RunRetention } from "@/lib/retention-run";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * Retention against a real database: a row 13 months old is gone after one run;
 * a row 11 months old, and a 13-month-old enquiry that became an order, are
 * untouched. Skipped when no PostgreSQL server is reachable.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

suite("retention (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let runRetention: typeof RunRetention;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("retention"));
    ({ runRetention } = await import("@/lib/retention-run"));
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table order_inquiries, contact_messages restart identity cascade`,
    );
  });

  const monthsAgo = (months: number) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - months);
    return d;
  };

  const order = (
    phone: string,
    status: "new" | "contacted" | "converted" | "cancelled" | "spam",
    months: number,
  ) => db.insert(orderInquiries).values({ phone, status, createdAt: monthsAgo(months) });

  const contact = (
    email: string,
    status: "new" | "contacted" | "converted" | "cancelled" | "spam",
    months: number,
  ) =>
    db
      .insert(contactMessages)
      .values({ email, message: "x", status, createdAt: monthsAgo(months) });

  const phones = async () =>
    (await db.select({ p: orderInquiries.phone }).from(orderInquiries)).map((r) => r.p).sort();
  const emails = async () =>
    (await db.select({ e: contactMessages.email }).from(contactMessages)).map((r) => r.e).sort();

  it("deletes a 13-month-old enquiry that did not become an order", async () => {
    await order("old-cancelled", "cancelled", 13);
    await order("old-spam", "spam", 13);

    const report = await runRetention();

    expect(await phones()).toEqual([]);
    expect(report.deleted.orderInquiries).toBe(2);
  });

  it("leaves an 11-month-old enquiry and a 13-month-old one that became an order", async () => {
    await order("young-cancelled", "cancelled", 11);
    await order("old-converted", "converted", 13);
    await order("ancient-converted", "converted", 100);
    await order("old-cancelled", "cancelled", 13);

    const report = await runRetention();

    expect(await phones()).toEqual(["ancient-converted", "old-converted", "young-cancelled"]);
    expect(report.deleted.orderInquiries).toBe(1);
  });

  it("leaves undecided enquiries and reports them for a person to settle", async () => {
    await order("old-new", "new", 14);
    await order("old-contacted", "contacted", 14);

    const report = await runRetention();

    expect(await phones()).toEqual(["old-contacted", "old-new"]);
    expect(report.deleted.orderInquiries).toBe(0);
    expect(report.awaitingDecision.orderInquiries).toBe(2);
  });

  it("deletes a closed contact message at 13 months, keeps one at 11, keeps an open one", async () => {
    await contact("old-closed@example.test", "converted", 13);
    await contact("old-spam@example.test", "spam", 13);
    await contact("young-closed@example.test", "converted", 11);
    await contact("old-open@example.test", "new", 13);
    await contact("old-contacted@example.test", "contacted", 13);

    const report = await runRetention();

    expect(await emails()).toEqual([
      "old-contacted@example.test",
      "old-open@example.test",
      "young-closed@example.test",
    ]);
    expect(report.deleted.contactMessages).toBe(2);
    expect(report.awaitingDecision.contactMessages).toBe(2);
  });

  it("is idempotent: a second run deletes nothing more", async () => {
    await order("old-cancelled", "cancelled", 13);
    await runRetention();
    const second = await runRetention();
    expect(second.deleted).toEqual({ orderInquiries: 0, contactMessages: 0 });
  });

  it("reports counts only", async () => {
    await order("0888 123 456", "cancelled", 13);
    const report = await runRetention();
    expect(JSON.stringify(report)).not.toContain("0888");
  });

  describe("the route", () => {
    const SECRET = "integration-secret";
    const call = async (authorization?: string) => {
      const { GET } = await import("@/app/api/cron/retention/route");
      return GET(
        new Request("https://example.test/api/cron/retention", {
          headers: authorization ? { authorization } : {},
        }),
      );
    };

    it("refuses without the secret and deletes nothing", async () => {
      await order("old-cancelled", "cancelled", 13);

      delete process.env.CRON_SECRET;
      expect((await call(`Bearer ${SECRET}`)).status).toBe(404);
      process.env.CRON_SECRET = SECRET;
      expect((await call("Bearer wrong")).status).toBe(401);

      expect(await phones()).toEqual(["old-cancelled"]);
    });

    it("deletes and reports with the secret", async () => {
      await order("old-cancelled", "cancelled", 13);
      process.env.CRON_SECRET = SECRET;

      const response = await call(`Bearer ${SECRET}`);

      expect(response.status).toBe(200);
      expect((await response.json()).deleted.orderInquiries).toBe(1);
      expect(await phones()).toEqual([]);
    });
  });
});
