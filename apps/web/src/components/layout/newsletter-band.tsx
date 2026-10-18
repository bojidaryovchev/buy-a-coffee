import { useId } from "react";
import { NewsletterForm } from "@/components/forms/newsletter-form";
import { siteConfig } from "@/config/site";
import type { Dictionary } from "@/i18n/dictionaries/bg";

/**
 * The newsletter signup, as a band of its own directly above the footer.
 *
 * It used to be the footer's fifth column, where a 260 px column left the
 * email field a stub that showed „name@“ beside a large button. A band gives
 * the field room for a whole address and the offer a heading of its own.
 *
 * The ground is `paper-raised`, a step lighter than the page, between two
 * hairlines: the Vending Zone band above it on the home page is `pine-900`,
 * and two dark bands must not stack, nor may the signup read as part of the
 * `paper-sunken` footer under it. It has the same anatomy as that band —
 * heading and one sentence on the left, the action on the right, stacked on a
 * phone — so the two read as one family without being the same thing.
 *
 * An `aside`: it is the shop's, not the page's, so it sits outside `<main>`,
 * and a landmark keeps it reachable. A page where it would be noise renders
 * `<NewsletterBandOff />`, and `globals.css` hides the band on that page;
 * see that component.
 *
 * The form keeps `source="footer"`: that is the consent source the admin
 * panel shows as „Формата в долната част на сайта“, which this still is.
 */
export function NewsletterBand({ dict }: { dict: Dictionary }) {
  const headingId = useId();
  if (!siteConfig.features.newsletter) return null;

  return (
    <aside
      aria-labelledby={headingId}
      data-newsletter-band=""
      className="border-t border-line bg-paper-raised"
    >
      <div className="shell grid gap-6 py-10 md:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center lg:gap-16">
        <div>
          <h2 id={headingId} className="font-display text-2xl font-semibold text-ink-900">
            {dict.newsletter.heading}
          </h2>
          <p className="mt-2 max-w-[60ch] text-base text-ink-700">{dict.newsletter.body}</p>
        </div>
        <div className="w-full max-w-xl">
          <NewsletterForm source="footer" />
        </div>
      </div>
    </aside>
  );
}

/**
 * Put on a page where the signup band would be noise, and the band is not
 * shown there (`globals.css`: `body:has([data-newsletter-off])`).
 *
 * A marker rather than a prop because the band belongs to the layout, which
 * renders beside the page and cannot be told by it what to draw. Today:
 *
 *  - the unsubscribe page — whoever is on it is leaving the list;
 *  - the contact page and the two business sections (Vending Zone,
 *    consumables) — each ends on an enquiry form that already asks for this,
 *    as a check box, right above where the band would be;
 *  - the 404 — a visitor who followed a dead link needs a way on, not an offer.
 */
export function NewsletterBandOff() {
  return <span data-newsletter-off="" hidden />;
}
