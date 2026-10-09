import type { Metadata } from "next";
import Link from "next/link";
import { NotFoundBody } from "@/components/not-found-body";
import { Wordmark } from "@/components/layout/wordmark";
import { siteConfig } from "@/config/site";
import { DEFAULT_LOCALE, HTML_LANG } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/fill";
import { href, routes } from "@/lib/routes";
import { BODY_CLASS, fontVariables } from "./fonts";
import "./globals.css";

/**
 * The 404 for a URL that matched no route: `/this-route-does-not-exist`, a
 * locale that is switched off, `/bg/a/b/c`.
 *
 * WHY THIS FILE EXISTS. There is no `app/layout.tsx` — the shop's root moved
 * under `[lang]` so `<html lang>` can follow the locale — and a `not-found.tsx`
 * renders inside a root layout. With none above it, Next would draw its bare
 * error document: no stylesheet, no fonts, no `lang`. The Next docs name this
 * case: `global-not-found.js` is for an app whose root layouts are split or
 * sit under a dynamic segment. It bypasses layouts, so it brings its own
 * `<html>`, faces and stylesheet, and a minimal frame with the way home.
 * Enabled by `experimental.globalNotFound` in `next.config.ts`.
 *
 * `(site)/[lang]/not-found.tsx` handles the other case — a page that matched
 * and called `notFound()` — with the shop's chrome; both draw `NotFoundBody`.
 *
 * In the default locale, because nothing here knows which locale the visitor
 * meant; an honest generic `lang` is better than a guessed one.
 */
export const metadata: Metadata = {
  title: `404 — ${siteConfig.name}`,
  robots: { index: false, follow: true },
};

export default function GlobalNotFound() {
  const locale = DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  return (
    <html lang={HTML_LANG[locale]} className={fontVariables}>
      <body className={BODY_CLASS}>
        <header className="border-b border-line">
          <div className="shell flex min-h-16 items-center">
            <Link
              href={href(locale, routes.home)}
              aria-label={fill(dict.nav.home, { name: siteConfig.name })}
              className="flex items-center"
            >
              <Wordmark />
            </Link>
          </div>
        </header>
        <main id="main" className="flex flex-1 flex-col">
          <NotFoundBody locale={locale} dict={dict} />
        </main>
      </body>
    </html>
  );
}
