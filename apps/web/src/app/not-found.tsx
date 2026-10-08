import Link from "next/link";
import { ButtonLink } from "@/components/ui/primitives";
import { SearchFieldFallback } from "@/components/catalog/search-field-fallback";
import { siteConfig } from "@/config/site";
import { Wordmark } from "@/components/layout/wordmark";

/**
 * 404.
 *
 * Offers a way forward rather than a dead end: search, the home page, and the
 * machine finder — the question most people who land on a dead product link
 * were trying to answer.
 *
 * This file sits beside the root layout, above the shop's own, so it is drawn
 * without the header and the footer and has to bring its own way home: the
 * wordmark, a `main` landmark, and a search form that is a plain `GET` and
 * works with JavaScript off.
 */
export default function NotFound() {
  return (
    <>
      <header className="border-b border-line">
        <div className="shell flex min-h-16 items-center">
          <Link href="/" aria-label={`${siteConfig.name} — начало`} className="flex items-center">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main
        id="main"
        className="shell flex min-h-[60vh] flex-1 flex-col items-center justify-center py-16 text-center"
      >
        <p aria-hidden className="font-display text-5xl font-semibold text-pine-500">
          404
        </p>
        <h1 className="mt-3 font-display text-2xl font-semibold text-ink-900 md:text-4xl">
          Тази страница я няма
        </h1>
        <p className="mt-3 max-w-md text-base text-ink-500">
          Може адресът да е сгрешен или продуктът да е спрян.
        </p>

        <div className="mt-8 w-full max-w-md">
          <SearchFieldFallback />
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/">Към началната страница</ButtonLink>
          <ButtonLink href="/wizard/machines" variant="secondary">
            Намери по машина
          </ButtonLink>
        </div>

        <p className="mt-8 text-sm text-ink-500">
          Търсите нещо конкретно?{" "}
          <Link href="/contact" className="font-medium text-pine-700 underline underline-offset-4">
            Пишете ни или се обадете
          </Link>
          .
        </p>
      </main>
    </>
  );
}
