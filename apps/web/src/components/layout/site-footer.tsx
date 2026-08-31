import Link from "next/link";
import { siteConfig, usingPlaceholderBrand } from "@/config/site";
import type { CategoryView } from "@/lib/catalog/types";
import { NewsletterForm } from "@/components/forms/newsletter-form";
import { Wordmark } from "@/components/layout/wordmark";

export function SiteFooter({ categories }: { categories: readonly CategoryView[] }) {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 border-t border-line bg-paper-sunken">
      <div className="shell grid gap-10 py-12 md:grid-cols-12 md:gap-8">
        <div className="md:col-span-4">
          <Wordmark />
          <p className="mt-3 max-w-xs text-sm text-ink-500">{siteConfig.description}</p>
          <dl className="mt-5 space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="text-ink-500">Телефон</dt>
              <dd>
                <a href={`tel:${siteConfig.contact.phoneHref}`} className="font-medium text-pine-700 underline-offset-4 hover:underline">
                  {siteConfig.contact.phone}
                </a>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-500">Имейл</dt>
              <dd>
                <a href={`mailto:${siteConfig.contact.email}`} className="font-medium text-pine-700 underline-offset-4 hover:underline">
                  {siteConfig.contact.email}
                </a>
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-500">Работно време</dt>
              <dd className="text-ink-700">{siteConfig.contact.hours}</dd>
            </div>
          </dl>
        </div>

        <nav aria-label="Магазин" className="md:col-span-3">
          <h2 className="font-display text-sm font-semibold tracking-wide uppercase text-ink-900">Магазин</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {categories.map((category) => (
              <li key={category.slug}>
                <Link href={`/categories/${category.slug}`} className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                  {category.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/brands" className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                Всички марки
              </Link>
            </li>
            <li>
              <Link href="/promotions" className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                Актуални промоции
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Информация" className="md:col-span-2">
          <h2 className="font-display text-sm font-semibold tracking-wide uppercase text-ink-900">Информация</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/contact" className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                Контакти
              </Link>
            </li>
            {siteConfig.features.blog && (
              <li>
                <Link href="/journal" className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                  Дневник
                </Link>
              </li>
            )}
            <li>
              <Link href="/privacy" className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                Поверителност
              </Link>
            </li>
            <li>
              <Link href="/terms" className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                Условия
              </Link>
            </li>
            <li>
              <Link href="/cookies" className="text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline">
                Бисквитки
              </Link>
            </li>
          </ul>
        </nav>

        {siteConfig.features.newsletter && (
          <div className="md:col-span-3">
            <h2 className="font-display text-sm font-semibold tracking-wide uppercase text-ink-900">
              Бъдете в течение
            </h2>
            <p className="mt-3 text-sm text-ink-500">
              Кратки съобщения за новите попълнения. Не повече от веднъж месечно.
            </p>
            <div className="mt-3">
              <NewsletterForm source="footer" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line">
        <div className="shell flex flex-col gap-3 py-5 text-xs text-ink-500 md:flex-row md:items-center md:justify-between">
          <p>
            © {year}{" "}
            {siteConfig.legal.isComplete ? siteConfig.legal.companyName : siteConfig.name}. Всички права запазени.
          </p>
          {siteConfig.legal.isComplete ? (
            <p>
              {siteConfig.legal.companyName} · ЕИК {siteConfig.legal.companyId}
              {siteConfig.legal.vatId ? ` · ДДС № ${siteConfig.legal.vatId}` : ""} · {siteConfig.legal.address}
            </p>
          ) : (
            /*
             * Company registration details are shown only when they are real.
             * Inventing a company number to fill the gap would be a legal
             * problem, not a cosmetic one, so the gap is stated instead.
             */
            <p className="rounded-sm bg-clay-100 px-2 py-1 text-clay-600">
              Фирмените данни още не са попълнени
            </p>
          )}
        </div>
      </div>

      {usingPlaceholderBrand() && process.env.NODE_ENV !== "production" && (
        <div className="bg-clay-100 py-2 text-center text-xs text-clay-600">
          Бележка за разработка: попълнете правните данни в <code>src/config/site.ts</code> преди пускане.
        </div>
      )}
    </footer>
  );
}
