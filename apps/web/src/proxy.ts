import { NextResponse, type NextRequest } from "next/server";
import { isShipping } from "@/i18n/config";
import { LOCALE_VARY, preferredLocale } from "@/i18n/negotiate";
import { ROUTE_SEGMENTS } from "@/i18n/slugs";
import { landingForSegment } from "@/lib/catalog/landings";
import { slugExists, type SlugKind } from "@/lib/catalog/slug-exists";
import { legacyAnswer } from "@/lib/legacy-routes";
import { localeOfPath, resolveLocalisedPath, routes } from "@/lib/routes";

/**
 * Locale routing.
 *
 * In Next.js 16 this file is `proxy.ts`, exporting `proxy`; it runs before the
 * route tree on the Node runtime. Four jobs, in this order:
 *
 *   1. **A path under a shipping locale** is served as asked. A translated
 *      segment is rewritten to the canonical folder it lives in, and a
 *      spelling the locale does not publish — the Bulgarian folder name under
 *      `/en`, say — answers 308 to the one it does (`resolveLocalisedPath`).
 *      Nobody is ever moved *off* the locale in their URL: not by their
 *      browser's language, and never by where they appear to be. Regulation
 *      (EU) 2018/302 forbids routing a visitor by residence, and Googlebot
 *      crawls from the US with an English `Accept-Language` — redirecting on
 *      either would bounce it off the Bulgarian pages every time.
 *      **Unless the catalog holds nothing there.** `/bg/<slug>`,
 *      `/bg/marki/<brand>` and the landing listings (which exist only while
 *      they list something) are checked against the catalog
 *      (`lib/catalog/slug-exists.ts`), and one that names nothing is rewritten
 *      to the global 404 — because that is the only 404 Next renders on the
 *      server. Left to the page's own `notFound()`, a dead link is a 404 whose
 *      body is drawn by JavaScript, and blank without it.
 *   2. **The bare `/`** has to resolve to some locale, and resolves by
 *      `Accept-Language` alone (`i18n/negotiate.ts`): a 307, because the answer
 *      is per visitor and a cached permanent redirect would freeze one
 *      visitor's language for everyone sharing the browser, with
 *      `Vary: Accept-Language` so a shared cache cannot do the same. No cookie
 *      is read or set; the Cookies page promises there are none.
 *   3. **The URLs the shop served before locales** answer 308 to their
 *      Bulgarian equivalents, query string kept (`lib/legacy-routes.ts`).
 *   4. **Everything else is the 404** — a first segment that is not a
 *      shipping locale, `/en` while English is switched off, `/nope`. It is
 *      rewritten to Next's own `/_not-found`, which draws
 *      `app/global-not-found.tsx` with a real 404 status. Left to the route
 *      tree it would match `[lang]`, whose layout can only answer with Next's
 *      bare error document: a root layout has no not-found boundary above it.
 *      The one route outside `[lang]` that is not untouched, the old
 *      `/categories/<slug>`, is let through to its handler.
 *
 * What it never touches: the admin panel, the API, the development image
 * route, Next's internals, the share card and every file with an extension —
 * `/sitemap.xml`, `/robots.txt`, `/llms.txt`, the manifest, the icons. The
 * matcher keeps the proxy from running on them at all, and `isUntouched`
 * repeats the rule, so a matcher edit cannot quietly start rewriting the panel.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (isUntouched(pathname)) return NextResponse.next();

  const locale = localeOfPath(pathname);
  if (locale && isShipping(locale)) {
    const action = resolveLocalisedPath(locale, pathname);
    const url = request.nextUrl.clone();
    if (action.type === "redirect") {
      url.pathname = action.pathname;
      return NextResponse.redirect(url, 308);
    }

    // The canonical path: the folder the request is about to be served from.
    const served = action.type === "rewrite" ? action.pathname : pathname;
    const lookup = catalogLookup(served.split("/").filter(Boolean).slice(1));
    if (lookup && (await slugExists(lookup.kind, lookup.slug)) === false) {
      url.pathname = NOT_FOUND;
      return NextResponse.rewrite(url);
    }

    if (action.type === "next") return NextResponse.next();
    url.pathname = action.pathname;
    return NextResponse.rewrite(url);
  }

  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = `/${preferredLocale(request.headers.get("accept-language"))}`;
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Vary", LOCALE_VARY);
    return response;
  }

  const legacy = legacyAnswer(pathname);
  if (legacy?.type === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = legacy.pathname;
    return NextResponse.redirect(url, 308);
  }
  if (legacy?.type === "category") return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = NOT_FOUND;
  return NextResponse.rewrite(url);
}

/** Next's internal route for the global 404 (`app/global-not-found.tsx`). */
const NOT_FOUND = "/_not-found";

const STATIC_FIRST_LEVEL: ReadonlySet<string> = new Set(
  ROUTE_SEGMENTS.filter((key) => !key.includes("/")),
);
const BRANDS_SEGMENT = routes.brands.slice(1);

/**
 * The catalog slug a canonical path names, if its existence is the catalog's
 * to answer: `/<slug>` (a category or a product), `/marki/<brand>`, and a
 * landing listing, which is a static folder but 404s while it lists nothing.
 * Everything else is a static page or has its own list of what exists.
 */
export function catalogLookup(
  segments: readonly string[],
): { readonly kind: SlugKind; readonly slug: string } | null {
  const [first, second] = segments;
  if (first === undefined) return null;
  if (segments.length === 1) {
    if (landingForSegment(first)) return { kind: "landing", slug: first };
    return STATIC_FIRST_LEVEL.has(first) ? null : { kind: "first-level", slug: first };
  }
  if (segments.length === 2 && first === BRANDS_SEGMENT && second) {
    return { kind: "brand", slug: second };
  }
  return null;
}

const UNTOUCHED_PREFIXES = [
  "/_next",
  "/_vercel",
  "/_not-found",
  "/api",
  "/media",
  "/admin",
] as const;

/** Paths that are not storefront pages and never were. */
export function isUntouched(pathname: string): boolean {
  if (UNTOUCHED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))
    return true;
  if (pathname === "/opengraph-image" || pathname.startsWith("/opengraph-image/")) return true;
  // A file: `/sitemap.xml`, `/llms.txt`, `/favicon.ico`, `/manifest.webmanifest`.
  return /\.[^/]+$/.test(pathname);
}

export const config = {
  matcher: [
    "/((?!_next/|_vercel/|_not-found(?:/|$)|api(?:/|$)|media(?:/|$)|admin(?:/|$)|opengraph-image(?:/|$)|.*\\.[^/]+$).*)",
  ],
};
