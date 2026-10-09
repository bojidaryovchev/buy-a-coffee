import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, EmptyState, SectionHeading } from "@/components/ui/primitives";
import { BrandLogo } from "@/components/catalog/brand-logo";
import { JsonLd } from "@/components/seo/json-ld";
import { systemsForCategories } from "@/lib/catalog/brand-summary";
import { getListingFacts, listCategoryKeysByBrand } from "@/lib/catalog/listing-facts";
import { listBrands } from "@/lib/catalog/queries";
import { localeFrom, type LangParams } from "@/i18n/params";
import { pageAlternates } from "@/lib/seo/alternates";
import { breadcrumbJsonLd, listingBreadcrumbs } from "@/lib/seo/json-ld";
import {
  BRANDS_INDEX_META,
  brandMakes,
  brandsIndexIntro,
  metaDescription,
  pageTitle,
} from "@/lib/seo/listing-meta";
import { href, routes } from "@/lib/routes";

export const revalidate = 300;

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  const [brands, facts] = await Promise.all([
    listBrands({ withProductsOnly: true }),
    getListingFacts({ kind: "all" }),
  ]);
  return {
    title: pageTitle(BRANDS_INDEX_META.title),
    // The count is the brands in stock today, never a number typed here.
    description: metaDescription(
      brands.length > 0
        ? `${brands.length} ${brands.length === 1 ? "марка" : "марки"} кафе, италиански и други`
        : BRANDS_INDEX_META.name,
      facts.cupRange,
    ),
    alternates: pageAlternates(locale, routes.brands),
  };
}

export default async function BrandsPage({ params }: PageProps) {
  const locale = await localeFrom(params);
  const [brands, categoryKeysByBrand] = await Promise.all([
    listBrands(),
    listCategoryKeysByBrand(),
  ]);
  const stocked = brands.filter((brand) => brand.productCount > 0);
  /*
   * This page answers „марки кафе“ and „италиански марки кафе“, so it opens
   * by saying how many brands there are and which of them are Italian — from
   * the catalog and from `content/brand-facts.ts`, where each "Italian" has
   * its evidence beside it. What each brand makes is on its tile.
   */
  const intro = brandsIndexIntro(stocked);
  const breadcrumbs = listingBreadcrumbs(locale, [
    { name: BRANDS_INDEX_META.name, href: href(locale, routes.brands) },
  ]);
  /*
   * Brands with no products are listed but not linked: the reference site
   * publishes several of these, and a link to an empty page is a dead end.
   */
  const notStocked = brands.filter((brand) => brand.productCount === 0);

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <Breadcrumbs items={breadcrumbs} />
      <SectionHeading
        as="h1"
        title={BRANDS_INDEX_META.name}
        {...(intro ? { description: intro } : {})}
      />

      {stocked.length === 0 ? (
        <EmptyState
          title="Още няма марки"
          description="Асортиментът се обновява. Моля, проверете отново скоро."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
          {stocked.map((brand) => {
            // From the categories the brand has products in, today.
            const makes = brandMakes(
              systemsForCategories(categoryKeysByBrand.get(brand.slug) ?? []),
            );
            return (
              <li key={brand.slug}>
                <Link
                  href={href(locale, routes.brand(brand.slug))}
                  className="group flex h-full flex-col items-center rounded-md border border-line bg-paper-raised p-3 text-center transition-colors hover:border-pine-500 md:p-5"
                >
                  {/* The name is printed under the logo, so the logo is
                    decorative here: the link reads "Lavazza, 21 продукта",
                    not the name twice. A brand with no logo shows its name in
                    the same box, so every tile in a row is the same height. */}
                  <BrandLogo brand={brand} size="tile" decorative />
                  <h2 className="mt-3 text-sm font-semibold text-ink-900">{brand.name}</h2>
                  {brand.tagline && (
                    <p className="mt-1 text-sm text-ink-500 italic">{brand.tagline}</p>
                  )}
                  {brand.description && (
                    <p className="mt-2 line-clamp-3 text-sm text-ink-500">{brand.description}</p>
                  )}
                  {makes && <p className="mt-1.5 text-xs text-ink-500">{makes}</p>}
                  <p className="mt-auto pt-1 text-xs font-medium text-pine-700 tabular-nums">
                    {brand.productCount} {brand.productCount === 1 ? "продукт" : "продукта"}
                    <span
                      aria-hidden
                      className="ml-1.5 inline-block transition-transform group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {notStocked.length > 0 && (
        <section className="mt-12 border-t border-line pt-8">
          <h2 className="font-display text-lg font-semibold">Налични по поръчка</h2>
          <p className="mt-1 text-sm text-ink-500">
            Можем да ги доставим по заявка — обадете ни се.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {notStocked.map((brand) => (
              <li
                key={brand.slug}
                className="rounded-sm border border-line bg-paper-sunken px-3 py-1.5 text-sm text-ink-500"
              >
                {brand.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
