import { NextResponse, type NextRequest } from "next/server";
import { siteConfig } from "@/config/site";
import { DEFAULT_LOCALE, SHIPPING_LOCALES, isShipping } from "@/i18n/config";
import { LOCALE_VARY, preferredLocale } from "@/i18n/negotiate";
import { ROUTE_SEGMENTS } from "@/i18n/slugs";
import { landingForSegment } from "@/lib/catalog/landings";
import { slugExists, type SlugKind } from "@/lib/catalog/slug-exists";
import { legacyAnswer } from "@/lib/legacy-routes";
import { href, localeOfPath, resolveLocalisedPath, routes } from "@/lib/routes";

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
 *      `Accept-Language` alone (`i18n/negotiate.ts`). While one locale ships it
 *      is a 308, since every visitor gets the same answer. With two or more it
 *      is a 307, because the answer is per visitor and a cached permanent
 *      redirect would freeze one visitor's language for everyone sharing the
 *      browser, with
 *      `Vary: Accept-Language` so a shared cache cannot do the same. No cookie
 *      is read or set; the Cookies page promises there are none.
 *   3. **The URLs the shop served before locales** answer 308 to their
 *      Bulgarian equivalents, query string kept (`lib/legacy-routes.ts`).
 *   4. **Everything else is the 404** — a first segment that is not a
 *      shipping locale, `/en` while English is switched off, `/nope`. It is
 *      rewritten to a path no route matches (`NOT_FOUND`), which Next answers
 *      with `app/global-not-found.tsx` and a real 404 status. Left to the
 *      route tree it would match `[lang]`, whose layout can only answer with
 *      Next's bare error document: a root layout has no not-found boundary
 *      above it.
 *      The one route outside `[lang]` that is not untouched, the old
 *      `/categories/<slug>`, is let through to its handler.
 *
 * What it never touches: the admin panel, the API, the development image
 * route, Next's internals, the share card and every file with an extension —
 * `/sitemap.xml`, `/robots.txt`, `/llms.txt`, the manifest, the icons. The
 * matcher keeps the proxy from running on them at all, and `isUntouched`
 * repeats the rule, so a matcher edit cannot quietly start rewriting the panel.
 * The one exception is first in `proxy`: on production, a request that reached
 * a host other than the canonical one is sent there (`canonicalHostRedirect`),
 * and for that alone the matcher also lets `/robots.txt`, `/sitemap.xml` and
 * `/llms.txt` in.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  /*
   * Before anything else: production answers on one host. Vercel attaches a
   * generated `*.vercel.app` alias to the production deployment, and it served
   * the whole shop, indexable, as a second copy. That host, and any other that
   * is not the canonical one, answers 308 to the same path on the canonical
   * host — a redirect Google follows, unlike a robots.txt block, which would
   * hide the canonicals and leave already-indexed copies in place. It runs for
   * `robots.txt`, `sitemap.xml` and `llms.txt` too (the matcher lets exactly
   * those through for this), so the alias does not publish its own.
   */
  const canonical = canonicalHostRedirect(request);
  if (canonical) return canonical;

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
    const servedSegments = served.split("/").filter(Boolean).slice(1);
    /* A static segment that only parents another (`/bg/byuletin`, whose page is
       `/bg/byuletin/otpisvane`) has no page of its own; left to the route tree it
       renders Next's bare error document with two contradictory robots tags. */
    if (servedSegments.length === 1 && SEGMENTS_WITHOUT_A_PAGE.has(servedSegments[0]!)) {
      url.pathname = NOT_FOUND;
      return NextResponse.rewrite(url);
    }
    const lookup = catalogLookup(servedSegments);
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
    /* With one locale shipping, every visitor gets the same answer, so it is
       permanent: a temporary redirect leaves `/` standing as a second home
       page beside `/bg`. With two or more it depends on the visitor and must
       stay temporary, for the reasons above. */
    const response = NextResponse.redirect(url, SHIPPING_LOCALES.length > 1 ? 307 : 308);
    response.headers.set("Vary", LOCALE_VARY);
    return response;
  }

  const legacy = legacyAnswer(pathname);
  if (legacy?.type === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = legacy.pathname;
    /* An old result link without answers would land on the result page, which
       robots.txt keeps crawlers out of, only to be sent on to the wizard: one
       hop straight there instead. With answers it keeps its result page. */
    if (legacy.pathname === WIZARD_RESULT && !request.nextUrl.search) url.pathname = WIZARD;
    return NextResponse.redirect(url, 308);
  }
  if (legacy?.type === "category") return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = NOT_FOUND;
  return NextResponse.rewrite(url);
}

