import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { JsonLd } from "@/components/seo/json-ld";
import { parseCatalogQuery, shouldIndexListing, type RawSearchParams } from "@/lib/catalog/filters";
import { getBrandBySlug, listProducts } from "@/lib/catalog/queries";
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

  return {
    title: brand.name,
    description:
      brand.description ??
      `Кафе ${brand.name} в ${siteConfig.name} — ${brand.productCount} продукта.`,
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
  const result = await listProducts({ query, brandSlug: brand.slug });

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
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">
          {brand.name}
        </h1>
        {brand.tagline && <p className="mt-1.5 text-base text-clay-600 italic">{brand.tagline}</p>}
        {brand.description && <p className="mt-3 text-base text-ink-500">{brand.description}</p>}
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
