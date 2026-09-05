import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  MAIL_DIRECTIONS,
  MAIL_THREAD_STATUSES,
  mailMessages,
  mailThreads,
  type MailAttachment,
  type MailDirection,
  type MailThreadStatus,
} from "@catalog/db/schema";
import { db } from "@/lib/db";
import { normalizeSubject } from "./threading";

/**
 * The `info@` mailbox, read and written.
 *
 * One implementation, not two. The sister repositories carry a JSON-file store
 * beside the Postgres one so the flow runs with no credentials; this repository
 * does not need it, because `DATABASE_URL` is already **required** here — the
 * catalog is in Postgres, so a developer without a database has no site to run
 * at all, let alone a mailbox. A second store would be a code path nobody could
 * reach.
 *
 * Threads are matched, not created blindly. See `matchThread`.
 */

export { MAIL_DIRECTIONS, MAIL_THREAD_STATUSES };

/* The string half of threading lives in ./threading, which imports nothing -
   so it can be unit-tested without opening a database connection. Re-exported
   here so callers have one import for "the mailbox". */
export { headerValue, normalizeSubject, parseAddress, parseMessageIds } from "./threading";
export type { MailAttachment, MailDirection, MailThreadStatus };

const attachmentSchema = z.object({
  filename: z.string(),
  size: z.number(),
  contentType: z.string(),
});

export const mailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  createdAt: z.string(),
  direction: z.enum(MAIL_DIRECTIONS),

  fromAddress: z.string(),
  /** Stored as one header-shaped string, because that is what it is. */
  toAddresses: z.string(),
  subject: z.string(),

  bodyText: z.string().nullable(),
  bodyHtml: z.string().nullable(),

  messageId: z.string().nullable(),
  inReplyTo: z.string().nullable(),

  attachments: z.array(attachmentSchema).nullable(),
});

export const mailThreadSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastMessageAt: z.string(),
  subject: z.string(),
  correspondent: z.string(),
  correspondentName: z.string().nullable(),
  status: z.enum(MAIL_THREAD_STATUSES),
});

export type MailMessage = z.infer<typeof mailMessageSchema>;
export type MailThread = z.infer<typeof mailThreadSchema>;

/** A thread as the list page needs it: enough to decide what to open next,
 *  without dragging every message body across the wire to draw a list. */
export interface MailThreadSummary extends MailThread {
  messageCount: number;
  /** "in" means the last word was theirs — the ones that still owe an answer. */
  lastDirection: MailDirection;
  snippet: string;
}

export interface MailThreadDetail extends MailThread {
  messages: MailMessage[];
}

export interface NewThread {
  id: string;
  createdAt: string;
  subject: string;
  correspondent: string;
  correspondentName: string | null;
}

/* -- thread matching ------------------------------------------------------- */

/**
 * Which thread an incoming message belongs to.
 *
 * Two signals, in order of trust. The References chain is authoritative when it
 * matches: mail clients accumulate every ancestor id, so a customer replying to
 * OUR reply still carries the id of their own first message, which we stored.
 * That is why this works without ever learning the Message-ID Resend gave our
 * outgoing mail.
 *
 * Subject matching is the fallback for the client that sends a fresh message
 * about the same thing, and it is deliberately scoped to one correspondent —
 * two different people writing "поръчка" are two conversations.
 */
export async function matchThread(
  references: string[],
  correspondent: string,
  subject: string,
): Promise<string | null> {
  const byReference = await findThreadByMessageIds(references);
  if (byReference) return byReference;

  return findThreadByCorrespondent(correspondent, normalizeSubject(subject));
}

/* -- queries --------------------------------------------------------------- */

