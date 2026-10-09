import type { Metadata } from "next";
import Link from "next/link";
import {
  AvailabilityBadge,
  Badge,
  Breadcrumbs,
  ButtonLink,
  SectionHeading,
} from "@/components/ui/primitives";
import { ProductGrid } from "@/components/catalog/product-card";
import { QuickOrderForm } from "@/components/forms/quick-order-form";
import {
  DeliveryPaymentBlock,
  deliveryPaymentRows,
} from "@/components/commerce/delivery-payment-block";
import { JsonLd } from "@/components/seo/json-ld";
import { ProductGallery } from "@/components/catalog/product-gallery";
import { FactsTable, factRows } from "@/components/catalog/facts-table";
import { ProductCompatibility } from "@/components/catalog/product-compatibility";
import { SystemBadge } from "@/components/catalog/system-badge";
import { BrandLogo, legibleBrandLogo } from "@/components/catalog/brand-logo";
import { getRelatedProducts } from "@/lib/catalog/queries";
import type { ProductDetailView } from "@/lib/catalog/types";
import { compatibilityLine, packLabel, systemListingHref } from "@/lib/catalog/product-facts";
import { getBrewingSystem } from "@/lib/recommend/systems";
import { breadcrumbJsonLd, productImageUrls, productJsonLd } from "@/lib/seo/json-ld";
import { SHARE_CARD } from "@/lib/seo/share-card";
import { sanitizeHtml, htmlToPlainText } from "@/lib/sanitize";
import { absoluteUrl, siteConfig } from "@/config/site";
import type { Locale } from "@/i18n/config";
import { localeAlternates } from "@/lib/seo/alternates";
import { categoryHref, href, productHref, routes } from "@/lib/routes";

/**
 * A product page, at `/<locale>/<product slug>`.
 *
 * Reached through `[slug]/page.tsx`, which decides that the slug is a product
 * — after checking it is not a category — before this renders.
 */
export function productMetadata(locale: Locale, product: ProductDetailView): Metadata {
  /*
   * `descriptionText` is our own summary or, until one is written, a sentence
   * generated from the product's attributes — the same string the lead
   * paragraph and the JSON-LD use, never the source's text (see the copy layer
   * in `lib/catalog/queries.ts`).
   *
   * `||` rather than `??`: `htmlToPlainText` answers a missing body with an
   * empty string, which `??` let through as an empty meta description. The
   * last arm is for a product we hold no describable fact about at all.
   */
  const description =
    product.descriptionText ||
    htmlToPlainText(product.descriptionHtml, 160) ||
    `${product.name} — предлага се от ${siteConfig.name}.`;

  const photographs = productImageUrls(product);

  return {
    title: product.name,
    description: description.slice(0, 300),
    /* A removed product keeps its URL and its canonical (below, `noindex`). */
    alternates: localeAlternates(locale, (each) => productHref(each, product)),
    openGraph: {
      type: "website",
      title: product.name,
      description: description.slice(0, 300),
      url: absoluteUrl(productHref(locale, product)),
      /**
       * The product's own photograph when there is one — a picture of the bag
       * earns more clicks than the shop's mark — and the generated card when
       * there is not.
       *
       * "When there is one" means a real photograph. A stored image whose URL
       * is not ours resolves to the placeholder drawing, and that must never
       * be offered as the picture of a product; `productImageUrls` drops it.
       *
       * `undefined` was once the fallback and it is the one value that must
       * never appear here: setting `openGraph` at all drops the image inherited
       * from `app/opengraph-image.tsx`, so an unphotographed product shared
       * with no image of any kind. See `lib/seo/share-card.ts`.
       */
      images: [{ url: photographs[0] ?? absoluteUrl(SHARE_CARD) }],
    },
    // A product we no longer sell should not keep attracting search traffic.
    robots: product.status === "active" ? undefined : { index: false, follow: true },
  };
}

const PHONE_LINK =
  "inline-flex min-h-11 items-center justify-center rounded-sm border border-line-strong bg-paper-raised px-5 py-2.5 text-base font-medium text-ink-900 tabular-nums transition-colors hover:bg-paper-sunken";

