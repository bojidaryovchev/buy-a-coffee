import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { buildSearchParams, parseCatalogQuery, type RawSearchParams } from "@/lib/catalog/filters";
import { resolveSlug } from "@/lib/catalog/resolve-slug";
import { shippingLocale, type LangParams } from "@/i18n/params";
import { href } from "@/lib/routes";
import { businessSectionForCategory } from "../_lib/category-scope";
import { CategoryPage, categoryMetadata } from "./_components/category-page";
import { ProductPage, productMetadata } from "./_components/product-page";

/**
 * Every category and every product, at the first level under the locale:
 * `/bg/kafe-kapsuli`, `/bg/<product slug>`.
 *
 * One dynamic segment for both because the shortest URL that names the thing
 * is the one people share and search engines show — `/products/` and
 * `/categories/` told a reader nothing they did not already know. Which of the
 * two a slug is, and whether it is the spelling this locale publishes, is
 * `resolveSlug`'s answer; a slug that is neither is the 404.
 *
 * Static routes (`marki`, `tarsene`, …) never reach here: Next matches a static
 * folder first, and no category or product may take one of those names
 * (`RESERVED_SLUGS`, checked by `test/slug-collisions.db.test.ts`).
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<LangParams & { slug: string }>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  const locale = shippingLocale(lang);
  const resolved = await resolveSlug(locale, slug);
  if (!resolved || resolved.kind === "redirect") {
    return { title: "Страницата не е намерена", robots: { index: false, follow: true } };
  }
  return resolved.kind === "category"
    ? categoryMetadata(locale, resolved.category, await searchParams)
    : productMetadata(locale, resolved.product);
}

export default async function SlugPage({ params, searchParams }: PageProps) {
  const { lang, slug } = await params;
  const locale = shippingLocale(lang);
  const resolved = await resolveSlug(locale, slug);
  if (!resolved) notFound();

  /*
   * A category that backs a business section has one address, and it is the
   * section's — whichever of its slugs was asked for, in one hop. Filters
   * travel with it, and with any other redirect from here.
   */
  const category = resolved.kind === "product" ? undefined : resolved.category;
  const section = category ? businessSectionForCategory(category) : null;
  if (section || resolved.kind === "redirect") {
    const query = buildSearchParams(parseCatalogQuery(await searchParams));
    const to = section
      ? href(locale, section.path)
      : resolved.kind === "redirect"
        ? resolved.to
        : "";
    permanentRedirect(`${to}${query}`);
  }

  /* Awaited here rather than returned as elements, so this page renders to
     finished markup in one step — which is also what lets a test render it. */
  return resolved.kind === "category"
    ? await CategoryPage({
        locale,
        category: resolved.category,
        tree: resolved.tree,
        rawParams: await searchParams,
      })
    : await ProductPage({ locale, product: resolved.product });
}
