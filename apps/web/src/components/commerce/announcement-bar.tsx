import { siteConfig, type CommerceConfig } from "@/config/site";
import { freeDeliveryPromise, freeDeliveryThreshold } from "@/components/commerce/terms";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { bg, type Dictionary } from "@/i18n/dictionaries/bg";
import { fill } from "@/i18n/fill";
import { openingHoursLabel } from "@/i18n/hours";
import { toPriceView } from "@/lib/catalog/format";

/**
 * The strip above the header: one sentence about delivery, and on a wide
 * screen when the phone is answered and its number.
 *
 * It replaces the utility strip the header used to carry, so there is one pine
 * bar at the top of the page and not two. The bar is pine; gold marks the one
 * figure in it and nothing else.
 *
 * Rendered on the server, so it is in the first byte of HTML and never pops in.
 * It is absent — not empty — when no free-delivery threshold is configured: the
 * bar exists to carry that promise, and a bar without it would be decoration.
 * The header then shows the phone number itself (see `SiteHeader`).
 *
 * The sentence is the dictionary's `announcement.freeDelivery`, which in
 * Bulgarian reads exactly as `freeDeliveryPromise` — the sentence the product
 * page prints — and a test holds the two together. The figure inside it is
 * formatted in the page's locale and picked out here.
 */
export function AnnouncementBar({
  commerce = siteConfig.commerce,
  contact = siteConfig.contact,
  locale = DEFAULT_LOCALE,
  dict = bg,
}: {
  commerce?: CommerceConfig;
  contact?: Pick<typeof siteConfig.contact, "phone" | "phoneHref">;
  locale?: Locale;
  dict?: Pick<Dictionary, "announcement" | "hours">;
}) {
  const threshold = freeDeliveryThreshold(commerce);
  const figure = threshold
    ? toPriceView(threshold.amount, threshold.currency, locale)?.formatted
    : null;
  if (!freeDeliveryPromise(commerce) || !figure) return null;

  const promise = fill(dict.announcement.freeDelivery, { amount: figure });
  const hours = openingHoursLabel(dict.hours.days, commerce.openingHours);

  // The promise is built around the figure, so this finds it; were the wording
  // ever to change so that it did not, the sentence is still printed whole.
  const at = promise.indexOf(figure);
  const before = at < 0 ? promise : promise.slice(0, at);
  const after = at < 0 ? "" : promise.slice(at + figure.length);

  return (
    <aside aria-label={dict.announcement.label} className="on-pine bg-pine-900 text-paper">
      <div className="shell flex min-h-9 items-center justify-center gap-x-6 py-1.5 text-xs md:justify-between">
        <p className="font-medium">
          {before}
          {at >= 0 && <strong className="font-semibold text-gold-300">{figure}</strong>}
          {after}
        </p>
        <p className="hidden items-center gap-x-5 md:ml-auto md:flex">
          {hours && <span className="text-pine-200">{hours}</span>}
          <a
            href={`tel:${contact.phoneHref}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {contact.phone}
          </a>
        </p>
      </div>
    </aside>
  );
}

/** Whether the bar is drawn at all. The header asks, to know who shows the phone number. */
export function hasAnnouncement(commerce: CommerceConfig = siteConfig.commerce): boolean {
  return freeDeliveryPromise(commerce) !== null && freeDeliveryThreshold(commerce) !== null;
}
