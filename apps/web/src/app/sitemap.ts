import type { MetadataRoute } from "next";
import { absoluteUrl, siteConfig } from "@/config/site";
import { SHIPPING_LOCALES } from "@/i18n/config";
import { countPromotions, getCategoryTree, listBrands } from "@/lib/catalog/queries";
import { BUSINESS_SECTIONS, type BusinessSection } from "@/lib/catalog/business-sections";
import { getLandingAvailability } from "@/lib/catalog/landing-queries";
import { LANDING_IDS, LANDING_PATHS } from "@/lib/catalog/landings";
import { listSitemapProducts, type SitemapProduct } from "@/lib/catalog/sitemap-queries";
import type { CategoryView } from "@/lib/catalog/types";
import { listVendingBlends, sectionListsProducts } from "@/lib/catalog/vending";
import { JOURNAL_PATH, listArticles } from "@/lib/journal";
import { isSectionCategory } from "@/components/layout/navigation";
import { LEGAL_REVISIONS } from "@/content/legal-revisions";
import { MACHINE_BRANDS } from "@/content/machines";
import { languageAlternates, type LocalePath } from "@/lib/seo/alternates";
import { brandHref, categoryHref, href, productHref, routes } from "@/lib/routes";
import { brandLogoFor } from "../../content/brand-logos";

/**
 * Sitemap.
 *
 * Built from the live catalog, so it can never list a product we no longer
 * sell — the opposite of the reference site, whose sitemap still advertises
 * 111 URLs that return the home page.
 *
 * Only indexable pages appear: no search, no filtered listings, no answered
 * wizard, no legal boilerplate given artificial priority. The consumables page
 * is left out while it lists nothing, because it is `noindex` until then and a
 * sitemap entry for a page that asks not to be indexed is a contradiction. The
 * landing listings (Lavazza capsules and beans, decaf, cheapest per cup,
 * flavoured) follow the same rule from the other side: each is a 404 while its
 * selection is empty, and is listed here only while it is not. The promotions
 * page is the third case: it answers 200 with nothing reduced, so that no link
 * to it breaks, but it is `noindex` then, and it is listed here only while a
 * reduction exists.
 *
 * **Every page once per shipping locale, each entry carrying the page's whole
 * `hreflang` set**, `x-default` included — the same set the page's own head
 * declares (`lib/seo/alternates.ts`). Grouped by page, not by locale, because
 * the set belongs to the page. While Bulgarian alone ships, that is one `bg`
 * entry per page with a `bg` and an `x-default` alternate.
 *
 * **`lastModified` is a real date or nothing.** A product's is its last
 * genuine change. A listing's — a category, a brand, a landing, the
 * promotions, the vending section, the home page and the two indexes — is the
 * newest change among the products it shows. An article's is its revision
 * date, the journal's its newest article's, a legal page's the day its text
 * last changed (`content/legal-revisions.ts`). The pages nothing dates — the
 * wizard, the machine finder, delivery, contact — carry none. It used to be
 * the time of generation for all of those, which moves on every fetch; Google
 * learns to ignore a `lastmod` like that, and then ignores the true ones too.
 *
 * **Images.** A product lists its photographs (image sitemaps, which Google
 * reads for image search — an image pack is on 23 of the 28 result pages in
 * `docs/seo.md` §4), and a brand page lists the brand's logo where we hold
 * one. Absolute URLs, on the image host where the photographs live.
 *
 * Every URL appears once. The two business sections are listed by their own
 * pages; the day the sync files products under them, the categories behind
 * them are left out here, as they are left out of the menu, so the same shelf
 * is not advertised at two addresses.
 */
export const revalidate = 3600;

interface Page {
  readonly path: LocalePath;
  readonly lastModified: Date | undefined;
  readonly changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  readonly priority: number;
  readonly images?: readonly string[];
}

const at =
  (canonical: string): LocalePath =>
  (locale) =>
    href(locale, canonical);

/** The newest of the dates given, or undefined when none is known. */
function newest(dates: ReadonlyArray<Date | null | undefined>): Date | undefined {
  let latest: Date | undefined;
  for (const date of dates) if (date && (!latest || date > latest)) latest = date;
  return latest;
}

const changed = (products: readonly SitemapProduct[]) =>
  newest(products.map((product) => product.updatedAt));

