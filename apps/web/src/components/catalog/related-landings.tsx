import Link from "next/link";
import type { Locale } from "@/i18n/config";
import { getLandingAvailability } from "@/lib/catalog/landing-queries";
import {
  relatedLandingLinks,
  type RelatedLink,
  type RelatedSubject,
} from "@/lib/catalog/related-landings";
import { cx } from "@/components/ui/primitives";
import { relatedCopy } from "../../../content/landing-copy";

/**
 * The cross-links a page owes its neighbours, drawn.
 *
 * One component for every page that has any — a category, a brand, a machine
 * brand, a landing listing — so the anchor a page is linked by is the same
 * wherever the link appears. Which links a page gets is decided in
 * `lib/catalog/related-landings.ts`; this only reads what exists and draws it.
 *
 * A link with a note takes a line of its own ("Капсули Lavazza — всички
 * капсули на марката…"); links that stand on their label share a line. Nothing
 * is rendered when the page has no neighbour that exists.
 *
 * **Awaited where it is used** — `{await RelatedLandings({ … })}` — and not
 * written as an element. Every page that calls it is already an async server
 * component, and awaiting it there leaves a plain element in the tree, so the
 * page still renders with `renderToStaticMarkup` in the tests that render
 * whole pages; an async child element would not.
 */
export async function RelatedLandings({
  locale,
  subject,
  className,
}: {
  locale: Locale;
  subject: RelatedSubject;
  className?: string;
}) {
  const links = relatedLandingLinks(locale, subject, await getLandingAvailability());
  return <RelatedLandingsList links={links} className={className} />;
}

/** The markup, apart from the read, so it renders in a test without a database. */
export function RelatedLandingsList({
  links,
  className,
}: {
  links: readonly RelatedLink[];
  className?: string;
}) {
  if (links.length === 0) return null;

  return (
    <nav aria-label={relatedCopy.navLabel} className={cx("mt-5", className)}>
      <ul className="flex max-w-measure flex-wrap gap-x-6 gap-y-1.5 text-sm">
        {links.map((link) => (
          <li key={link.key} className={cx("text-ink-500", link.note && "basis-full")}>
            <Link
              href={link.href}
              className="inline-flex min-h-6 items-center font-medium text-pine-700 underline underline-offset-4 hover:text-pine-900"
            >
              {link.label}
            </Link>
            {link.note && <> — {link.note}</>}
          </li>
        ))}
      </ul>
    </nav>
  );
}