export async function ProductPage({
  locale,
  product,
}: {
  locale: Locale;
  product: ProductDetailView;
}) {
  /*
   * A removed product keeps its URL and renders an explicit unavailable state
   * rather than 404ing. The URL may already be indexed or bookmarked, and a
   * dead end serves nobody: this page still tells the customer what it was and
   * offers them somewhere to go.
   */
  const unavailable = product.status !== "active";
  const outOfStock = product.availability === "out_of_stock";
  const related = await getRelatedProducts(product, 4);

  const primaryCategory =
    product.categories.find((category) => category.isPrimary) ?? product.categories[0];
  const breadcrumbs = [
    { name: "Начало", href: href(locale, routes.home) },
    ...(primaryCategory
      ? [{ name: primaryCategory.name, href: categoryHref(locale, primaryCategory) }]
      : []),
    { name: product.name, href: productHref(locale, product) },
  ];

  /*
   * The system comes from the product's categories (`systemId` is resolved in
   * the query layer through `BREWING_SYSTEMS`), and the badge links to the one
   * of those categories that binds it. Nothing here reads the product's name.
   */
  const system = getBrewingSystem(product.systemId);
  const systemHref = systemListingHref(locale, product.systemId, product.categories);
  const fits = compatibilityLine(system);

  const pack = packLabel(product.pack) ?? product.weight;
  const reduced = product.discountPercent !== null && product.oldPrice !== null;
  const descriptionHtml = sanitizeHtml(product.descriptionHtml);
  const hasFacts = factRows(product, locale).length > 0;
  const hasTerms = deliveryPaymentRows(product.price).length > 0;

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-product" data={productJsonLd(product, locale)} />
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />

      <Breadcrumbs items={breadcrumbs.map(({ name, href }) => ({ name, href }))} />

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        {/*
          Sticky from `lg`, so the photograph stays beside the order panel
          while the summary scrolls. The offset is the sticky header's height
          plus 16 px.
        */}
        <div className="min-w-0 lg:sticky lg:top-44 lg:self-start">
          <ProductGallery images={product.images} productName={product.name} />
        </div>

        <div className="min-w-0">
          {(system || product.brand) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <SystemBadge systemId={product.systemId} size="md" href={systemHref ?? undefined} />
              {product.brand &&
                (legibleBrandLogo(product.brand.slug, "line") ? (
                  // The brand's logo, linking to its page; its alt is the
                  // brand's name, which is also the link's name. A brand with
                  // no logo, or one unreadable this small, keeps the name.
                  <Link
                    href={href(locale, routes.brand(product.brand.slug))}
                    className="inline-flex min-h-6 items-center rounded-xs"
                  >
                    <BrandLogo brand={product.brand} size="line" inline />
                  </Link>
                ) : (
                  <Link
                    href={href(locale, routes.brand(product.brand.slug))}
                    className="inline-flex min-h-6 items-center text-2xs font-semibold tracking-[0.06em] text-pine-700 uppercase underline-offset-4 hover:underline"
                  >
                    {product.brand.name}
                  </Link>
                ))}
            </div>
          )}

          <h1 className="mt-2 font-display text-2xl font-semibold wrap-break-word text-ink-900 md:text-4xl">
            {product.name}
          </h1>

          <div className="mt-3 flex flex-wrap gap-2">
            <AvailabilityBadge availability={unavailable ? "unknown" : product.availability} />
            {pack && <Badge className="tabular-nums">{pack}</Badge>}
          </div>

          {/*
            Does it fit — before what it costs. Only the system is stated here;
            which machines take that system is the machine finder's claim to
            make, from its own database, and the link goes there.
          */}
          {fits && (
            <p className="mt-3 text-sm text-ink-700">
              {fits}{" "}
              <Link
                href={href(locale, routes.machines)}
                className="text-pine-700 underline underline-offset-2 hover:no-underline"
              >
                Проверете вашата машина
              </Link>
            </p>
          )}

          <div className="mt-5">
            {product.price ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {reduced && <span className="sr-only">Намалена цена </span>}
                <span
                  className={`text-3xl font-semibold tabular-nums ${reduced ? "text-clay-600" : "text-ink-900"}`}
                >
                  {product.price.formatted}
                </span>
                {reduced && product.oldPrice && (
                  <>
                    <span className="sr-only">Стара цена </span>
                    <span className="text-lg text-ink-300 tabular-nums line-through">
                      {product.oldPrice.formatted}
                    </span>
                    <Badge tone="accent" className="tabular-nums">
                      −{product.discountPercent}%
                    </Badge>
                  </>
                )}
              </p>
            ) : (
              <p className="text-lg text-ink-500">
                Цена при запитване — обадете ни се и ще ви я кажем.
              </p>
            )}

            {/*
              Directly under the pack price, not only in the facts table. Price
              indication rules want the unit price beside the selling price,
              and the price per cup is the number that makes a box of ten
              capsules comparable to a kilogram of beans — which is the
              question a customer is actually asking.
            */}
            {(product.servingPrice || product.unitPrice) && (
              <p className="mt-1 flex flex-wrap gap-x-4 text-sm font-medium text-pine-700 tabular-nums">
                {product.servingPrice && <span>{product.servingPrice.formatted}</span>}
                {product.unitPrice && <span>{product.unitPrice.formatted}</span>}
              </p>
            )}
          </div>

          {product.descriptionText && (
            <p className="mt-4 max-w-[60ch] text-base text-ink-700">{product.descriptionText}</p>
          )}

          {unavailable ? (
            /*
              The whole order panel gives way to the explanation. A caution,
              not a reduction: clay is kept for a price that went down.
            */
            <div
              id="order"
              className="mt-6 scroll-mt-44 rounded-md border border-line bg-caution-100 p-4 md:p-5"
            >
              <h2 className="font-display text-lg font-semibold text-caution md:text-xl">
                Този продукт вече не се предлага
              </h2>
              <p className="mt-1 text-sm text-ink-700">
                Спряхме да го предлагаме. Обадете ни се и ще ви насочим към най-близкото, което
                имаме.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <ButtonLink
                  href={
                    primaryCategory
                      ? categoryHref(locale, primaryCategory)
                      : href(locale, routes.categories)
                  }
                >
                  Виж подобни кафета
                </ButtonLink>
                <a href={`tel:${siteConfig.contact.phoneHref}`} className={PHONE_LINK}>
                  {siteConfig.contact.phone}
                </a>
              </div>
            </div>
          ) : (
            /*
              One panel: the order form and the terms it is ordered on.

              The terms come first in the source and are placed in the second
              column from `sm`. On a phone that puts delivery cost and payment
              above the phone field, where they are read before the number is
              typed; a screen reader and a page without styles get the same
              order. With no term configured the block renders nothing and the
              form takes the full width.

              The form component draws its own frame, which inside this panel
              would be a card in a card. The wrapper takes that frame off so
              the panel is the only edge, whichever way the form is styled.
            */
            <section
              id="order"
              aria-label="Поръчка"
              className={`mt-6 scroll-mt-44 overflow-hidden rounded-md border border-line bg-paper-raised ${
                hasTerms ? "sm:grid sm:grid-cols-[1fr_13rem]" : ""
              }`}
            >
              <DeliveryPaymentBlock
                locale={locale}
                price={product.price}
                className="border-b border-line sm:col-start-2 sm:row-start-1 sm:border-b-0 sm:border-l"
              />
              <div className="min-w-0 p-4 sm:col-start-1 sm:row-start-1 sm:p-5 [&>form]:rounded-none [&>form]:border-0 [&>form]:bg-transparent [&>form]:p-0">
                {outOfStock ? (
                  /* No form for something that cannot be sent: a number left
                     here would be a promise the shop cannot keep today. */
                  <div className="rounded-sm bg-caution-100 p-4">
                    <p className="text-sm font-medium text-caution">
                      В момента е изчерпан. Обадете ни се и ще ви кажем кога ще го има.
                    </p>
                    <a
                      href={`tel:${siteConfig.contact.phoneHref}`}
                      className={`${PHONE_LINK} mt-3`}
                    >
                      {siteConfig.contact.phone}
                    </a>
                  </div>
                ) : (
                  <QuickOrderForm productSlug={product.slug} />
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {hasFacts && (
        <section className="mt-12 md:mt-16">
          <SectionHeading title="Характеристики" />
          <FactsTable product={product} locale={locale} />
        </section>
      )}

      {system && <ProductCompatibility locale={locale} system={system} />}

      {/*
        The long description is our own body copy or nothing: with no entry in
        `content/product-copy.ts` this is null and the whole section, heading
        included, is left out. The source's description is never a fallback.

        It is still sanitised before rendering. The override column is plain
        text wrapped in paragraphs by `copy:apply`, but this is the only place
        stored HTML reaches the DOM and it stays the one place that checks.
      */}
      {descriptionHtml && (
        <section className="mt-12 max-w-(--container-measure) md:mt-16">
          <SectionHeading title="За това кафе" />
          <div className="rich-text" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
        </section>
      )}

      {/* Same brewing system only — `getRelatedProducts` enforces it. */}
      {related.length > 0 && (
        <section className="mt-12 md:mt-16">
          <SectionHeading title="Може да ви хареса и" />
          <ProductGrid locale={locale} products={related} priorityCount={0} />
        </section>
      )}
    </div>
  );
}
