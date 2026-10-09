import type { Metadata } from "next";
import Link from "next/link";
import { SiteFrame, loadNavigation } from "@/components/layout/site-frame";
import { Wordmark } from "@/components/layout/wordmark";
import { Measurement } from "@/components/measurement";
import { NotFoundBody } from "@/components/not-found-body";
import { siteConfig } from "@/config/site";
import { DEFAULT_LOCALE, HTML_LANG } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { fill } from "@/i18n/fill";
import { href, routes } from "@/lib/routes";
import { BODY_CLASS, fontVariables } from "./fonts";
import "./globals.css";

/**
 * The 404 — the one Next renders on the server.
 *
 * It answers every URL that names nothing: one that matches no route
 * (`/bg/a/b/c`, an unknown article or machine brand), one under no shipping
 * locale (`/nope`, `/en` while English is off), and — through the proxy — a
 * category, product or brand slug the catalog does not hold. All arrive as
 * finished HTML with a 404 status, readable with JavaScript off.
 *
 * WHY THE PROXY SENDS DEAD CATALOG LINKS HERE rather than leaving them to the
 * page's `notFound()`: in Next 16 that throw is caught by a client-side error
 * boundary. The server render has nothing to stop at, so the response is the
 * framework's bare `<html id="__next_error__">` and the not-found page exists
 * only in the inlined payload — a blank page without scripts. This route is a
 * page in its own right (`/_not-found`), so it is rendered like any other.
 *
 * WHY THIS FILE EXISTS AT ALL. There is no `app/layout.tsx` — the shop's root
 * moved under `[lang]` so `<html lang>` can follow the locale — and a plain
 * `not-found.tsx` needs a root layout above it. `global-not-found.js` is
 * Next's answer for split root layouts; it bypasses layouts, so it brings its
 * own `<html>`, faces and stylesheet. Enabled by `experimental.globalNotFound`.
 *
 * It draws the shop's own frame (`SiteFrame`), so a dead link still has the
 * menu, the search and the phone number. The frame's navigation is a catalog
 * read; if that fails, the 404 must not become a 500, so it falls back to the
 * wordmark and the body's own links.
 *
 * In the default locale: the route is one page for every URL, and is not told
 * which was asked for. An honest generic `lang` beats a guessed one.
 */
export const metadata: Metadata = {
  title: `404 — ${siteConfig.name}`,
  robots: { index: false, follow: true },
};

/** The frame's navigation follows the catalog, like every shop page's. */
export const revalidate = 300;

export default async function GlobalNotFound() {
  const locale = DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const navigation = await loadNavigation(locale, dict).catch(() => null);

  return (
    <html lang={HTML_LANG[locale]} className={fontVariables}>
      <body className={BODY_CLASS}>
        {navigation ? (
          <SiteFrame navigation={navigation} dict={dict}>
            <NotFoundBody locale={locale} dict={dict} />
          </SiteFrame>
        ) : (
          <>
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
          </>
        )}
        <Measurement />
      </body>
    </html>
  );
}
