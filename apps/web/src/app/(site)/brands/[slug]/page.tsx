import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { JsonLd } from "@/components/seo/json-ld";
import { parseCatalogQuery, shouldIndexListing, type RawSearchParams } from "@/lib/catalog/filters";
import { getBrandBySlug, listProducts } from "@/lib/catalog/queries";
import { composeBrandSummary, systemsForCategories } from "@/lib/catalog/brand-summary";
import { listBrandCategoryKeys } from "@/lib/catalog/taxonomy";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { siteConfig } from "@/config/site";

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ slug }, rawParams] = await Promise.all([params, searchParams]);
  const brand = await getBrandBySlug(slug);
  if (!brand) return { title: "Марката не е намерена", robots: { index: false, follow: true } };

  const summary = composeBrandSummary(
    brand.name,
    systemsForCategories(await listBrandCategoryKeys(brand.slug)),
  );

  return {
    title: brand.name,
    description:
      brand.description ??
      // Says what is actually on the page; the generic line is for a brand
      // with nothing in stock, where there are no formats to name.
      (summary
        ? `${summary.sentence} Поръчайте от ${siteConfig.name}.`
        : `Кафе ${brand.name} в ${siteConfig.name}.`),
    alternates: { canonical: `/brands/${brand.slug}` },
    robots: shouldIndexListing(parseCatalogQuery(rawParams))
      ? undefined
      : { index: false, follow: true },
  };
}

export default async function BrandPage({ params, searchParams }: PageProps) {
  const [{ slug }, rawParams] = await Promise.all([params, searchParams]);
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();

  const query = parseCatalogQuery(rawParams);
  const [result, categoryKeys] = await Promise.all([
    listProducts({ query, brandSlug: brand.slug }),
    listBrandCategoryKeys(brand.slug),
  ]);
  /*
   * Computed from what is in stock right now, not from the filtered listing:
   * the summary describes the brand, so it must not change when a visitor
   * narrows the list below it.
   */
  const summary = composeBrandSummary(brand.name, systemsForCategories(categoryKeys));

  const breadcrumbs = [
    { name: "Начало", href: "/" },
    { name: "Марки", href: "/brands" },
    { name: brand.name, href: `/brands/${brand.slug}` },
  ];

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <JsonLd
        id="ld-brand"
        data={{
          "@context": "https://schema.org",
          "@type": "Brand",
          name: brand.name,
          ...(brand.description ? { description: brand.description } : {}),
        }}
      />

      <Breadcrumbs items={breadcrumbs} />

      <header className="mb-8 max-w-prose">
        {/*
         * Brand logo: this is where it goes, above the name. Deliberately not
         * rendered yet — we hold no logo files and no permission to use any,
         * and an image slot with nothing in it is worse than no slot. When
         * logos exist, add an optional `logo` to the brand view and render it
         * here only when present.
         */}
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
                  href="/wizard/machines"
                  className="font-medium text-pine-700 underline underline-offset-2 hover:text-pine-900"
                >
                  Намерете машината си по марка и модел
                </Link>
                .
              </>
            )}
          </p>
        )}
      </header>

      <CatalogListing
        basePath={`/brands/${brand.slug}`}
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
