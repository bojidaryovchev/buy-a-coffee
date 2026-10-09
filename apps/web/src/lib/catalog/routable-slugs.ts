import type { Database } from "@catalog/db";
import { brands, products } from "@catalog/db/schema";
import { eq } from "drizzle-orm";
import { LOCALES } from "@/i18n/config";
import { brandSlug } from "@/lib/routes";

/**
 * Every product and brand slug that must reach its page, in one read.
 *
 * **For the proxy's existence check** (`lib/catalog/slug-exists.ts`), which
 * rewrites a `/bg/<slug>` or `/bg/marki/<slug>` the catalog does not hold to
 * the server-rendered 404 before the route tree sees it. That check has to
 * know about two kinds of slug no stored `slug` column holds, or it would 404
 * the very URLs that are meant to redirect:
 *
 *   - **a product's previous slugs** (`products.previous_slugs`): the page
 *     answers them with a 308 to the product's current slug
 *     (`resolve-slug.ts`). Every product has one after `catalog:reslug`, and
 *     they are the addresses search engines hold today;
 *   - **a brand's published slug** where it is curated (`lollo-caffe`,
 *     `brandSlug` in `lib/routes.ts`): the page lives there, and the stored
 *     slug (`lollocafe`) must still reach the page too, to be redirected.
 *
 * So `products` is each product's current slug and every slug it has had,
 * whatever its status (a removed product keeps its page), and `brands` is each
 * active brand's stored slug and its published slug in every locale. Categories
 * are not here: nothing about them changed.
 *
 * Takes the database as an argument rather than importing `lib/db`, which
 * opens a pool when it loads; the proxy imports that lazily, for the reason
 * given in `slug-exists.ts`.
 */
export interface RoutableSlugs {
  /** First-level: current and previous product slugs. */
  readonly products: ReadonlySet<string>;
  /** Under the brands segment: stored and published brand slugs. */
  readonly brands: ReadonlySet<string>;
}

export async function loadRoutableSlugs(db: Database): Promise<RoutableSlugs> {
  const [productRows, brandRows] = await Promise.all([
    db.select({ slug: products.slug, previousSlugs: products.previousSlugs }).from(products),
    db
      .select({ slug: brands.slug, sourceKey: brands.sourceKey })
      .from(brands)
      .where(eq(brands.status, "active")),
  ]);

  return {
    products: new Set(productRows.flatMap((row) => [row.slug, ...row.previousSlugs])),
    brands: new Set(
      brandRows.flatMap((row) => [row.slug, ...LOCALES.map((locale) => brandSlug(locale, row))]),
    ),
  };
}
