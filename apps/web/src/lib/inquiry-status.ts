/**
 * The `inquiry_status` enum, as values the application can use.
 *
 * ⚠ NOT IN `admin-actions.ts`, and this is a hard constraint rather than a
 * preference. That file is `"use server"`, and a `"use server"` module may
 * export **async functions only** — every export becomes a callable server
 * endpoint, so a plain array or object there fails the build with
 * `A "use server" file can only export async functions, found object`.
 *
 * They are repeated here rather than read off the Drizzle `pgEnum`, whose
 * values are not exposed as a plain array. The `satisfies` below is what keeps
 * the two honest: it is a type error if this list stops matching the column.
 */
import type { orderInquiries } from "@catalog/db/schema";

export const INQUIRY_STATUSES = ["new", "contacted", "converted", "cancelled", "spam"] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/** Fails to compile if the schema's enum and this list ever diverge. */
export type _StatusesMatchSchema =
  (typeof orderInquiries)["$inferSelect"]["status"] extends InquiryStatus ? true : never;

export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  new: "Нова",
  contacted: "Потърсен",
  converted: "Изпълнена",
  cancelled: "Отказана",
  spam: "Спам",
};
