import Link from "next/link";
import type { Metadata } from "next";
import { ButtonLink, SectionHeading } from "@/components/ui/primitives";
import { ProductGrid } from "@/components/catalog/product-card";
import { siteConfig } from "@/config/site";
import {
  getCatalogSummary,
  getCategoryTree,
  listBrands,
  listNewArrivals,
  listProducts,
} from "@/lib/catalog/queries";
import { parseCatalogQuery } from "@/lib/catalog/filters";

/**
 * Home page.
 *
 * Every module is catalog-driven: the categories, brands and products shown
 * here come from the database, so the page reflects the real range rather
 * than a hardcoded list that drifts.
 *
 * Sections that would have nothing to show are omitted entirely rather than
 * rendering an empty shell — the promotions strip only appears when there
 * genuinely are promotions.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: `${siteConfig.name} — ${siteConfig.tagline}`,
  description: siteConfig.description,
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const [summary, categories, brands, newArrivals, promotions] = await Promise.all([
    getCatalogSummary(),
    getCategoryTree(),
    listBrands({ withProductsOnly: true }),
    listNewArrivals(8),
    listProducts({
      query: { ...parseCatalogQuery({}), pageSize: 4 },
      promotionsOnly: true,
      includeFacets: false,
    }),
  ]);

  const populatedCategories = categories.filter((category) => category.productCount > 0);

  return (
    <>
      {/* Hero */}
      <section className="border-b border-line bg-pine-900 text-paper">
        <div className="shell grid gap-10 py-14 md:grid-cols-12 md:items-center md:py-20">
          <div className="md:col-span-7">
            <p className="text-2xs font-medium tracking-[0.18em] uppercase text-clay-500">
              {summary.brands} марки · {summary.products} продукта
            </p>
            <h1 className="mt-3 font-display text-4xl leading-[1.1] font-semibold md:text-5xl">
              {siteConfig.tagline}
            </h1>
            <p className="mt-4 max-w-lg text-lg text-paper/80">{siteConfig.description}</p>

            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="/categories" size="lg" className="bg-clay-500 text-ink-900 hover:bg-clay-600 hover:text-paper">
                Разгледайте асортимента
              </ButtonLink>
              <ButtonLink
                href="/brands"
                size="lg"
                variant="ghost"
                className="border border-paper/30 text-paper hover:bg-paper/10 hover:text-paper"
              >
                Всички марки
              </ButtonLink>
            </div>
          </div>

          {/* Ordering explainer: the shop has no cart, so say so up front. */}
          <div className="md:col-span-5 md:justify-self-end">
            <div className="rounded-md border border-paper/15 bg-paper/5 p-6">
              <h2 className="font-display text-lg font-semibold">Поръчката е на една стъпка</h2>
              <ol className="mt-4 space-y-3 text-sm text-paper/80">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs bg-clay-500 text-2xs font-semibold text-ink-900">
                    1
                  </span>
                  Намерете кафето, което искате.
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs bg-clay-500 text-2xs font-semibold text-ink-900">
                    2
                  </span>
                  Оставете телефонния си номер.
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xs bg-clay-500 text-2xs font-semibold text-ink-900">
                    3
                  </span>
                  Звъним ви, за да потвърдим и да уговорим доставката.
                </li>
              </ol>
              <p className="mt-4 text-xs text-paper/60">
                Без регистрация и без количка. Предпочитате да говорим?{" "}
                <a href={`tel:${siteConfig.contact.phoneHref}`} className="underline underline-offset-2">
                  {siteConfig.contact.phone}
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      {populatedCategories.length > 0 && (
        <section className="shell py-14">
          <SectionHeading title="Изберете по вид" description="Целият асортимент, подреден така, както кафето наистина се купува." />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {populatedCategories.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/categories/${category.slug}`}
                  className="group flex h-full flex-col justify-between rounded-md border border-line bg-paper-raised p-6 transition-colors hover:border-pine-500"
                >
                  <div>
                    <h3 className="font-display text-xl font-semibold text-ink-900">{category.name}</h3>
                    <p className="mt-1 text-sm text-ink-500">
                      {category.productCount} {category.productCount === 1 ? "продукт" : "продукта"}
                    </p>
                  </div>
                  {category.children.length > 0 && (
                    <p className="mt-4 text-xs text-ink-500">
                      {category.children.map((child) => child.name).join(" · ")}
                    </p>
                  )}
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-pine-700">
                    Разгледай
                    <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Promotions — only when there are any */}
      {promotions.items.length > 0 && (
        <section className="border-y border-line bg-clay-100/60 py-14">
          <div className="shell">
            <SectionHeading
              title="Актуални промоции"
              description="Намалени в момента."
              action={
                <ButtonLink href="/promotions" variant="secondary" size="sm">
                  Всички промоции
                </ButtonLink>
              }
            />
            <ProductGrid products={promotions.items} priorityCount={0} />
          </div>
        </section>
      )}

      {/* New arrivals */}
      {newArrivals.length > 0 && (
        <section className="shell py-14">
          <SectionHeading
            title="Ново в асортимента"
            description="Най-новите попълнения."
            action={
              <ButtonLink href="/categories" variant="secondary" size="sm">
                Всичко
              </ButtonLink>
            }
          />
          <ProductGrid products={newArrivals} priorityCount={4} />
        </section>
      )}

      {/* Brands */}
      {brands.length > 0 && (
        <section className="border-t border-line py-14">
          <div className="shell">
            <SectionHeading
              title="Марките, които предлагаме"
              action={
                <ButtonLink href="/brands" variant="secondary" size="sm">
                  Всички марки
                </ButtonLink>
              }
            />
            <ul className="flex flex-wrap gap-2">
              {brands.map((brand) => (
                <li key={brand.slug}>
                  <Link
                    href={`/brands/${brand.slug}`}
                    className="inline-flex items-baseline gap-2 rounded-sm border border-line bg-paper-raised px-3.5 py-2 text-sm transition-colors hover:border-pine-500"
                  >
                    <span className="font-medium">{brand.name}</span>
                    <span className="text-2xs text-ink-300">{brand.productCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
