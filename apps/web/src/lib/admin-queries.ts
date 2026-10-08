import "server-only";
import { count, desc, eq, isNull } from "drizzle-orm";
import { contactMessages, newsletterSubscribers, orderInquiries } from "@catalog/db/schema";
import { db } from "@/lib/db";

/**
 * Reads for the admin panel.
 *
 * These tables have been written to since the beginning and never read: there
 * was no screen, and `notify()` only logged a redacted line. Everything here is
 * the other end of `lib/forms/actions.ts`.
 *
 * Separate from `lib/catalog/queries.ts` because the audience is different in a
 * way that matters. Those queries feed public pages and are cached and shaped
 * for rendering; these run behind a password on `force-dynamic` pages, return
 * personal data, and must never be reachable from anything the site renders for
 * a visitor.
 *
 * Every list is capped. A shop that has taken two hundred orders wants the last
 * two hundred, and an uncapped select on a page with no pagination is a query
 * that gets slower every week until someone notices.
 */

const PAGE = 200;

export interface OrderRow {
  id: string;
  createdAt: Date;
  status: string;
  productName: string | null;
  productSlug: string | null;
  customerName: string | null;
  phone: string;
  email: string | null;
  quantity: number;
  notes: string | null;
  sourcePage: string | null;
}

export async function listOrders(): Promise<OrderRow[]> {
  return db
    .select({
      id: orderInquiries.id,
      createdAt: orderInquiries.createdAt,
      status: orderInquiries.status,
      productName: orderInquiries.productName,
      productSlug: orderInquiries.productSlug,
      customerName: orderInquiries.customerName,
      phone: orderInquiries.phone,
      email: orderInquiries.email,
      quantity: orderInquiries.quantity,
      notes: orderInquiries.notes,
      sourcePage: orderInquiries.sourcePage,
    })
    .from(orderInquiries)
    .orderBy(desc(orderInquiries.createdAt))
    .limit(PAGE);
}

export async function getOrder(id: string): Promise<OrderRow | null> {
  const [row] = await db
    .select({
      id: orderInquiries.id,
      createdAt: orderInquiries.createdAt,
      status: orderInquiries.status,
      productName: orderInquiries.productName,
      productSlug: orderInquiries.productSlug,
      customerName: orderInquiries.customerName,
      phone: orderInquiries.phone,
      email: orderInquiries.email,
      quantity: orderInquiries.quantity,
      notes: orderInquiries.notes,
      sourcePage: orderInquiries.sourcePage,
    })
    .from(orderInquiries)
    .where(eq(orderInquiries.id, id))
    .limit(1);
  return row ?? null;
}

export interface ContactRow {
  id: string;
  createdAt: Date;
  status: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  subject: string | null;
  message: string;
}

export async function listContacts(): Promise<ContactRow[]> {
  return db
    .select({
      id: contactMessages.id,
      createdAt: contactMessages.createdAt,
      status: contactMessages.status,
      name: contactMessages.name,
      email: contactMessages.email,
      phone: contactMessages.phone,
      subject: contactMessages.subject,
      message: contactMessages.message,
    })
    .from(contactMessages)
    .orderBy(desc(contactMessages.createdAt))
    .limit(PAGE);
}

export async function getContact(id: string): Promise<ContactRow | null> {
  const [row] = await db
    .select({
      id: contactMessages.id,
      createdAt: contactMessages.createdAt,
      status: contactMessages.status,
      name: contactMessages.name,
      email: contactMessages.email,
      phone: contactMessages.phone,
      subject: contactMessages.subject,
      message: contactMessages.message,
    })
    .from(contactMessages)
    .where(eq(contactMessages.id, id))
    .limit(1);
  return row ?? null;
}

export interface SubscriberRow {
  id: string;
  email: string;
  consentAt: Date;
  consentSource: string | null;
  unsubscribedAt: Date | null;
}

export async function listSubscribers(): Promise<SubscriberRow[]> {
  return db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      consentAt: newsletterSubscribers.consentAt,
      consentSource: newsletterSubscribers.consentSource,
      unsubscribedAt: newsletterSubscribers.unsubscribedAt,
    })
    .from(newsletterSubscribers)
    .orderBy(desc(newsletterSubscribers.consentAt))
    .limit(PAGE);
}