function flatten(nodes: readonly CategoryView[]): CategoryView[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** Every key a category and the categories under it are filed by. */
function subtreeKeys(category: CategoryView): Set<string> {
  return new Set(
    flatten([category]).flatMap((node) => [node.slug, ...(node.sourceKey ? [node.sourceKey] : [])]),
  );
}

const filedUnder = (products: readonly SitemapProduct[], keys: ReadonlySet<string>) =>
  products.filter((product) => product.categoryKeys.some((key) => keys.has(key)));

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [pagesOfProducts, categories, brands, consumablesListed, landings, promotionCount, blends] =
    await Promise.all([
      listSitemapProducts(),
      getCategoryTree(),
      listBrands({ withProductsOnly: true }),
      sectionListsProducts("consumables"),
      getLandingAvailability(),
      countPromotions(),
      listVendingBlends(),
    ]);

  /* Every indexable product page is listed; only those on sale date the
     listings, since only those are shown on them. */
  const products = pagesOfProducts.filter((product) => product.listed);
  const allCategories = flatten(categories);
  const catalogChanged = changed(products);

  /** What a business section lists: its category's shelf, and for vending the blends. */
  const sectionChanged = (section: BusinessSection, extraSlugs: readonly string[] = []) => {
    const keys = new Set(
      allCategories
        .filter(
          (category) =>
            section.categoryKeys.includes(category.slug) ||
            (category.sourceKey !== null && section.categoryKeys.includes(category.sourceKey)),
        )
        .flatMap((category) => [...subtreeKeys(category)]),
    );
    const slugs = new Set(extraSlugs);
    return changed(
      products.filter(
        (product) => slugs.has(product.slug) || product.categoryKeys.some((key) => keys.has(key)),
      ),
    );
  };

  const landingChanged = (members: readonly string[] | undefined) => {
    const ids = new Set(members ?? []);
    return changed(products.filter((product) => ids.has(product.id)));
  };

  const legalChanged = (slug: string) => {
    const revision = LEGAL_REVISIONS[slug];
    return revision ? new Date(`${revision.revisedAt}T00:00:00.000Z`) : undefined;
  };

  const page = (
    path: LocalePath,
    changeFrequency: Page["changeFrequency"],
    priority: number,
    lastModified: Date | undefined,
    images?: readonly string[],
  ): Page => ({ path, changeFrequency, priority, lastModified, images });

  const pages: Page[] = [
    page(at(routes.home), "daily", 1, catalogChanged),
    page(at(routes.categories), "weekly", 0.8, catalogChanged),
    page(at(routes.brands), "weekly", 0.7, catalogChanged),
    ...(promotionCount > 0
      ? [
          page(
            at(routes.promotions),
            "daily",
            0.7,
            changed(products.filter((product) => product.reduced)),
          ),
        ]
      : []),
    page(at(routes.wizard), "monthly", 0.8, undefined),
    page(at(routes.machines), "monthly", 0.7, undefined),
    page(
      at(BUSINESS_SECTIONS.vending.path),
      "weekly",
      0.6,
      sectionChanged(
        BUSINESS_SECTIONS.vending,
        blends.map((blend) => blend.slug),
      ),
    ),
    ...(consumablesListed
      ? [
          page(
            at(BUSINESS_SECTIONS.consumables.path),
            "weekly",
            0.6,
            sectionChanged(BUSINESS_SECTIONS.consumables),
          ),
        ]
      : []),
    // Listings, so they change as often as the shelves they are cut from.
    ...LANDING_IDS.filter((id) => landings.counts[id] > 0).map((id) =>
      page(at(LANDING_PATHS[id]), "daily", 0.8, landingChanged(landings.members?.[id])),
    ),
    page(at(routes.delivery), "monthly", 0.5, undefined),
    page(at(routes.contact), "monthly", 0.5, undefined),
    page(at(routes.privacy), "yearly", 0.2, legalChanged("privacy")),
    page(at(routes.terms), "yearly", 0.2, legalChanged("terms")),
    page(at(routes.cookies), "yearly", 0.2, legalChanged("cookies")),
  ];

  // The journal costs nothing to list: its articles are files, not rows.
  const articles = siteConfig.features.blog ? listArticles() : [];
  const newestArticle = newest(articles.map((article) => article.lastModified));

  // The index is only worth advertising once it lists something.
  if (newestArticle) pages.push(page(at(JOURNAL_PATH), "weekly", 0.4, newestArticle));

  pages.push(
    /*
     * Machine compatibility pages. They answer a question people actually
     * type — "which capsules fit a Krups Piccolo" — and they are built from
     * our own data rather than the catalog, so they are stable enough to
     * advertise.
     */
    ...MACHINE_BRANDS.map((brand) =>
      page(at(routes.machineBrand(brand.slug)), "monthly", 0.6, undefined),
    ),
    ...allCategories
      .filter((category) => !isSectionCategory(category, BUSINESS_SECTIONS))
      .map((category) =>
        page(
          (locale) => categoryHref(locale, category),
          "daily",
          0.8,
          changed(filedUnder(products, subtreeKeys(category))),
        ),
      ),
    ...brands.map((brand) => {
      const logo = brandLogoFor(brand.slug);
      return page(
        (locale) => brandHref(locale, brand),
        "weekly",
        0.6,
        changed(products.filter((product) => product.brandSlug === brand.slug)),
        logo ? [absoluteUrl(logo.file)] : undefined,
      );
    }),
    ...pagesOfProducts.map((product) =>
      // The catalog sync only moves `updatedAt` when the product genuinely changed.
      page(
        (locale) => productHref(locale, product),
        "weekly",
        0.9,
        product.updatedAt ?? undefined,
        product.images.map((image) => absoluteUrl(image)),
      ),
    ),
    ...articles.map((article) => page(at(article.href), "monthly", 0.5, article.lastModified)),
  );

  const entries: MetadataRoute.Sitemap = pages.flatMap((entry) => {
    const languages = languageAlternates(entry.path);
    return SHIPPING_LOCALES.map((locale) => ({
      url: absoluteUrl(entry.path(locale)),
      ...(entry.lastModified ? { lastModified: entry.lastModified } : {}),
      changeFrequency: entry.changeFrequency,
      priority: entry.priority,
      alternates: { languages },
      ...(entry.images && entry.images.length > 0 ? { images: [...entry.images] } : {}),
    }));
  });

  // A URL listed twice is a mistake somewhere above; the first one stands.
  const seen = new Set<string>();
  return entries.filter((entry) => !seen.has(entry.url) && seen.add(entry.url));
}
