"use client";

import { useParams } from "next/navigation";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

/**
 * The locale of the page a client component is drawn on, read from the
 * route's `[lang]` segment.
 *
 * For the client components deep in a page — the order form, the consent box,
 * a card's quick-order link — that build one link each and would otherwise
 * need the locale threaded through every component above them. Server
 * components take it from their page's `params` instead.
 *
 * Outside a page (a unit test rendering a component on its own) there is no
 * route, and the answer is the default locale.
 */
export function useLocale(): Locale {
  const params = useParams<{ lang?: string }>();
  const lang = params?.lang;
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}
