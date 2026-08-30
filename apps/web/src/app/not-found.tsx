import Link from "next/link";
import { ButtonLink } from "@/components/ui/primitives";
import { SearchFieldFallback } from "@/components/catalog/search-field-fallback";

/**
 * 404.
 *
 * Offers a way forward rather than a dead end: search, plus the main entry
 * points into the catalog.
 */
export default function NotFound() {
  return (
    <div className="shell flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <p className="font-display text-5xl font-semibold text-pine-500">404</p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-ink-900">
        Не намерихме тази страница
      </h1>
      <p className="mt-2 max-w-md text-base text-ink-500">
        Връзката може да е остаряла или продуктът вече да не е в асортимента.
      </p>

      <div className="mt-8 w-full max-w-md">
        <SearchFieldFallback />
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/">Към началната страница</ButtonLink>
        <ButtonLink href="/categories" variant="secondary">
          Разгледай асортимента
        </ButtonLink>
      </div>

      <p className="mt-8 text-sm text-ink-500">
        Все още не намирате търсеното?{" "}
        <Link href="/contact" className="text-pine-700 underline underline-offset-4">
          Свържете се с нас
        </Link>
        .
      </p>
    </div>
  );
}
