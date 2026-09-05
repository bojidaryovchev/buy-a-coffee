import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AvailabilityBadge,
  Badge,
  Breadcrumbs,
  ButtonLink,
  SectionHeading,
} from "@/components/ui/primitives";
import { ProductGrid } from "@/components/catalog/product-card";
import { QuickOrderForm } from "@/components/forms/quick-order-form";
import { JsonLd } from "@/components/seo/json-ld";
import { ProductGallery } from "@/components/catalog/product-gallery";
import { getProductBySlug, getRelatedProducts } from "@/lib/catalog/queries";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/seo/json-ld";
import { attributeKeyLabel, attributeValueLabel } from "@/lib/catalog/attributes";
import { sanitizeHtml, htmlToPlainText } from "@/lib/sanitize";
import { siteConfig } from "@/config/site";

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Продуктът не е намерен", robots: { index: false, follow: true } };

  const description =
    product.descriptionText ??
    htmlToPlainText(product.descriptionHtml, 160) ??
    `${product.name} — предлага се от ${siteConfig.name}.`;

  return {
    title: product.name,
    description: description.slice(0, 300),
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      type: "website",
      title: product.name,
      description: description.slice(0, 300),
      url: `/products/${product.slug}`,
      images: product.images.length > 0 ? [{ url: product.images[0]!.url }] : undefined,
    },
    // A product we no longer sell should not keep attracting search traffic.
    robots: product.status === "active" ? undefined : { index: false, follow: true },
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  /*
   * A removed product keeps its URL and renders an explicit unavailable state
   * rather than 404ing. The URL may already be indexed or bookmarked, and a
   * dead end serves nobody: this page still tells the customer what it was and
   * offers them somewhere to go.
   */
  const unavailable = product.status !== "active";
  const related = await getRelatedProducts(product, 4);

  const primaryCategory =
    product.categories.find((category) => category.isPrimary) ?? product.categories[0];
  const breadcrumbs = [
    { name: "Начало", href: "/" },
    ...(primaryCategory
      ? [{ name: primaryCategory.name, href: `/categories/${primaryCategory.slug}` }]
      : []),
    { name: product.name, href: `/products/${product.slug}` },
  ];

  const descriptionHtml = sanitizeHtml(product.descriptionHtml);
  const attributeRows = Object.entries(product.attributes).filter(
    ([key, value]) => value && !["availability", "weight"].includes(key),
  );

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-product" data={productJsonLd(product)} />
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />

      <Breadcrumbs items={breadcrumbs.map(({ name, href }) => ({ name, href }))} />

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        <ProductGallery images={product.images} productName={product.name} />

        <div className="min-w-0">
          {product.brand && (
            <Link
              href={`/brands/${product.brand.slug}`}
              className="text-xs font-medium tracking-wide text-pine-700 uppercase underline-offset-4 hover:underline"
            >
              {product.brand.name}
            </Link>
          )}

          <h1 className="mt-2 font-display text-3xl leading-tight font-semibold text-ink-900 md:text-4xl">
            {product.name}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <AvailabilityBadge availability={unavailable ? "unknown" : product.availability} />
            {product.weight && <Badge>{product.weight}</Badge>}
            {product.intensity && <Badge>Интензивност {product.intensity}</Badge>}
            {product.discountPercent !== null && (
              <Badge tone="accent">−{product.discountPercent}%</Badge>
            )}
          </div>

          <div className="mt-6 flex items-baseline gap-3">
            {product.price ? (
              <>
                <p className="font-display text-3xl font-semibold text-ink-900">
                  {product.price.formatted}
                </p>
                {product.oldPrice && (
                  <p className="text-lg text-ink-300 line-through">{product.oldPrice.formatted}</p>
                )}
              </>
            ) : (
              <p className="text-lg text-ink-500">
                Цена при запитване — обадете ни се и ще ви я кажем.
              </p>
            )}
          </div>

          {product.descriptionText && (
            <p className="mt-5 max-w-prose text-base text-ink-700">{product.descriptionText}</p>
          )}

          <div className="mt-8">
            {unavailable ? (
              <div className="rounded-md border border-clay-500/40 bg-clay-100 p-5">
                <p className="font-display text-lg font-semibold text-ink-900">
                  Този продукт вече не се предлага
                </p>
                <p className="mt-1 text-sm text-ink-700">
                  Спряхме да го предлагаме. Обадете ни се и ще ви насочим към най-близкото, което
                  имаме.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <ButtonLink
                    href={primaryCategory ? `/categories/${primaryCategory.slug}` : "/categories"}
                  >
                    Виж подобни кафета
                  </ButtonLink>
                  <a
                    href={`tel:${siteConfig.contact.phoneHref}`}
                    className="inline-flex h-11 items-center rounded-sm border border-line-strong px-5 text-base font-medium"
                  >
                    {siteConfig.contact.phone}
                  </a>
                </div>
              </div>
            ) : (
              <QuickOrderForm
                productSlug={product.slug}
                disabled={product.availability === "out_of_stock"}
              />
            )}
          </div>

          {attributeRows.length > 0 && (
            <dl className="mt-8 divide-y divide-line border-y border-line text-sm">
              {attributeRows.map(([key, value]) => (
                <div key={key} className="flex justify-between gap-4 py-2.5">
                  <dt className="text-ink-500">{attributeKeyLabel(key)}</dt>
                  <dd className="text-right font-medium text-ink-900">
                    {attributeValueLabel(key, value)}
                  </dd>
                </div>
              ))}
              {product.sku && (
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-ink-500">Код</dt>
                  <dd className="text-right font-medium text-ink-900">{product.sku}</dd>
                </div>
              )}
              {product.categories.length > 0 && (
                <div className="flex justify-between gap-4 py-2.5">
                  <dt className="text-ink-500">Категория</dt>
                  <dd className="text-right">
                    {product.categories.map((category, index) => (
                      <span key={category.slug}>
                        {index > 0 && ", "}
                        <Link
                          href={`/categories/${category.slug}`}
                          className="font-medium text-pine-700 underline-offset-4 hover:underline"
                        >
                          {category.name}
                        </Link>
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </div>

      {/*
        Scraped description HTML is sanitised before rendering. It is untrusted
        third-party input and this is the only place it reaches the DOM.
      */}
      {descriptionHtml && (
        <section className="mt-14 max-w-(--container-measure)">
          <h2 className="font-display text-xl font-semibold">За това кафе</h2>
          <div className="rich-text mt-3" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-16">
          <SectionHeading title="Може да ви хареса и" />
          <ProductGrid products={related} priorityCount={0} />
        </section>
      )}
    </div>
  );
}
