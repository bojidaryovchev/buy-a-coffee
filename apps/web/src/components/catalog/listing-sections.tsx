import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { BeansSectionEntry, BeansSectionsView } from "@/lib/catalog/beans-section-queries";
import type { BeansSectionId } from "@/lib/catalog/beans-sections";
import { productHref, targetHref } from "@/lib/routes";
import {
  sectionText,
  segmentParagraph,
  type ListingSectionCopy,
} from "../../../content/category-copy";

/**
 * The beans listing's sections by use, drawn: a heading, the sentences that
 * say what is shown and why, and — under the Italian one — a pack per brand,
 * each with its price for a kilogram, the figure the brand's pack was chosen
 * by.
 *
 * Text links, not cards. The cards are the listing above; these are a
 * shortlist through it, and a second grid of packshots would push the
 * introduction a screen further down for products already shown.
 *
 * Side by side from `lg`, one under the other below. Every product is a 44 px
 * row below `lg`, a target a finger can hit, like the introduction's links.
 *
 * Markup only, so it renders in a test without a database; the page reads the
 * sections (`getBeansSections`) and hands them in. Nothing is drawn for a
 * section that is not there, and nothing at all when neither is.
 */
export function ListingSections({
  locale,
  copy,
  sections,
}: {
  locale: Locale;
  copy: Readonly<Record<BeansSectionId, ListingSectionCopy>>;
  sections: BeansSectionsView;
}) {
  const flavoured = sections.automatic?.flavoured ?? false;
  const drawn: ReadonlyArray<{
    readonly id: BeansSectionId;
    readonly products: readonly BeansSectionEntry[];
  }> = [
    ...(sections.italian && sections.italian.length > 0
      ? [{ id: "italian" as const, products: sections.italian }]
      : []),
    ...(sections.automatic ? [{ id: "automatic" as const, products: [] }] : []),
  ];
  if (drawn.length === 0) return null;

  return (
    <div className="mt-14 grid gap-x-12 gap-y-10 border-t border-line pt-10 lg:grid-cols-2">
      {drawn.map((section) => {
        const words = copy[section.id];
        const headingId = `listing-section-${section.id}`;
        return (
          <section key={section.id} aria-labelledby={headingId} data-listing-section={section.id}>
            <h2 id={headingId} className="font-display text-2xl font-semibold text-ink-900">
              {words.heading}
            </h2>
            <p className="mt-4 max-w-prose text-base text-ink-500">
              {segmentParagraph(sectionText(words, { flavoured }), words.links).map((segment) =>
                typeof segment === "string" ? (
                  segment
                ) : (
                  <Link
                    key={segment.phrase}
                    href={targetHref(locale, segment.to)}
                    className="font-medium text-pine-700 underline underline-offset-2 hover:text-pine-900"
                  >
                    {segment.phrase}
                  </Link>
                ),
              )}
            </p>
            {section.products.length > 0 && (
              <ul className="mt-5 max-w-prose divide-y divide-line border-y border-line">
                {section.products.map(({ card, perKilogram }) => (
                  <li
                    key={card.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 py-1 lg:py-2"
                  >
                    <Link
                      href={productHref(locale, card)}
                      className="inline-flex min-h-11 items-center font-medium text-pine-700 underline underline-offset-2 hover:text-pine-900 lg:min-h-0"
                    >
                      {/* Brand and line, and the pack: two sizes of one coffee
                          are two products, and their links must say which. */}
                      {card.weight
                        ? `${card.title ?? card.name}, ${card.weight}`
                        : (card.title ?? card.name)}
                    </Link>
                    {/* DESIGN.md, "Price per cup / per kg". */}
                    {perKilogram && (
                      <span className="text-sm font-medium text-pine-700 tabular-nums">
                        {perKilogram}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