/**
 * Where a dead URL is rewritten to: a path that no route in the app matches,
 * so Next answers it the way it answers `/bg/a/b/c` — with
 * `app/global-not-found.tsx`, drawn on the server, and a 404 status.
 *
 * ⚠ NOT Next's own `/_not-found` route, which this used to name. `next start`
 * serves that route with 404, so every test passed; Vercel serves it as the
 * prerendered page it is, with **200**. Every dead link answered 200 with a
 * `noindex` — a soft 404 — on production (`/bg/<unknown>`, `/bg/marki/<unknown>`,
 * `/en`, `/nope`, `/BG`), while `/bg/a/b/c`, which no route matches, was a real
 * 404 all along. Matching nothing is what both hosts answer with a 404.
 *
 * Four segments, because three would be `[lang]/marki/[slug]` and its kin
 * and two would be `[lang]/[slug]`; the first one is not a locale, and the
 * third is not a metadata image. `test/proxy.test.ts` checks it against every
 * route under `src/app`.
 */
export const NOT_FOUND = "/_404/no/such/page";

const STATIC_FIRST_LEVEL: ReadonlySet<string> = new Set(
  ROUTE_SEGMENTS.filter((key) => !key.includes("/")),
);

/**
 * Static first-level segments with no page of their own, only children.
 * `test/proxy.test.ts` checks this against the folders under `[lang]`.
 */
export const SEGMENTS_WITHOUT_A_PAGE: ReadonlySet<string> = new Set(["byuletin"]);

/**
 * The one host production answers on. It is `NEXT_PUBLIC_SITE_URL` as
 * `env.schema.mjs` commits it for production; `test/proxy.test.ts` holds the
 * two together.
 */
export const PRODUCTION_HOST = "buy-a-coffee.com";

/** A request to the machine itself: a local `next start` with production env pulled in. */
const LOCAL_HOST = /^(?:localhost|\[::1\]|127\.\d+\.\d+\.\d+)(?::\d+)?$/;

/**
 * The redirect to the canonical host, or `null` to carry on.
 *
 * Production only (`VERCEL_ENV=production`): a preview, a local `next start`
 * and development never redirect, whatever host they answer on. Every other
 * host production answers on — the `*.vercel.app` alias, a deployment's own
 * URL, `www` — is sent to `PRODUCTION_HOST`. The API is not matched by the
 * proxy at all, so Vercel's cron calls reach their handlers on whatever host
 * they use, and neither is the admin.
 *
 * Fails closed. It redirects only when the site's own address
 * (`NEXT_PUBLIC_SITE_URL`, what every canonical tag names) is exactly
 * `https://buy-a-coffee.com`: a typo, the alias or the localhost fallback of a
 * build without it (`config/site.ts`) redirects nothing, rather than sending
 * every visitor elsewhere under a 308 their browser would cache. A request to
 * localhost is never redirected either. The 308 is cached for an hour, not
 * for ever, while it is new.
 *
 * The path and query are copied onto the target as they are, never parsed as
 * a URL of their own: `//evil.example/x` stays a path on the canonical host.
 */
export function canonicalHostRedirect(
  request: NextRequest,
  env: Readonly<Record<string, string | undefined>> = process.env,
  siteUrl: string = siteConfig.url,
): NextResponse | null {
  if (env.VERCEL_ENV !== "production") return null;
  let target: URL;
  try {
    target = new URL(siteUrl);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || target.host !== PRODUCTION_HOST) return null;
  const host = request.headers.get("host")?.toLowerCase();
  if (!host || host === PRODUCTION_HOST || LOCAL_HOST.test(host)) return null;

  const url = new URL(target.origin);
  url.pathname = request.nextUrl.pathname;
  url.search = request.nextUrl.search;
  const response = NextResponse.redirect(url, 308);
  response.headers.set("cache-control", "public, max-age=3600");
  return response;
}

const BRANDS_SEGMENT = routes.brands.slice(1);
const WIZARD = href(DEFAULT_LOCALE, routes.wizard);
const WIZARD_RESULT = href(DEFAULT_LOCALE, routes.wizardResult);

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
  "/email-img",
  "/admin",
] as const;

/** Paths that are not storefront pages and never were. */
export function isUntouched(pathname: string): boolean {
  if (UNTOUCHED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))
    return true;
  /* A share card, the shop's at the root or a page's own under it
     (`/bg/<slug>/opengraph-image-<hash>/<id>`): an image, not a page, and
     never worth a catalog lookup. */
  if (/(^|\/)opengraph-image(-[a-z0-9]+)?(\/|$)/.test(pathname)) return true;
  // A file: `/sitemap.xml`, `/llms.txt`, `/favicon.ico`, `/manifest.webmanifest`.
  return /\.[^/]+$/.test(pathname);
}

export const config = {
  matcher: [
    "/((?!_next/|_vercel/|_not-found(?:/|$)|api(?:/|$)|media(?:/|$)|email-img(?:/|$)|admin(?:/|$)|(?:.*/)?opengraph-image(?:-[a-z0-9]+)?(?:/|$)|.*\\.[^/]+$).*)",
    /* The files a crawler reads first, matched only so a non-canonical
       production host redirects them too; `isUntouched` passes them through
       untouched everywhere else. */
    "/robots.txt",
    "/sitemap.xml",
    "/llms.txt",
  ],
};
