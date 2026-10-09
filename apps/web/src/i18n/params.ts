import { notFound } from "next/navigation";
import { isLocale, isShipping, type Locale } from "@/i18n/config";

/** What every page and layout under `[lang]` is handed. */
export interface LangParams {
  readonly lang: string;
}

/**
 * The locale a page is rendered in, or a 404.
 *
 * Every page and `generateMetadata` under `[lang]` calls this rather than
 * trusting the layout: Next renders metadata separately from the layout, and a
 * locale that is declared but switched off must 404 everywhere, never fall back
 * to Bulgarian under its own URL.
 *
 * Not `dynamicParams = false` on the layout, which is how buy-a-vend refuses
 * unknown locales: that setting is inherited by every segment beneath it, and
 * here it would 404 every product and category page not generated at build.
 */
export function shippingLocale(lang: string): Locale {
  if (!isLocale(lang) || !isShipping(lang)) notFound();
  return lang;
}

export async function localeFrom(params: Promise<LangParams>): Promise<Locale> {
  return shippingLocale((await params).lang);
}
