"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HTML_LANG, LOCALE_LABEL, SHIPPING_LOCALES, type Locale } from "@/i18n/config";
import { switchLocalePath } from "@/lib/routes";

/**
 * Links to the same page in each other shipping locale.
 *
 * **It renders nothing while only one locale ships**, which is today: a
 * switcher with nothing to switch to is a control that does nothing.
 *
 * Plain links, written in the language they lead to (`LOCALE_LABEL`), with
 * `hreflang` and `lang` so a screen reader pronounces "English" in English.
 * Nothing is remembered: there is no preference cookie (the Cookies page
 * promises none), and the URL already carries the choice. A client component
 * only because a layout is not told which page it is wrapping; the path comes
 * from the address bar.
 */
export function LanguageSwitcher({
  locale,
  label,
  className = "",
  shipping = SHIPPING_LOCALES,
}: {
  locale: Locale;
  /** The dictionary's `language.label`, for the list's accessible name. */
  label: string;
  className?: string;
  /** For tests; the shipping set otherwise. */
  shipping?: readonly Locale[];
}) {
  const pathname = usePathname() ?? `/${locale}`;
  const others = shipping.filter((other) => other !== locale);
  if (others.length === 0) return null;

  return (
    <nav aria-label={label} className={className}>
      <ul className="flex items-center gap-3">
        {others.map((other) => (
          <li key={other}>
            <Link
              href={switchLocalePath(pathname, locale, other)}
              hrefLang={HTML_LANG[other]}
              lang={HTML_LANG[other]}
              className="inline-flex min-h-6 items-center text-sm font-medium text-pine-700 underline-offset-4 hover:underline"
            >
              {LOCALE_LABEL[other]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
