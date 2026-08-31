import Link from "next/link";
import { Suspense } from "react";
import { siteConfig } from "@/config/site";
import type { CategoryView } from "@/lib/catalog/types";
import { SearchField } from "@/components/catalog/search-field";
import { SearchFieldFallback } from "@/components/catalog/search-field-fallback";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Wordmark } from "@/components/layout/wordmark";

/**
 * Site header.
 *
 * Original composition, not a reproduction of the reference layout: a slim
 * utility strip above a two-row masthead, with the wordmark on the left, the
 * search field taking the full centre on its own row, and category navigation
 * as an underlined rail rather than pill buttons.
 *
 * Rendered on the server. The only client components are the ones that must
 * be: the mobile drawer and the search field.
 */
export function SiteHeader({ categories }: { categories: readonly CategoryView[] }) {
  const primary = categories.filter((category) => category.productCount > 0 || category.children.length > 0);
  const extra = categories.filter((category) => !primary.includes(category));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
      {/* Utility strip */}
      <div className="hidden border-b border-line bg-pine-900 text-paper md:block">
        <div className="shell flex h-9 items-center justify-between text-2xs">
          <p className="tracking-wide uppercase opacity-90">{siteConfig.tagline}</p>
          <div className="flex items-center gap-5">
            <span className="opacity-80">{siteConfig.contact.hours}</span>
            <a
              href={`tel:${siteConfig.contact.phoneHref}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {siteConfig.contact.phone}
            </a>
          </div>
        </div>
      </div>

      <div className="shell">
        {/*
          Masthead. The search field is rendered exactly once and wraps onto
          its own row on small screens. Rendering a second, hidden copy would
          duplicate a form control in the accessibility tree and in the DOM.
        */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
          <MobileNav categories={categories} />

          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label={`${siteConfig.name} — начало`}
          >
            <Wordmark />
          </Link>

          <a
            href={`tel:${siteConfig.contact.phoneHref}`}
            className="ml-auto shrink-0 text-sm font-medium text-pine-700 underline-offset-4 hover:underline md:hidden"
          >
            Обадете се
          </a>

          <div className="order-last w-full min-w-0 md:order-none md:ml-auto md:w-auto md:max-w-md md:flex-1">
            {/*
              SearchField reads the URL to stay in sync, which would opt every
              page out of static rendering. The boundary keeps that cost local
              to the field itself.
            */}
            <Suspense fallback={<SearchFieldFallback />}>
              <SearchField />
            </Suspense>
          </div>
        </div>

        {/* Category rail */}
        <nav aria-label="Категории продукти" className="hidden md:block">
          <ul className="-mb-px flex flex-wrap items-center gap-x-7 gap-y-1">
            {primary.map((category) => (
              <li key={category.slug} className="group relative">
                <Link
                  href={`/categories/${category.slug}`}
                  className="inline-flex items-center gap-1.5 border-b-2 border-transparent py-3 text-sm font-medium text-ink-700 transition-colors hover:border-clay-500 hover:text-ink-900"
                >
                  {category.name}
                  {category.children.length > 0 && (
                    <span aria-hidden className="text-2xs text-ink-300">
                      ▾
                    </span>
                  )}
                </Link>

                {category.children.length > 0 && (
                  <div className="invisible absolute left-0 top-full z-50 min-w-56 rounded-md border border-line bg-paper-raised p-1.5 opacity-0 shadow-float transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                    <Link
                      href={`/categories/${category.slug}`}
                      className="block rounded-sm px-3 py-2 text-sm font-medium text-pine-700 hover:bg-pine-100"
                    >
                      Всички {category.name.toLowerCase()}
                      <span className="ml-1 text-2xs text-ink-500">({category.productCount})</span>
                    </Link>
                    {category.children.map((child) => (
                      <Link
                        key={child.slug}
                        href={`/categories/${child.slug}`}
                        className="flex items-center justify-between rounded-sm px-3 py-2 text-sm text-ink-700 hover:bg-paper-sunken hover:text-ink-900"
                      >
                        {child.name}
                        <span className="text-2xs text-ink-300">{child.productCount}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}

            {extra.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/categories/${category.slug}`}
                  className="inline-flex border-b-2 border-transparent py-3 text-sm text-ink-500 transition-colors hover:border-clay-500 hover:text-ink-900"
                >
                  {category.name}
                </Link>
              </li>
            ))}

            <li className="ml-auto flex items-center gap-7">
              <Link
                href="/wizard"
                className="inline-flex border-b-2 border-transparent py-3 text-sm font-medium text-ink-700 transition-colors hover:border-clay-500 hover:text-ink-900"
              >
                Кое кафе е за вас
              </Link>
              <Link
                href="/brands"
                className="inline-flex border-b-2 border-transparent py-3 text-sm font-medium text-ink-700 transition-colors hover:border-clay-500 hover:text-ink-900"
              >
                Марки
              </Link>
              <Link
                href="/promotions"
                className="inline-flex border-b-2 border-transparent py-3 text-sm font-medium text-clay-600 transition-colors hover:border-clay-500"
              >
                Промоции
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
