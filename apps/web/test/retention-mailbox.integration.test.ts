import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { contactMessages, mailMessages, mailThreads } from "@catalog/db/schema";
import type { Database } from "@catalog/db";
import type { runRetention as RunRetention } from "@/lib/retention-run";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * Retention for the mailbox, and for contact messages measured from their
 * closing, against a real database. Skipped when no PostgreSQL is reachable.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

suite("retention: mailbox and closing time (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let runRetention: typeof RunRetention;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("retention_mailbox"));
    ({ runRetention } = await import("@/lib/retention-run"));
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table mail_messages, mail_threads, contact_messages restart identity cascade`,
    );
  });

  const monthsAgo = (months: number, days = 0) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - months);
    d.setUTCDate(d.getUTCDate() - days);
    return d;
  };

  /** A thread with `n` messages, the last of which is `last` old. */
  async function thread(id: string, status: "open" | "done", last: Date, n = 2) {
    const first = new Date(last.getTime() - 3 * 24 * 3600_000);
    await db.insert(mailThreads).values({
      id,
      createdAt: first,
      lastMessageAt: last,
      subject: `Тема ${id}`,
      correspondent: `${id.toLowerCase()}@example.test`,
      status,
    });
    for (let i = 0; i < n; i += 1) {
      await db.insert(mailMessages).values({
        id: `${id}-m${i}`,
        threadId: id,
        createdAt: i === n - 1 ? last : first,
        direction: i % 2 === 0 ? "in" : "out",
        fromAddress: "a@example.test",
        toAddresses: "b@example.test",
        subject: `Тема ${id}`,
        bodyText: "текст",
      });
    }
  }

  const threadIds = async () =>
    (await db.select({ id: mailThreads.id }).from(mailThreads)).map((r) => r.id).sort();
  const messageCount = async () =>
    (await db.select({ id: mailMessages.id }).from(mailMessages)).length;

  it("deletes a done thread 12 months after its last message, messages first", async () => {
    await thread("OLDDONE1", "done", monthsAgo(13), 3);

    const report = await runRetention();

    expect(await threadIds()).toEqual([]);
    expect(await messageCount()).toBe(0);
    expect(report.mailbox).toEqual({ threadsDeleted: 1, messagesDeleted: 3 });
  });

  it("keeps a done thread whose last message is under 12 months old, even if it began earlier", async () => {
    // Started 14 months ago, last wrote 5 months ago.
    await db.insert(mailThreads).values({
      id: "LONGONE1",
      createdAt: monthsAgo(14),
      lastMessageAt: monthsAgo(5),
      subject: "Дълъг разговор",
      correspondent: "long@example.test",
      status: "done",
    });
    await db.insert(mailMessages).values([
      {
        id: "L1",
        threadId: "LONGONE1",
        createdAt: monthsAgo(14),
        direction: "in",
        fromAddress: "a",
        toAddresses: "b",
        subject: "s",
      },
      {
        id: "L2",
        threadId: "LONGONE1",
        createdAt: monthsAgo(5),
        direction: "out",
        fromAddress: "b",
        toAddresses: "a",
        subject: "s",
      },
    ]);

    const report = await runRetention();

    expect(await threadIds()).toEqual(["LONGONE1"]);
    expect(await messageCount()).toBe(2);
    expect(report.mailbox).toEqual({ threadsDeleted: 0, messagesDeleted: 0 });
  });

  it("never touches an open thread, however old", async () => {
    await thread("OPENOLD1", "open", monthsAgo(40), 4);

    const report = await runRetention();

    expect(await threadIds()).toEqual(["OPENOLD1"]);
    expect(await messageCount()).toBe(4);
    expect(report.mailbox).toEqual({ threadsDeleted: 0, messagesDeleted: 0 });
  });

  it("takes only the threads that are due and leaves the rest whole", async () => {
    await thread("DUE00001", "done", monthsAgo(13), 2);
    await thread("DUE00002", "done", monthsAgo(24), 1);
    await thread("YOUNG001", "done", monthsAgo(11), 2);
    await thread("OPEN0001", "open", monthsAgo(13), 2);

    const report = await runRetention();

    expect(await threadIds()).toEqual(["OPEN0001", "YOUNG001"]);
    expect(await messageCount()).toBe(4);
    expect(report.mailbox).toEqual({ threadsDeleted: 2, messagesDeleted: 3 });
  });

  it("is atomic: if the thread delete fails, the messages are still there", async () => {
    await thread("ATOMIC01", "done", monthsAgo(13), 2);
    // A trigger that refuses to let the thread go.
    await db.execute(sql`
      create or replace function refuse_thread_delete() returns trigger language plpgsql as
      $$ begin raise exception 'thread delete refused'; end $$`);
    await db.execute(sql`
      create trigger refuse_thread_delete before delete on mail_threads
      for each row execute function refuse_thread_delete()`);
    try {
      await expect(runRetention()).rejects.toThrow();
      expect(await threadIds()).toEqual(["ATOMIC01"]);
      expect(await messageCount()).toBe(2);
    } finally {
      await db.execute(sql`drop trigger if exists refuse_thread_delete on mail_threads`);
    }
  });

  it("is idempotent, and reports counts only", async () => {
    await thread("ONCE0001", "done", monthsAgo(13), 2);
    await runRetention();
    const second = await runRetention();
    expect(second.mailbox).toEqual({ threadsDeleted: 0, messagesDeleted: 0 });
    expect(JSON.stringify(second)).not.toContain("example.test");
  });

  describe("contact messages, from the closing", () => {
    const contact = (
      email: string,
      status: "new" | "contacted" | "converted" | "cancelled" | "spam",
      createdMonthsAgo: number,
      closedMonthsAgo: number | null,
    ) =>
      db.insert(contactMessages).values({
        email,
        message: "x",
        status,
        createdAt: monthsAgo(createdMonthsAgo),
        closedAt: closedMonthsAgo === null ? null : monthsAgo(closedMonthsAgo),
      });
    const emails = async () =>
      (await db.select({ e: contactMessages.email }).from(contactMessages)).map((r) => r.e).sort();

    it("keeps a message written long ago but closed recently", async () => {
      await contact("recent-close@example.test", "converted", 20, 2);
      await runRetention();
      expect(await emails()).toEqual(["recent-close@example.test"]);
    });

    it("deletes one closed more than 12 months ago", async () => {
      await contact("old-close@example.test", "converted", 20, 13);
      const report = await runRetention();
      expect(await emails()).toEqual([]);
      expect(report.deleted.contactMessages).toBe(1);
    });

    it("falls back to the creation date for a closed row that has no closing time", async () => {
      await contact("legacy-old@example.test", "spam", 13, null);
      await contact("legacy-young@example.test", "spam", 11, null);
      await runRetention();
      expect(await emails()).toEqual(["legacy-young@example.test"]);
    });

    it("never deletes an open message, whatever its closing time says", async () => {
      // A row reopened without its closing time being cleared would be a bug
      // elsewhere; retention still goes by status first.
      await contact("open-stale@example.test", "new", 30, 20);
      await contact("contacted@example.test", "contacted", 30, null);
      const report = await runRetention();
      expect(await emails()).toEqual(["contacted@example.test", "open-stale@example.test"]);
      expect(report.awaitingDecision.contactMessages).toBe(2);
    });
  });
});