/**
 * The counts behind the panel's index.
 *
 * `new` rather than a total, because a total answers nothing: the question on
 * opening the panel is what has not been dealt with. Subscribers count the
 * still-subscribed, for the same reason.
 *
 * Four `count()` queries rather than four `listX().length` — the lists are
 * capped at 200 and would start under-reporting exactly when the number became
 * interesting.
 */
export async function panelCounts(): Promise<{
  newOrders: number;
  newContacts: number;
  subscribers: number;
}> {
  const [orders, contacts, subscribers] = await Promise.all([
    db.select({ n: count() }).from(orderInquiries).where(eq(orderInquiries.status, "new")),
    db.select({ n: count() }).from(contactMessages).where(eq(contactMessages.status, "new")),
    db
      .select({ n: count() })
      .from(newsletterSubscribers)
      .where(isNull(newsletterSubscribers.unsubscribedAt)),
  ]);

  return {
    newOrders: orders[0]?.n ?? 0,
    newContacts: contacts[0]?.n ?? 0,
    subscribers: subscribers[0]?.n ?? 0,
  };
}

/* ── Sync page (/admin/sinhron) ─────────────────────────────────────────────
   Appended as one block. Its imports sit here, not in the header, so that the
   block can be added or removed without touching what the other screens use. */

import { and } from "drizzle-orm";
import { products, syncChanges, syncRuns } from "@catalog/db/schema";

export type SyncRunRow = typeof syncRuns.$inferSelect;

/**
 * The most recent run that finished cleanly and was real.
 *
 * "Last synchronised" means the catalog was actually brought up to date, so a
 * dry run (writes nothing), a partial run (the breaker may have held the diff
 * back) and a failed one do not count. Same definition as the health check's.
 */
export async function lastSuccessfulSync(): Promise<{ at: Date; runId: string } | null> {
  const [row] = await db
    .select({ id: syncRuns.id, startedAt: syncRuns.startedAt, completedAt: syncRuns.completedAt })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.status, "succeeded"),
        eq(syncRuns.dryRun, false),
        eq(syncRuns.circuitBreakerTripped, false),
      ),
    )
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return row ? { at: row.completedAt ?? row.startedAt, runId: row.id } : null;
}

/** Whole rows, so a column the sync gains later (a `moved_count`) reaches the
    page without a change here. */
export async function listSyncRuns(limit = 20): Promise<SyncRunRow[]> {
  return db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(limit);
}

export async function getSyncRun(id: string): Promise<SyncRunRow | null> {
  const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, id)).limit(1);
  return row ?? null;
}

export interface SyncChangeRow {
  id: string;
  /** A string, not the enum: a type added later must render, not crash. */
  changeType: string;
  sourceKey: string;
  changedFields: string[];
  productName: string | null;
  productSlug: string | null;
}

const CHANGES_SHOWN = 300;

export async function listSyncChanges(
  runId: string,
): Promise<{ rows: SyncChangeRow[]; total: number }> {
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: syncChanges.id,
        changeType: syncChanges.changeType,
        sourceKey: syncChanges.sourceKey,
        changedFields: syncChanges.changedFields,
        productName: products.name,
        productSlug: products.slug,
      })
      .from(syncChanges)
      .leftJoin(products, eq(products.id, syncChanges.productId))
      .where(eq(syncChanges.syncRunId, runId))
      .orderBy(syncChanges.changeType, products.name)
      .limit(CHANGES_SHOWN),
    db.select({ n: count() }).from(syncChanges).where(eq(syncChanges.syncRunId, runId)),
  ]);
  return { rows, total: totals?.n ?? 0 };
}

export interface WithoutCopy {
  total: number;
  sample: Array<{ id: string; name: string; slug: string }>;
}

/** Active products still showing the source's text because nobody has written
    their own (`description_text_override is null`). */
export async function productsWithoutOwnCopy(sampleSize = 30): Promise<WithoutCopy> {
  const unwritten = and(eq(products.status, "active"), isNull(products.descriptionTextOverride));
  const [[totals], sample] = await Promise.all([
    db.select({ n: count() }).from(products).where(unwritten),
    db
      .select({ id: products.id, name: products.name, slug: products.slug })
      .from(products)
      .where(unwritten)
      .orderBy(products.name)
      .limit(sampleSize),
  ]);
  return { total: totals?.n ?? 0, sample };
}
