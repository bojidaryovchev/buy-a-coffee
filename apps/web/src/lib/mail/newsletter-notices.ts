import type { Notification } from "@/lib/notifications";
import { periodMonthName } from "@/lib/newsletter/sofia";

/**
 * What the owner is told when the monthly job has prepared a letter
 * (`lib/newsletter/cron.ts`): that it is ready, what is in it, and that
 * nothing has gone to anybody. The link is the notification sink's, to the
 * draft itself (`newsletter_draft` in `notify-sink.ts`).
 *
 * A notice of its own, beside the order and message ones in
 * `owner-notices.ts`, because it is not about a customer at all: no contact
 * details exist to hold back. No `server-only` and no database: the job and
 * `test/newsletter-cron.test.ts` call the same function.
 */

export interface PreparedDraft {
  readonly id: string;
  /** "2026-11". */
  readonly period: string;
  /** New arrivals and reduced products in the draft, as it was prepared. */
  readonly newProducts: number;
  readonly reducedProducts: number;
}

const productsPhrase = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one} продукт` : `${count} ${many} продукта`;

export function draftReadyNotice(draft: PreparedDraft): Notification {
  const month = periodMonthName(draft.period);
  const holds = [
    ...(draft.newProducts > 0 ? [productsPhrase(draft.newProducts, "нов", "нови")] : []),
    ...(draft.reducedProducts > 0
      ? [productsPhrase(draft.reducedProducts, "намален", "намалени")]
      : []),
  ];
  return {
    kind: "newsletter_draft",
    subject: `Бюлетинът за ${month} е готов за преглед`,
    summary: [
      `Черновата на бюлетина за ${month} е подготвена${holds.length > 0 ? `: ${holds.join(" и ")}` : ""}.`,
      "Прегледайте текста и продуктите, махнете каквото не искате и я изпратете от панела. Нищо не е изпратено на абонатите.",
    ].join("\n"),
    recordId: draft.id,
  };
}
