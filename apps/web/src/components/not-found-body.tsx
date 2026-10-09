import Link from "next/link";
import { ButtonLink } from "@/components/ui/primitives";
import { SearchFieldFallback } from "@/components/catalog/search-field-fallback";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/bg";
import { href, routes } from "@/lib/routes";

/**
 * The 404's content, shared by the two places a 404 is drawn so they cannot
 * say different things:
 *
 *   - `(site)/[lang]/not-found.tsx`, for a `notFound()` inside a page that
 *     matched — a product slug nobody sells, a category that never existed.
 *     It renders inside the shop's layout, with the header and the footer.
 *   - `app/global-not-found.tsx`, for a URL that matched no route at all,
 *     which has no layout to render in and brings a minimal frame of its own.
 *
 * Offers a way forward rather than a dead end: search, the home page, and the
 * machine finder — the question most people who land on a dead product link
 * were trying to answer. The search form is a plain `GET` and works with
 * JavaScript off.
 */
export function NotFoundBody({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const copy = dict.notFound;
  return (
    <div className="shell flex min-h-[60vh] flex-1 flex-col items-center justify-center py-16 text-center">
      <p aria-hidden className="font-display text-5xl font-semibold text-pine-500">
        404
      </p>
      <h1 className="mt-3 font-display text-2xl font-semibold text-ink-900 md:text-4xl">
        {copy.title}
      </h1>
      <p className="mt-3 max-w-md text-base text-ink-500">{copy.body}</p>

      <div className="mt-8 w-full max-w-md">
        <SearchFieldFallback locale={locale} copy={dict.search} />
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <ButtonLink href={href(locale, routes.home)}>{copy.home}</ButtonLink>
        <ButtonLink href={href(locale, routes.machines)} variant="secondary">
          {copy.findByMachine}
        </ButtonLink>
      </div>

      <p className="mt-8 text-sm text-ink-500">
        {copy.lookingFor}{" "}
        <Link
          href={href(locale, routes.contact)}
          className="font-medium text-pine-700 underline underline-offset-4"
        >
          {copy.contact}
        </Link>
        .
      </p>
    </div>
  );
}
