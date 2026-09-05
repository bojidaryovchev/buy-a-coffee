import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, EmptyState, SectionHeading } from "@/components/ui/primitives";
import { listBrands } from "@/lib/catalog/queries";
import { siteConfig } from "@/config/site";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Всички марки",
  description: `Всички марки кафе, които ${siteConfig.name} предлага.`,
  alternates: { canonical: "/brands" },
};

export default async function BrandsPage() {
  const brands = await listBrands();
  const stocked = brands.filter((brand) => brand.productCount > 0);
  /*
   * Brands with no products are listed but not linked: the reference site
   * publishes several of these, and a link to an empty page is a dead end.
   */
  const notStocked = brands.filter((brand) => brand.productCount === 0);

  return (
    <div className="shell pb-16">
      <Breadcrumbs
        items={[
          { name: "Начало", href: "/" },
          { name: "Марки", href: "/brands" },
        ]}
      />
      <SectionHeading
        as="h1"
        title="Марките, които предлагаме"
        description="Разгледайте асортимента по производител."
      />

      {stocked.length === 0 ? (
        <EmptyState
          title="Още няма марки"
          description="Каталогът все още се синхронизира. Моля, проверете отново скоро."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stocked.map((brand) => (
            <li key={brand.slug}>
              <Link
                href={`/brands/${brand.slug}`}
                className="group flex h-full flex-col rounded-md border border-line bg-paper-raised p-5 transition-colors hover:border-pine-500"
              >
                <h2 className="font-display text-lg font-semibold text-ink-900">{brand.name}</h2>
                {brand.tagline && (
                  <p className="mt-1 text-sm text-clay-600 italic">{brand.tagline}</p>
                )}
                {brand.description && (
                  <p className="mt-2 line-clamp-3 text-sm text-ink-500">{brand.description}</p>
                )}
                <p className="mt-auto pt-4 text-sm font-medium text-pine-700">
                  {brand.productCount} {brand.productCount === 1 ? "продукт" : "продукта"}
                  <span
                    aria-hidden
                    className="ml-1.5 inline-block transition-transform group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {notStocked.length > 0 && (
        <section className="mt-12 border-t border-line pt-8">
          <h2 className="font-display text-lg font-semibold">Налични по поръчка</h2>
          <p className="mt-1 text-sm text-ink-500">
            Можем да ги доставим по заявка — обадете ни се.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {notStocked.map((brand) => (
              <li
                key={brand.slug}
                className="rounded-sm border border-line bg-paper-sunken px-3 py-1.5 text-sm text-ink-500"
              >
                {brand.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
