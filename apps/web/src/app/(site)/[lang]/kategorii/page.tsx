import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, EmptyState, SectionHeading } from "@/components/ui/primitives";
import { JsonLd } from "@/components/seo/json-ld";
import { getListingFacts } from "@/lib/catalog/listing-facts";
import { getCategoryTree } from "@/lib/catalog/queries";
import { localeFrom, type LangParams } from "@/i18n/params";
import { BUSINESS_SECTIONS } from "@/lib/catalog/business-sections";
import { isSectionCategory } from "@/components/layout/navigation";
import { pageAlternates } from "@/lib/seo/alternates";
import { breadcrumbJsonLd, listingBreadcrumbs } from "@/lib/seo/json-ld";
import { CATEGORIES_INDEX_META, metaDescription, pageTitle } from "@/lib/seo/listing-meta";
import { categoryHref, href, routes } from "@/lib/routes";
import { categoryNameFor } from "../../../../../content/category-copy";

export const revalidate = 300;

interface PageProps {
  params: Promise<LangParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeFrom(params);
  const facts = await getListingFacts({ kind: "all" });
  return {
    /* No search term is this page's own (`docs/seo.md` §1 gives it none), so
       the title describes the page without borrowing a listing's term. */
    title: pageTitle(CATEGORIES_INDEX_META.title),
    description: metaDescription(CATEGORIES_INDEX_META.description, facts.cupRange),
    alternates: pageAlternates(locale, routes.categories),
  };
}

export default async function CategoriesPage({ params }: PageProps) {
  const locale = await localeFrom(params);
  const tree = await getCategoryTree();
  /*
   * A category that backs a business section is reached through that page,
   * and its own slug redirects there. A link to it here would be a link to a
   * redirect, under a second name.
   */
  const outside = (category: (typeof tree)[number]) =>
    !isSectionCategory(category, BUSINESS_SECTIONS);
  const categories = tree.filter(outside).map((category) => ({
    ...category,
    children: category.children.filter(outside),
  }));

  const breadcrumbs = listingBreadcrumbs(locale, [
    { name: CATEGORIES_INDEX_META.name, href: href(locale, routes.categories) },
  ]);

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <Breadcrumbs items={breadcrumbs} />
      <SectionHeading
        as="h1"
        title={CATEGORIES_INDEX_META.name}
        description="Целият асортимент, подреден според начина на приготвяне."
      />

      {categories.length === 0 ? (
        <EmptyState title="Асортиментът се обновява" description="Моля, проверете отново скоро." />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <li key={category.slug} className="rounded-md border border-line bg-paper-raised p-6">
              <h2 className="font-display text-xl font-semibold">
                <Link
                  href={categoryHref(locale, category)}
                  className="underline-offset-4 hover:underline"
                >
                  {/* Each listing by the name its own page carries. */}
                  {categoryNameFor(category)}
                </Link>
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                {category.productCount} {category.productCount === 1 ? "продукт" : "продукта"}
              </p>

              {category.children.length > 0 && (
                <ul className="mt-4 space-y-1.5 border-t border-line pt-4">
                  {category.children.map((child) => (
                    <li key={child.slug}>
                      <Link
                        href={categoryHref(locale, child)}
                        className="flex items-center justify-between text-sm text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
                      >
                        {categoryNameFor(child)}
                        <span className="text-2xs text-ink-300">{child.productCount}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
