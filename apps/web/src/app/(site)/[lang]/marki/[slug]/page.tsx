import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { JsonLd } from "@/components/seo/json-ld";
import {
  buildSearchParams,
  parseCatalogQuery,
  shouldIndexListing,
  type RawSearchParams,
} from "@/lib/catalog/filters";
import { listBrands, listProducts } from "@/lib/catalog/queries";
import { composeBrandSummary, systemsForCategories } from "@/lib/catalog/brand-summary";
import { getListingFacts } from "@/lib/catalog/listing-facts";
import { listBrandCategoryKeys } from "@/lib/catalog/taxonomy";
import { brandJsonLd, breadcrumbJsonLd, listingBreadcrumbs } from "@/lib/seo/json-ld";
import { BrandLogo } from "@/components/catalog/brand-logo";
import { RelatedLandings } from "@/components/catalog/related-landings";
import type { Locale } from "@/i18n/config";
import { shippingLocale, type LangParams } from "@/i18n/params";
import { localeAlternates } from "@/lib/seo/alternates";
import {
  BRANDS_INDEX_META,
  brandDescriptionLead,
  brandTitle,
  metaDescription,
  pageTitle,
} from "@/lib/seo/listing-meta";
import {
  brandHref,
  categoryHref,
  href,
  matchBrandSlug,
  routes,
  systemCategory,
} from "@/lib/routes";
import { categoryNameFor } from "../../../../../../content/category-copy";

export const revalidate = 300;

/**
 * The brand a public slug names, and whether this is the slug its page is
 * published at. A brand is published at the slug it writes itself with
 * (`lollo-caffe`), which for two brands is not the stored one (`lollocafe`);
 * the stored one still finds the brand and answers a redirect. See
 * `brandSlug` in `lib/routes.ts`.
 */
async function findBrand(locale: Locale, slug: string) {
  return matchBrandSlug(locale, await listBrands(), slug);
}

interface PageProps {
  params: Promise<LangParams & { slug: string }>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ lang, slug }, rawParams] = await Promise.all([params, searchParams]);
  const locale = shippingLocale(lang);
  const found = await findBrand(locale, slug);
  if (!found?.published) {
    return { title: "Марката не е намерена", robots: { index: false, follow: true } };
  }
  const { brand } = found;

  const [categoryKeys, facts] = await Promise.all([
    listBrandCategoryKeys(brand.slug),
    getListingFacts({ kind: "brand", slug: brand.slug }),
  ]);
  const systems = systemsForCategories(categoryKeys);

  return {
    /* „Кафе Bianchi (Бианчи): капсули и дози“ — the brand the way people
       search for it, then the formats that are actually on the page. */
    title: pageTitle(brandTitle(brand, systems)),
    // What a cup of this brand costs here, and that ordering is a phone call.
    description: metaDescription(brandDescriptionLead(brand, systems), facts.cupRange),
    // At the slug the brand is published at, which is not always the stored one.
    alternates: localeAlternates(locale, (each) => brandHref(each, brand)),
    robots: shouldIndexListing(parseCatalogQuery(rawParams))
      ? undefined
      : { index: false, follow: true },
  };
}

export default async function BrandPage({ params, searchParams }: PageProps) {
  const [{ lang, slug }, rawParams] = await Promise.all([params, searchParams]);
  const locale = shippingLocale(lang);
  const found = await findBrand(locale, slug);
  if (!found) notFound();
  const { brand } = found;

  const query = parseCatalogQuery(rawParams);
  // One brand, one address: any other slug of it goes there, filters and all.
  if (!found.published) permanentRedirect(brandHref(locale, brand, buildSearchParams(query)));
  const [result, categoryKeys] = await Promise.all([
    listProducts({ query, brandSlug: brand.slug }),
    listBrandCategoryKeys(brand.slug),
  ]);
  /*
   * Computed from what is in stock right now, not from the filtered listing:
   * the summary describes the brand, so it must not change when a visitor
   * narrows the list below it.
   */
  const systems = systemsForCategories(categoryKeys);
  const summary = composeBrandSummary(brand.name, systems);

  const path = brandHref(locale, brand);
  const breadcrumbs = listingBreadcrumbs(locale, [
    { name: BRANDS_INDEX_META.name, href: href(locale, routes.brands) },
    { name: brand.name, href: path },
  ]);

  /*
   * Up, never round in circles: the brand page links to the listing of each
   * system and format it is stocked in, by that listing's own name, and those
   * listings do not link back here. Someone who came for „Lavazza“ and wants
   * to compare it with the rest of what fits their machine is one tap away.
   */
  const shelves = systems.map((system) => {
    const keys = systemCategory(system);
    return {
      id: system.id,
      name: categoryNameFor({ ...keys, name: system.name }),
      href: categoryHref(locale, keys),
    };
  });

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <JsonLd
        id="ld-brand"
        data={{
          "@context": "https://schema.org",
          ...brandJsonLd(brand),
          ...(brand.description ? { description: brand.description } : {}),
        }}
      />

      <Breadcrumbs items={breadcrumbs} />

      <header className="mb-8 max-w-prose">
        {/* The brand's own logo above its name; the `h1` stays text. A brand
            with no logo shows nothing here — the name follows anyway. */}
        <BrandLogo brand={brand} size="header" fallback="none" inline eager className="mb-4" />
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">
          {brand.name}
        </h1>
        {brand.tagline && <p className="mt-1.5 text-base text-ink-500 italic">{brand.tagline}</p>}
        {brand.description && <p className="mt-3 text-base text-ink-500">{brand.description}</p>}
        {summary && (
          <p className="mt-3 text-base text-ink-500">
            {summary.sentence}
            {summary.capsuleNote && (
              <>
                {" "}
                {summary.capsuleNote} Не сте сигурни коя система е вашата?{" "}
                <Link
                  href={href(locale, routes.machines)}
                  className="font-medium text-pine-700 underline underline-offset-2 hover:text-pine-900"
                >
                  Намерете машината си по марка и модел
                </Link>
                .
              </>
            )}
          </p>
        )}
        {shelves.length > 0 && (
          <nav aria-label={`${brand.name} и останалите марки по вид кафе`} className="mt-4">
            <p className="text-sm text-ink-500">Сравнете с останалите марки:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {shelves.map((shelf) => (
                <li key={shelf.id}>
                  <Link
                    href={shelf.href}
                    data-system={shelf.id}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-sm border border-line bg-paper-raised px-3 text-sm font-medium text-ink-900 transition-colors hover:border-pine-500"
                  >
                    <span aria-hidden className="h-2 w-2 shrink-0 bg-(--system)" />
                    {shelf.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {await RelatedLandings({ locale, subject: { brand } })}
      </header>

      <CatalogListing
        locale={locale}
        basePath={path}
        query={query}
        result={result}
        // Filtering by brand on a brand page would be meaningless.
        hideBrands
        emptyTitle={`В момента няма продукти на ${brand.name}`}
        emptyDescription="В момента не предлагаме тази марка. Обадете ни се — може да успеем да я доставим."
      />
    </div>
  );
}