export async function listThreads(): Promise<MailThreadSummary[]> {
  const threads = await db
    .select()
    .from(mailThreads)
    .orderBy(desc(mailThreads.lastMessageAt))
    .limit(200);

  if (threads.length === 0) return [];

  /* One extra query rather than a denormalised snippet column on the thread: a
     copy of the last message kept in two places is a copy that eventually
     disagrees with itself. Bodies are excluded here — the list needs a line,
     not a message, and the HTML part of a mail is by far the biggest column in
     this schema. */
  const rows = await db
    .select({
      threadId: mailMessages.threadId,
      createdAt: mailMessages.createdAt,
      direction: mailMessages.direction,
      bodyText: mailMessages.bodyText,
    })
    .from(mailMessages)
    .where(
      inArray(
        mailMessages.threadId,
        threads.map((t) => t.id),
      ),
    );

  return threads.map((thread) =>
    summarize(
      toThread(thread),
      rows
        .filter((r) => r.threadId === thread.id)
        .map((r) => ({
          createdAt: r.createdAt.toISOString(),
          direction: r.direction,
          bodyText: r.bodyText,
        })),
    ),
  );
}

export async function getThread(id: string): Promise<MailThreadDetail | null> {
  const [thread] = await db.select().from(mailThreads).where(eq(mailThreads.id, id)).limit(1);
  if (!thread) return null;

  const rows = await db
    .select()
    .from(mailMessages)
    .where(eq(mailMessages.threadId, id))
    .orderBy(mailMessages.createdAt);

  return { ...toThread(thread), messages: rows.map(toMessage) };
}

export async function getMessage(id: string): Promise<MailMessage | null> {
  const [row] = await db.select().from(mailMessages).where(eq(mailMessages.id, id)).limit(1);
  return row ? toMessage(row) : null;
}

/** Threads still waiting on us, for the badge in the admin nav. */
export async function countAwaitingReply(): Promise<number> {
  const threads = await listThreads();
  return threads.filter((t) => t.status === "open" && t.lastDirection === "in").length;
}

export async function createThread(thread: NewThread): Promise<void> {
  await db
    .insert(mailThreads)
    .values({
      ...thread,
      createdAt: new Date(thread.createdAt),
      lastMessageAt: new Date(thread.createdAt),
      status: "open",
    })
    .onConflictDoNothing();
}

export async function addMessage(message: MailMessage): Promise<void> {
  /* Resend retries a webhook it did not get a 2xx for, and a retry must not
     double the conversation. The id is Resend's, so the conflict is exact. */
  await db
    .insert(mailMessages)
    .values({ ...message, createdAt: new Date(message.createdAt) })
    .onConflictDoNothing();

  await db
    .update(mailThreads)
    .set({ lastMessageAt: new Date(message.createdAt) })
    .where(eq(mailThreads.id, message.threadId));
}

export async function setThreadStatus(id: string, status: MailThreadStatus): Promise<void> {
  await db.update(mailThreads).set({ status }).where(eq(mailThreads.id, id));
}

/** Threads whose stored Message-IDs appear in an incoming References chain. */
export async function findThreadByMessageIds(messageIds: string[]): Promise<string | null> {
  if (messageIds.length === 0) return null;
  const [row] = await db
    .select({ threadId: mailMessages.threadId })
    .from(mailMessages)
    .where(inArray(mailMessages.messageId, messageIds))
    .limit(1);
  return row?.threadId ?? null;
}

export async function findThreadByCorrespondent(
  correspondent: string,
  normalizedSubject: string,
): Promise<string | null> {
  /* Normalising in SQL would mean teaching Postgres the Bulgarian reply
     prefixes. The correspondent index narrows this to a handful of rows, so the
     comparison happens here instead. */
  const rows = await db
    .select({ id: mailThreads.id, subject: mailThreads.subject })
    .from(mailThreads)
    .where(and(eq(mailThreads.correspondent, correspondent), eq(mailThreads.status, "open")))
    .orderBy(desc(mailThreads.lastMessageAt))
    .limit(50);

  return rows.find((r) => normalizeSubject(r.subject) === normalizedSubject)?.id ?? null;
}

/* -- shaping --------------------------------------------------------------- */

function summarize(
  thread: MailThread,
  messages: { createdAt: string; direction: MailDirection; bodyText: string | null }[],
): MailThreadSummary {
  const ordered = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const last = ordered.at(-1);

  return {
    ...thread,
    messageCount: ordered.length,
    lastDirection: last?.direction ?? "in",
    snippet: (last?.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
  };
}

function toThread(row: typeof mailThreads.$inferSelect): MailThread {
  return mailThreadSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
  });
}

function toMessage(row: typeof mailMessages.$inferSelect): MailMessage {
  return mailMessageSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
}
