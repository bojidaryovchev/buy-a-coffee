import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { Breadcrumbs } from "@/components/ui/primitives";
import { CatalogListing } from "@/components/catalog/catalog-listing";
import { RelatedLandings } from "@/components/catalog/related-landings";
import { SystemBadge } from "@/components/catalog/system-badge";
import { JsonLd } from "@/components/seo/json-ld";
import {
  buildSearchParams,
  parseCatalogQuery,
  shouldIndexListing,
  type RawSearchParams,
} from "@/lib/catalog/filters";
import { getListingFacts } from "@/lib/catalog/listing-facts";
import { listProducts } from "@/lib/catalog/queries";
import type { CategoryView } from "@/lib/catalog/types";
import {
  categoryCopyFor,
  categoryNameFor,
  segmentParagraph,
} from "../../../../../../content/category-copy";
import {
  breadcrumbJsonLd,
  categoryCrumbs,
  itemListJsonLd,
  listingBreadcrumbs,
} from "@/lib/seo/json-ld";
import { localeAlternates } from "@/lib/seo/alternates";
import { shareMetadata } from "@/lib/seo/share";
import {
  categoryDescriptionLead,
  categoryHeading,
  categoryTitle,
  metaDescription,
  pageTitle,
} from "@/lib/seo/listing-meta";
import { siteConfig } from "@/config/site";
import type { Locale } from "@/i18n/config";
import { getArticle } from "@/lib/journal";
import { categoryHref, href, productHref, routes, targetHref } from "@/lib/routes";
import { BREWING_SYSTEMS, type BrewingSystem } from "@/lib/recommend/systems";
import { brewingSystemForCategory, businessSectionForCategory } from "../../_lib/category-scope";

/**
 * A category listing, at `/<locale>/<landing slug>`.
 *
 * Reached through `[slug]/page.tsx`, which decides that the slug is a category
 * before this renders. Parent categories include their children's products.
 */

/**
 * Subcategories with something in them, each with the system it holds. On
 * „Кафе капсули“ these are the five capsule systems, which is the choice a
 * visitor has to make before any other — so they come in the order the shop
 * lists its systems everywhere else, ahead of anything that is not one.
 *
 * Shared by the page and its metadata: the title of a parent listing names the
 * systems the chips below it link to, and the two must be the same list.
 */
function stockedChildren(category: CategoryView) {
  const systemOrder = (system: BrewingSystem | null) =>
    system ? BREWING_SYSTEMS.indexOf(system) : BREWING_SYSTEMS.length;
  return (
    category.children
      .filter((child) => child.productCount > 0)
      .map((child) => ({ ...child, system: brewingSystemForCategory(child) }))
      // Stable, so subcategories that are not systems keep the catalog's order.
      .sort((a, b) => systemOrder(a.system) - systemOrder(b.system))
  );
}

/**
 * Title and description say what searchers type (`docs/seo.md` §12), and the
 * description carries the two things no other shop's snippet can: what a cup
 * costs here, and that ordering is a phone call. Both are computed from the
 * unfiltered listing, because that is the page the canonical names.
 */
export async function categoryMetadata(
  locale: Locale,
  category: CategoryView,
  rawParams: RawSearchParams,
): Promise<Metadata> {
  const query = parseCatalogQuery(rawParams);
  const indexable = shouldIndexListing(query);
  const facts = await getListingFacts({ kind: "category", slug: category.slug });
  const metaFacts = {
    uniformPieceCount: facts.uniformPieceCount,
    children: stockedChildren(category),
  };

  const title = categoryTitle(category, metaFacts);
  const description = metaDescription(categoryDescriptionLead(category, metaFacts), facts.cupRange);

  return {
    title: pageTitle(title),
    description,
    // The canonical always points at the unfiltered first page, so filtered
    // permutations consolidate rather than compete.
    alternates: localeAlternates(locale, (each) => categoryHref(each, category)),
    // And a filtered view, shared, is attributed to that same clean page.
    ...shareMetadata({ locale, title, description, path: categoryHref(locale, category) }),
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
  const heading = categoryHeading(category);

  /** Set when everything listed here goes in one kind of machine. */
  const system = brewingSystemForCategory(category);

  const children = stockedChildren(category);

  const parent = category.parentSlug
    ? (tree.find((entry) => entry.slug === category.parentSlug) ?? null)
    : null;

  const path = categoryHref(locale, category);
  /* By format, with no index page in between: Начало › Кафе капсули ›
     Капсули за Dolce Gusto. The JSON-LD below is built from the same list. */
  const breadcrumbs = listingBreadcrumbs(locale, categoryCrumbs(locale, category, parent));

  /*
   * The one article that answers this listing's question, when the journal is
   * on and still has it. Looked up by the slug the article itself exports, so
   * a retitled or renamed article is followed and a withdrawn one leaves no
   * dead link.
   */
  const article = intro?.article && siteConfig.features.blog ? getArticle(intro.article) : null;

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
          heading,
        )}
      />

      <Breadcrumbs items={breadcrumbs} />

      <header className="mb-8">
        {system && (
          <p className="mb-2">
            <SystemBadge systemId={system.id} size="md" />
          </p>
        )}
        <h1 className="font-display text-2xl font-semibold text-ink-900 md:text-4xl">{heading}</h1>
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
            {/*
             * The listing's one link back to the machine finder. A system's
             * page is where a visitor who guessed the system lands, so the way
             * out is here, above the products, and nowhere else on the page.
             */}
            <Link
              href={href(locale, routes.machines)}
              className="font-medium text-pine-700 underline underline-offset-4 hover:text-pine-900"
            >
              Не знаете системата? Намерете машината си
            </Link>
          </p>
        )}

        {children.length > 0 && (
          <nav aria-label={`Подкатегории на ${heading}`} className="mt-5">
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
                    {/* Named as its own page is — „Капсули за Dolce Gusto“ — so
                        the link says what it leads to, and a coloured square
                        never stands alone. */}
                    {categoryNameFor(child)}
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
        {await RelatedLandings({ locale, subject: { category } })}
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
              <p key={paragraph}>
                {/* A paragraph that names another listing links to it, with
                    the words that listing is known by. */}
                {segmentParagraph(paragraph, intro.links).map((segment) =>
                  typeof segment === "string" ? (
                    segment
                  ) : (
                    <Link
                      key={segment.phrase}
                      href={targetHref(locale, segment.to)}
                      className="font-medium text-pine-700 underline underline-offset-2 hover:text-pine-900"
                    >
                      {segment.phrase}
                    </Link>
                  ),
                )}
              </p>
            ))}
          </div>
          <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            {article && (
              <li>
                <Link
                  href={href(locale, routes.article(article.slug))}
                  className="text-pine-700 underline underline-offset-2 hover:text-pine-900"
                >
                  {article.title}
                </Link>
              </li>
            )}
            <li>
              <Link
                href={href(locale, routes.wizard)}
                className="text-pine-700 underline underline-offset-2 hover:text-pine-900"
              >
                Помощник за избор на кафе
              </Link>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
