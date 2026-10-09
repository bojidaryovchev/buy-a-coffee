import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { SystemBadge } from "@/components/catalog/system-badge";
import { JsonLd } from "@/components/seo/json-ld";
import {
  buildSearchParams,
  parseCatalogQuery,
  shouldIndexListing,
  type RawSearchParams,
} from "@/lib/catalog/filters";
import { listProducts } from "@/lib/catalog/queries";
import type { CategoryView } from "@/lib/catalog/types";
import { categoryCopyFor } from "../../../../../../content/category-copy";
import { breadcrumbJsonLd, itemListJsonLd } from "@/lib/seo/json-ld";
import { localeAlternates } from "@/lib/seo/alternates";
import { siteConfig } from "@/config/site";
import type { Locale } from "@/i18n/config";
import { categoryHref, href, productHref, routes } from "@/lib/routes";
import { BREWING_SYSTEMS, type BrewingSystem } from "@/lib/recommend/systems";
import { brewingSystemForCategory, businessSectionForCategory } from "../../_lib/category-scope";

/**
 * A category listing, at `/<locale>/<landing slug>`.
 *
 * Reached through `[slug]/page.tsx`, which decides that the slug is a category
 * before this renders. Parent categories include their children's products.
 */

export function categoryMetadata(
  locale: Locale,
  category: CategoryView,
  rawParams: RawSearchParams,
): Metadata {
  const query = parseCatalogQuery(rawParams);
  const indexable = shouldIndexListing(query);

  return {
    title: category.name,
    description:
      category.description ??
      `${category.name} — ${category.productCount} продукта от ${siteConfig.name}.`,
    // The canonical always points at the unfiltered first page, so filtered
    // permutations consolidate rather than compete.
    alternates: localeAlternates(locale, (each) => categoryHref(each, category)),
    robots: indexable ? undefined : { index: false, follow: true },
  };
}

export async function CategoryPage({
  locale,
  category,
  tree,
  rawParams,
}: {
  locale: Locale;
  category: CategoryView;
  tree: readonly CategoryView[];
  rawParams: RawSearchParams;
}) {
  const query = parseCatalogQuery(rawParams);

  /*
   * A category that backs a business section has one address, and it is the
   * section's. Decided before anything is rendered, so the answer is a 308
   * and not a page that then navigates away. Filters travel with it: the
   * section page lists the same products through the same listing.
   */
  const section = businessSectionForCategory(category);
  if (section) permanentRedirect(href(locale, `${section.path}${buildSearchParams(query)}`));

  const result = await listProducts({ query, categorySlug: category.slug });
  /*
   * Only on the first page. Page two of a listing is the same category, and
   * repeating the same three paragraphs under every page of it adds nothing
   * for the visitor who has already scrolled past them once.
   */
  const intro = query.page === 1 ? categoryCopyFor(category) : null;

  /** Set when everything listed here goes in one kind of machine. */
  const system = brewingSystemForCategory(category);

  /*
   * Subcategories with something in them, each with the system it holds. On
   * „Капсули“ these are the five capsule systems, which is the choice a
   * visitor has to make before any other — so they come in the order the
   * shop lists its systems everywhere else, ahead of anything that is not one.
   */
  const systemOrder = (system: BrewingSystem | null) =>
    system ? BREWING_SYSTEMS.indexOf(system) : BREWING_SYSTEMS.length;
  const children = category.children
    .filter((child) => child.productCount > 0)
    .map((child) => ({ ...child, system: brewingSystemForCategory(child) }))
    // Stable, so subcategories that are not systems keep the catalog's order.
    .sort((a, b) => systemOrder(a.system) - systemOrder(b.system));

  const parent = category.parentSlug
    ? tree.find((entry) => entry.slug === category.parentSlug)
    : null;

  const path = categoryHref(locale, category);
  const breadcrumbs = [
    { name: "Начало", href: href(locale, routes.home) },
    { name: "Категории", href: href(locale, routes.categories) },
    ...(parent ? [{ name: parent.name, href: categoryHref(locale, parent) }] : []),
    { name: category.name, href: path },
  ];

  return (
    <div className="shell pb-16">
      <JsonLd id="ld-breadcrumbs" data={breadcrumbJsonLd(breadcrumbs)} />
      <JsonLd
        id="ld-itemlist"
        data={itemListJsonLd(
          result.items.map((product) => ({
            name: product.name,
            href: productHref(locale, product),
          })),
          category.name,
        )}
      />

      <Breadcrumbs items={breadcrumbs} />

      <header className="mb-8">
        {system && (
          <p className="mb-2">
            <SystemBadge systemId={system.id} size="md" />
          </p>
        )}
        <h1 className="font-display text-2xl font-semibold text-ink-900 md:text-4xl">
          {category.name}
        </h1>
        {category.description && (
          <p className="mt-3 max-w-measure text-base text-ink-700">{category.description}</p>
        )}

        {system && (
          <p className="mt-3 max-w-measure text-base text-ink-700">
            {/*
             * Only a capsule system names a family of machines. For beans and
             * pods the system's name is a kind of coffee, so its own summary
             * says what it goes in.
             */}
            {system.method === "capsule" ? `Става за машини ${system.name}.` : system.summary}{" "}
            <Link
              href={href(locale, routes.machines)}
              className="font-medium text-pine-700 underline underline-offset-4 hover:text-pine-900"
            >
              Проверете вашата машина
            </Link>
          </p>
        )}

        {children.length > 0 && (
          <nav aria-label={`Подкатегории на ${category.name}`} className="mt-5">
            {/*
             * One scrolling row on a phone, where five chips would otherwise
             * take three lines above the products; wrapped from `md`.
             * `relative` makes the row the containing block of the chips'
             * screen-reader text, which is absolutely positioned and would
             * otherwise escape the scroll container and widen the page.
             */}
            <ul className="relative -mx-4 flex snap-x gap-2 overflow-x-auto px-4 py-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
              {children.map((child) => (
                <li key={child.slug} className="shrink-0 snap-start">
                  <Link
                    href={categoryHref(locale, child)}
                    {...(child.system ? { "data-system": child.system.id } : {})}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-sm border border-line bg-paper-raised px-3 text-sm font-medium text-ink-900 transition-colors hover:border-pine-500"
                  >
                    {child.system && (
                      <span aria-hidden className="h-2 w-2 shrink-0 bg-(--system)" />
                    )}
                    {/* The system's own name: a coloured square never stands alone. */}
                    {child.system?.name ?? child.name}
                    <span className="text-2xs text-ink-300 tabular-nums">
                      {child.productCount}
                      <span className="sr-only"> продукта</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <CatalogListing locale={locale} basePath={path} query={query} result={result} />

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
                href={href(locale, routes.wizard)}
                className="text-pine-700 underline underline-offset-2 hover:text-pine-900"
              >
                Помощник за избор на кафе
              </Link>
            </li>
            <li>
              <Link
                href={href(locale, routes.machines)}
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
