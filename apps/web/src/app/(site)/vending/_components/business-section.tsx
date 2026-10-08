import Link from "next/link";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { ProductGrid } from "@/components/catalog/product-card";
import { ContactForm } from "@/components/forms/contact-form";
import { JsonLd } from "@/components/seo/json-ld";
import { Breadcrumbs, SectionHeading } from "@/components/ui/primitives";
import { siteConfig } from "@/config/site";
import type { CatalogQuery } from "@/lib/catalog/filters";
import type { ProductCardView } from "@/lib/catalog/types";
import type { SectionListing } from "@/lib/catalog/vending";
import { breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo/json-ld";
import type { BusinessSectionCopy } from "../../../../../content/vending";

/**
 * The page body shared by `/vending` and `/consumables`.
 *
 * A plain function of its props — no data fetching — so the one behaviour that
 * matters most here can be tested without a database: **a section with nothing
 * behind it is not rendered at all.** No heading over an empty grid, no filter
 * panel beside zero products. The home page follows the same rule.
 *
 * What takes the place of the product sections when there are none is a single
 * sentence saying so. That is content, not a blank shell: on these pages
 * "we do not list this yet" is the most useful thing a business reader can be
 * told, and saying it is what keeps the rest of the page from implying stock.
 *
 * Lives under the vending route because the two routes are the only users;
 * the underscore keeps the folder out of routing.
 */
export function BusinessSectionView({
  copy,
  path,
  query,
  listing,
  blends = [],
}: {
  copy: BusinessSectionCopy;
  path: string;
  query: CatalogQuery;
  /** Products filed under the section's own category, once the source has any. */
  listing: SectionListing | null;
  /** Vending blends found elsewhere in the catalog. */
  blends?: readonly ProductCardView[];
}) {
  const breadcrumbs = [
    { name: "Начало", href: "/" },
    { name: copy.title, href: path },
  ];

  const showBlends = copy.blends !== undefined && blends.length > 0;
  const shownProducts = [...(listing?.result.items ?? []), ...(showBlends ? blends : [])];
  const hasProducts = listing !== null || showBlends;

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      {shownProducts.length > 0 && (
        <JsonLd
          id="ld-itemlist"
          data={itemListJsonLd(
            shownProducts.map((product) => ({
              name: product.name,
              href: `/products/${product.slug}`,
            })),
            copy.title,
          )}
        />
      )}

      <Breadcrumbs items={breadcrumbs} />

      <header className="mb-10 max-w-prose">
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">
          {copy.title}
        </h1>
        {copy.lead.map((paragraph) => (
          <p key={paragraph} className="mt-3 text-base text-ink-500">
            {paragraph}
          </p>
        ))}
      </header>

      {copy.explainer && (
        <section className="mb-12 max-w-prose">
          <h2 className="font-display text-2xl font-semibold text-ink-900">
            {copy.explainer.heading}
          </h2>
          <p className="mt-2 text-base text-ink-500">{copy.explainer.intro}</p>
          <dl className="mt-5 space-y-4">
            {copy.explainer.items.map((item) => (
              <div key={item.term}>
                <dt className="font-medium text-ink-900">{item.term}</dt>
                <dd className="mt-0.5 text-base text-ink-700">{item.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Category-backed listing — only once the catalog has one with products. */}
      {listing && (
        <section className="mb-14">
          <SectionHeading
            title={copy.listing.heading}
            {...(copy.listing.description ? { description: copy.listing.description } : {})}
          />
          <CatalogListing
            basePath={path}
            query={query}
            result={listing.result}
            /* A facet with a single value filters nothing. */
            hideCategories={listing.result.facets.categories.length <= 1}
          />
        </section>
      )}

      {/* Vending blends — only when the catalog holds any. */}
      {showBlends && copy.blends && (
        <section className="mb-14">
          <SectionHeading title={copy.blends.heading} description={copy.blends.description} />
          {/* Below the listing these are far down the page; no eager images then. */}
          <ProductGrid products={blends} priorityCount={listing ? 0 : 4} />
        </section>
      )}

      {!hasProducts && (
        <p className="mb-12 max-w-prose rounded-md border border-line bg-paper-raised p-5 text-base text-ink-700">
          {copy.nothingListed}
        </p>
      )}

      <section className="mb-14 max-w-prose">
        <h2 className="font-display text-2xl font-semibold text-ink-900">
          {copy.ordering.heading}
        </h2>
        <ol className="mt-5 space-y-3 text-base text-ink-700">
          {copy.ordering.steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span
                aria-hidden
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs bg-pine-700 text-2xs font-semibold text-paper"
              >
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {copy.ordering.note && <p className="mt-4 text-sm text-ink-500">{copy.ordering.note}</p>}
      </section>

      <section
        id="enquiry"
        className="grid gap-8 border-t border-line pt-10 lg:grid-cols-2 lg:gap-16"
      >
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink-900">
            {copy.enquiry.heading}
          </h2>
          <p className="mt-2 max-w-prose text-base text-ink-500">{copy.enquiry.intro}</p>

          <p className="mt-6 text-sm text-ink-500">Предпочитате да говорим?</p>
          <a
            href={`tel:${siteConfig.contact.phoneHref}`}
            className="font-display text-2xl font-semibold text-pine-700 underline-offset-4 hover:underline"
          >
            {siteConfig.contact.phone}
          </a>
          <p className="mt-0.5 text-sm text-ink-500">{siteConfig.contact.hours}</p>

          <p className="mt-8 text-sm text-ink-700">
            {copy.related.text}{" "}
            <Link
              href={copy.related.href}
              className="font-medium text-pine-700 underline underline-offset-4"
            >
              {copy.related.label}
            </Link>
          </p>
        </div>

        <ContactForm defaultSubject={copy.enquiry.subject} />
      </section>
    </div>
  );
}
