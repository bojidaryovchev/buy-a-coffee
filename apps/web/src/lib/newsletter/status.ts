import type { NewsletterCampaignStatus, NewsletterDeliveryStatus } from "@catalog/db/schema";

/**
 * The newsletter's states in the panel's words, and the badge each wears.
 *
 * Plain data, so the list, the campaign page and its client parts read the
 * same labels. Tones are the panel's existing badge pairs (`zayavki`): pine
 * on its wash for what went well, caution on its wash for what needs a look.
 * `critical` is kept for forms and destructive actions, as `DESIGN.md` asks.
 */

export const CAMPAIGN_STATUS_LABEL: Record<NewsletterCampaignStatus, string> = {
  draft: "Чернова",
  sending: "Изпраща се",
  sent: "Изпратен",
  partial: "Частично изпратен",
  failed: "Неуспешен",
  dismissed: "Отказан",
};

export const CAMPAIGN_STATUS_TONE: Record<NewsletterCampaignStatus, string> = {
  draft: "bg-paper-sunken text-ink-700",
  sending: "bg-pine-100 text-pine-700",
  sent: "bg-pine-100 text-pine-700",
  partial: "bg-caution-100 text-caution",
  failed: "bg-caution-100 text-caution",
  dismissed: "bg-paper-sunken text-ink-500",
};

export const DELIVERY_STATUS_LABEL: Record<NewsletterDeliveryStatus, string> = {
  pending: "Чака",
  sending: "Изпраща се",
  sent: "Изпратено",
  failed: "Неуспешно",
  skipped: "Пропуснато",
  bounced: "Върнато",
  complained: "Оплакване",
};

export const DELIVERY_STATUS_TONE: Record<NewsletterDeliveryStatus, string> = {
  pending: "bg-paper-sunken text-ink-700",
  sending: "bg-pine-100 text-pine-700",
  sent: "bg-pine-100 text-pine-700",
  failed: "bg-caution-100 text-caution",
  skipped: "bg-paper-sunken text-ink-500",
  bounced: "bg-caution-100 text-caution",
  complained: "bg-caution-100 text-caution",
};

/** "1 абонат", "3 абонати". */
export function subscribersWord(count: number): string {
  return count === 1 ? "абонат" : "абонати";
}

/** "1 писмо", "3 писма". */
export function lettersWord(count: number): string {
  return count === 1 ? "писмо" : "писма";
}

/**
 * A count of letters with its verb agreeing: `lettersPhrase(1, "чака",
 * "чакат")` is "1 писмо чака", with 3 it is "3 писма чакат".
 */
export function lettersPhrase(count: number, one: string, many: string): string {
  return `${count} ${lettersWord(count)} ${count === 1 ? one : many}`;
}

/** "2026-10-19 14:32" in UTC, as the rest of the panel prints times. */
export function utcStamp(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 16).replace("T", " ") : "";
}
