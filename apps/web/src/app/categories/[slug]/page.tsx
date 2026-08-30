import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { JsonLd } from "@/components/seo/json-ld";
import { parseCatalogQuery, shouldIndexListing, type RawSearchParams } from "@/lib/catalog/filters";
import { getCategoryBySlug, getCategoryTree, listProducts } from "@/lib/catalog/queries";
import { breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo/json-ld";
import { siteConfig } from "@/config/site";

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ slug }, rawParams] = await Promise.all([params, searchParams]);
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: "Категорията не е намерена", robots: { index: false, follow: true } };

  const query = parseCatalogQuery(rawParams);
  const indexable = shouldIndexListing(query);

  return {
    title: category.name,
    description:
      category.description ??
      `${category.name} — ${category.productCount} продукта от ${siteConfig.name}.`,
    // The canonical always points at the unfiltered first page, so filtered
    // permutations consolidate rather than compete.
    alternates: { canonical: `/categories/${category.slug}` },
    robots: indexable ? undefined : { index: false, follow: true },
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const [{ slug }, rawParams] = await Promise.all([params, searchParams]);
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const query = parseCatalogQuery(rawParams);
  const result = await listProducts({ query, categorySlug: category.slug });

  const parent = category.parentSlug
    ? (await getCategoryTree()).find((entry) => entry.slug === category.parentSlug)
    : null;

  const breadcrumbs = [
    { name: "Начало", href: "/" },
    { name: "Категории", href: "/categories" },
    ...(parent ? [{ name: parent.name, href: `/categories/${parent.slug}` }] : []),
    { name: category.name, href: `/categories/${category.slug}` },
  ];

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <JsonLd
        id="ld-itemlist"
        data={itemListJsonLd(
          result.items.map((product) => ({ name: product.name, href: `/products/${product.slug}` })),
          category.name,
        )}
      />

      <Breadcrumbs items={breadcrumbs} />

      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">{category.name}</h1>
        {category.description && (
          <p className="mt-2 max-w-prose text-base text-ink-500">{category.description}</p>
        )}

        {category.children.length > 0 && (
          <nav aria-label={`Подкатегории на ${category.name}`} className="mt-5">
            <ul className="flex flex-wrap gap-2">
              {category.children.map((child) => (
                <li key={child.slug}>
                  <Link
                    href={`/categories/${child.slug}`}
                    className="inline-flex items-baseline gap-1.5 rounded-sm border border-line bg-paper-raised px-3 py-1.5 text-sm hover:border-pine-500"
                  >
                    {child.name}
                    <span className="text-2xs text-ink-300">{child.productCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <CatalogListing
        basePath={`/categories/${category.slug}`}
        query={query}
        result={result}
        hideCategories={category.children.length === 0}
        emptyTitle={`В момента няма нищо в ${category.name}`}
        emptyDescription="В момента тази категория е празна. Опитайте друга част от асортимента или ни се обадете."
      />
    </div>
  );
}
