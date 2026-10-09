import { lang } from "next/root-params";
import { NotFoundBody } from "@/components/not-found-body";
import { DEFAULT_LOCALE, isLocale, isShipping } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

/**
 * 404 for a page under `[lang]` that matched a route and then called
 * `notFound()`: `/bg/<a slug nobody sells>`, a brand that does not exist.
 *
 * It renders inside the shop's layout, so the visitor keeps the header, the
 * footer and a way out, in the right `<html lang>`. A not-found file is not
 * handed `params`; the locale is the root parameter, which any server
 * component under the root layout can read (`next/root-params`).
 *
 * A URL that matched no route at all never gets here — it has no layout to
 * render inside — and is answered by `app/global-not-found.tsx`, which shares
 * this body.
 */
export default async function NotFound() {
  const value: unknown = await lang();
  const locale =
    typeof value === "string" && isLocale(value) && isShipping(value) ? value : DEFAULT_LOCALE;
  return <NotFoundBody locale={locale} dict={getDictionary(locale)} />;
}
