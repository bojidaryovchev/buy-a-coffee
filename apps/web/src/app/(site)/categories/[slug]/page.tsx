import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { JsonLd } from "@/components/seo/json-ld";
import { parseCatalogQuery, shouldIndexListing, type RawSearchParams } from "@/lib/catalog/filters";
import { getCategoryBySlug, getCategoryTree, listProducts } from "@/lib/catalog/queries";
import { getCategorySourceKey } from "@/lib/catalog/taxonomy";
import { categoryCopyFor } from "../../../../../content/category-copy";
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
  if (!category)
    return { title: "Категорията не е намерена", robots: { index: false, follow: true } };

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
  const [result, sourceKey] = await Promise.all([
    listProducts({ query, categorySlug: category.slug }),
    getCategorySourceKey(category.slug),
  ]);
  /*
   * Only on the first page. Page two of a listing is the same category, and
   * repeating the same three paragraphs under every page of it adds nothing
   * for the visitor who has already scrolled past them once.
   */
  const intro = query.page === 1 ? categoryCopyFor({ slug: category.slug, sourceKey }) : null;

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
          result.items.map((product) => ({
            name: product.name,
            href: `/products/${product.slug}`,
          })),
          category.name,
        )}
      />

      <Breadcrumbs items={breadcrumbs} />

      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-ink-900 md:text-4xl">
          {category.name}
        </h1>
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

      {/*
       * Below the listing on purpose: products stay first. Rendered here, as a
       * sibling of the listing, rather than through a slot inside it — the
       * text reads better at the full width of the page than squeezed beside
       * the filter column.
       */}
      {intro && (
        <section
          aria-labelledby="category-intro-heading"
          className="mt-14 border-t border-line pt-10"
        >
          <h2
            id="category-intro-heading"
            className="font-display text-2xl font-semibold text-ink-900"
          >
            {intro.heading}
          </h2>
          <div className="mt-4 max-w-prose space-y-3 text-base text-ink-500">
            {intro.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            <li>
              <Link
                href="/wizard"
                className="text-pine-700 underline underline-offset-2 hover:text-pine-900"
              >
                Помощник за избор на кафе
              </Link>
            </li>
            <li>
              <Link
                href="/wizard/machines"
                className="text-pine-700 underline underline-offset-2 hover:text-pine-900"
              >
                Списък с машини по марка и модел
              </Link>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
