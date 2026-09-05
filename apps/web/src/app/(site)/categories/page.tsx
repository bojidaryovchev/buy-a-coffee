import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, EmptyState, SectionHeading } from "@/components/ui/primitives";
import { getCategoryTree } from "@/lib/catalog/queries";
import { siteConfig } from "@/config/site";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Всички категории",
  description: `Разгледайте целия асортимент на ${siteConfig.name}: кафе на зърна, капсули, дози и още.`,
  alternates: { canonical: "/categories" },
};

export default async function CategoriesPage() {
  const categories = await getCategoryTree();

  return (
    <div className="shell pb-16">
      <Breadcrumbs
        items={[
          { name: "Начало", href: "/" },
          { name: "Категории", href: "/categories" },
        ]}
      />
      <SectionHeading
        as="h1"
        title="Разгледайте по вид"
        description="Целият асортимент, подреден според начина на приготвяне."
      />

      {categories.length === 0 ? (
        <EmptyState
          title="Каталогът все още се синхронизира"
          description="Моля, проверете отново скоро."
        />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <li key={category.slug} className="rounded-md border border-line bg-paper-raised p-6">
              <h2 className="font-display text-xl font-semibold">
                <Link
                  href={`/categories/${category.slug}`}
                  className="underline-offset-4 hover:underline"
                >
                  {category.name}
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
                        href={`/categories/${child.slug}`}
                        className="flex items-center justify-between text-sm text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline"
                      >
                        {child.name}
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
