import { LOCALES, isLocale, type Locale } from "@/i18n/config";
import { ROUTE_SEGMENTS, SLUGS, type RouteSegment } from "@/i18n/slugs";

/**
 * Every storefront URL, in one place.
 *
 * **Paths here are canonical, not public.** They are the folder names under
 * `src/app/(site)/[lang]/` — the Bulgarian slugs the shop launched with — and
 * carry no locale. `href(locale, path)` is the one place a canonical path
 * becomes a URL: it adds the locale prefix and translates each static segment
 * into that locale's spelling (`i18n/slugs/<locale>.ts`). `proxy.ts` does the
 * reverse on the way in, so the route tree never moves when a slug changes.
 *
 * Every internal link, canonical, `hreflang` entry, sitemap entry, breadcrumb
 * and JSON-LD URL goes through `href` (or `categoryHref` / `productHref`,
 * which call it). **A bare path in an `href` is a bug**: it has no locale, and
 * `test/bare-paths.test.ts` fails on one.
 *
 * Client-safe on purpose — no database, no `server-only` — because the search
 * field and the language switcher build URLs in the browser.
 */

export type CanonicalPath = `/${string}`;

export const routes = {
  home: "/",
  categories: "/kategorii",
  brands: "/marki",
  brand: (slug: string): CanonicalPath => `/marki/${slug}`,
  search: "/tarsene",
  promotions: "/promotsii",
  vending: "/kafe-za-vending-mashini",
  consumables: "/konsumativi",
  delivery: "/dostavka-i-plashtane",
  contact: "/kontakti",
  privacy: "/poveritelnost",
  terms: "/obshti-usloviya",
  cookies: "/biskvitki",
  journal: "/blog",
  article: (slug: string): CanonicalPath => `/blog/${slug}`,
  wizard: "/izbor-na-kafe",
  wizardResult: "/izbor-na-kafe/rezultat",
  machines: "/za-kafemashina",
  machineBrand: (slug: string): CanonicalPath => `/za-kafemashina/${slug}`,
  unsubscribe: "/byuletin/otpisvane",
} as const satisfies Record<string, CanonicalPath | ((slug: string) => CanonicalPath)>;

const SEGMENT_KEYS: ReadonlySet<string> = new Set(ROUTE_SEGMENTS);

const isRouteSegment = (key: string): key is RouteSegment => SEGMENT_KEYS.has(key);

/** `/a/b?x=1#y` → `["/a/b", "?x=1#y"]`. */
function splitSuffix(path: string): [string, string] {
  const at = path.search(/[?#]/);
  return at < 0 ? [path, ""] : [path.slice(0, at), path.slice(at)];
}

/**
 * Canonical segments → the segments `locale` publishes.
 *
 * Each segment is looked up by its full canonical path so far, so only a real
 * route segment is ever translated: `marki/rezultat` is a brand called
 * "rezultat", not the wizard's result page, and stays as it is. Slugs —
 * a brand, a product, an article — pass through untouched.
 */
function localiseSegments(locale: Locale, segments: readonly string[]): string[] {
  const table = SLUGS[locale].segments;
  return segments.map((segment, index) => {
    const key = segments.slice(0, index + 1).join("/");
    return isRouteSegment(key) ? table[key] : segment;
  });
}

/**
 * The public URL of a canonical path in one locale.
 *
 * `href("bg", routes.brand("lavazza"))` → `/bg/marki/lavazza`;
 * `href("en", routes.brand("lavazza"))` → `/en/brands/lavazza`. A query string
 * or fragment on the path is kept as it is.
 */
export function href(locale: Locale, path: string): string {
  const [pathname, suffix] = splitSuffix(path);
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return `/${locale}${suffix}`;
  return `/${locale}/${localiseSegments(locale, segments).join("/")}${suffix}`;
}

/**
 * Public segments under `locale` → canonical segments, or null when nothing
 * here was a translated route segment.
 *
 * The inverse of `localiseSegments`, walked the same way: a segment is read as
 * a route segment only under the canonical parent it belongs to. Anything it
 * does not recognise is returned unchanged, so a slug or a typo reaches the
 * route tree and, if it matches nothing, the 404 — this must never invent a
 * rewrite for a segment it has not heard of.
 */
export function canonicalSegments(locale: Locale, segments: readonly string[]): string[] {
  const table = SLUGS[locale].segments;
  const canonical: string[] = [];
  for (const segment of segments) {
    const parent = canonical.join("/");
    const match = ROUTE_SEGMENTS.find((key) => {
      const at = key.lastIndexOf("/");
      const keyParent = at < 0 ? "" : key.slice(0, at);
      return keyParent === parent && table[key] === segment;
    });
    canonical.push(match ? match.slice(match.lastIndexOf("/") + 1) : segment);
  }
  return canonical;
}

/**
 * What the proxy does with a path under a shipping locale.
 *
 *   - `next`: the URL is already the folder it names (every Bulgarian URL today).
 *   - `rewrite`: a translated URL, served from its canonical folder; the
 *     address bar does not change.
 *   - `redirect`: a spelling this locale does not publish — the canonical
 *     segment under a locale that renames it, or a mix of two languages. 308 to
 *     the one it does, so two spellings of one page are never both indexable.
 */
export type LocalisedPathAction =
  | { readonly type: "next" }
  | { readonly type: "rewrite"; readonly pathname: string }
  | { readonly type: "redirect"; readonly pathname: string };

export function resolveLocalisedPath(locale: Locale, pathname: string): LocalisedPathAction {
  const rest = pathname.slice(`/${locale}`.length);
  const segments = rest.split("/").filter(Boolean);
  if (segments.length === 0) return { type: "next" };

  const canonical = canonicalSegments(locale, segments);
  const canonicalPath = `/${canonical.join("/")}`;
  const published = href(locale, canonicalPath);
  const requested = `/${locale}/${segments.join("/")}`;

  if (published !== requested) return { type: "redirect", pathname: published };
  if (canonical.some((segment, index) => segment !== segments[index])) {
    return { type: "rewrite", pathname: `/${locale}${canonicalPath}` };
  }
  return { type: "next" };
}

/** The locale a public path is under, or null. */
export function localeOfPath(pathname: string): Locale | null {
  const first = pathname.split("/")[1] ?? "";
  return isLocale(first) ? first : null;
}

/* --- Categories and products ------------------------------------------- */

/**
 * First-level segments a category or product slug must never take, in any
 * locale: each is a static route (or its translation), and a static segment
 * wins over `[slug]` by construction, so a product called `marki` would be
 * unreachable rather than shadowing the brands page.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(
  ROUTE_SEGMENTS.filter((key) => !key.includes("/")).flatMap((key) => [
    key,
    ...LOCALES.map((locale) => SLUGS[locale].segments[key]),
  ]),
);

export const isReservedSlug = (slug: string): boolean => RESERVED_SLUGS.has(slug) || isLocale(slug);

/** What a category link needs: our stored slug and the keys behind it. */
export interface CategoryKeys {
  readonly slug: string;
  readonly sourceKey: string | null;
  /** Keys the source used before a rename, so a renamed category keeps its landing slug. */
  readonly previousSourceKeys?: readonly string[];
}

/** Appended to a category's stored slug in the one case it would collide with a route. */
const COLLISION_SUFFIX: Readonly<Record<Locale, string>> = { bg: "kategoriya", en: "category" };

/**
 * The curated landing slug for a category in a locale, or null.
 *
 * By source key first, then by the keys the source used before a rename: the
 * sync re-points a renamed category to the source's new key and keeps the old
 * one in `previous_source_keys`, and a landing page that has earned its
 * position must not fall back to the stored slug because the source tidied a
 * name.
 */
function curatedCategorySlug(locale: Locale, category: CategoryKeys): string | null {
  const table = SLUGS[locale].categories;
  for (const key of [category.sourceKey, ...(category.previousSourceKeys ?? [])]) {
    if (key && Object.hasOwn(table, key)) return table[key] ?? null;
  }
  return null;
}

/**
 * The slug a category is published at in a locale.
 *
 * The curated landing slug when the slug table has one, otherwise the stored
 * slug — so a category the sync adds tomorrow is reachable the moment it
 * exists. **A stored slug that would collide with a route is refused**: the
 * category is published at `<slug>-kategoriya` instead, and `[slug]` resolves
 * that form back. A curated slug cannot collide; `assertSlugTables` checks
 * that when this module loads.
 */
export function categorySlug(locale: Locale, category: CategoryKeys): string {
  const curated = curatedCategorySlug(locale, category);
  if (curated) return curated;
  return isReservedSlug(category.slug)
    ? `${category.slug}-${COLLISION_SUFFIX[locale]}`
    : category.slug;
}

export function categoryHref(locale: Locale, category: CategoryKeys, query = ""): string {
  return href(locale, `/${categorySlug(locale, category)}${query}`);
}

/**
 * The category a brewing system names as its own, by the first of its slugs
 * and source keys — for the links that point at "the Nespresso shelf" without
 * a category row in hand (the wizard, the machine pages, the journal).
 */
export function systemCategory(system: {
  readonly categorySlugs: readonly string[];
  readonly categorySourceKeys: readonly string[];
}): CategoryKeys {
  return { slug: system.categorySlugs[0] ?? "", sourceKey: system.categorySourceKeys[0] ?? null };
}

/**
 * The slug of a product in a locale.
 *
 * **The one place English product slugs get wired.** Products keep the slug the
 * sync allocated once and froze, and today that Bulgarian slug is the product's
 * slug in every locale. When English slugs exist (a later wave stores them),
 * this answers with the English one for `en`, `storedProductSlug` below answers
 * the reverse, and every link, canonical, sitemap entry and JSON-LD URL follows
 * — none of them builds a product URL any other way.
 */
export function productSlug(_locale: Locale, product: { readonly slug: string }): string {
  return product.slug;
}

/**
 * The stored slug behind a public product slug in a locale: what `[slug]`
 * looks the product up by. The inverse of `productSlug`, kept beside it so the
 * two cannot be wired separately.
 */
export function storedProductSlug(_locale: Locale, publicSlug: string): string {
  return publicSlug;
}

export function productHref(
  locale: Locale,
  product: { readonly slug: string },
  suffix = "",
): string {
  return href(locale, `/${productSlug(locale, product)}${suffix}`);
}

/* --- Route targets ----------------------------------------------------- */

/**
 * A link written down before anyone knows which locale will render it — the
 * journal's links, the business sections' cross-links. A canonical static
 * path, a category by its keys, or a product by its stored slug; `targetHref`
 * turns it into a URL at render time.
 */
export type RouteTarget =
  CanonicalPath | { readonly category: CategoryKeys } | { readonly product: string };

export function targetHref(locale: Locale, target: RouteTarget): string {
  if (typeof target === "string") return href(locale, target);
  if ("category" in target) return categoryHref(locale, target.category);
  return productHref(locale, { slug: target.product });
}

/* --- Switching language ------------------------------------------------ */

/**
 * The same page in another locale.
 *
 * Static segments make the round trip through their canonical form, so
 * `/en/brands/lavazza` becomes `/bg/marki/lavazza` rather than
 * `/bg/brands/lavazza`. A first-level curated category slug is translated
 * through its source key. Any other slug — a product, an uncurated category —
 * is carried as it is, and the page it lands on redirects to its own spelling
 * if it has a different one, so the switcher never has to know a product's
 * slug in every language.
 */
export function switchLocalePath(pathname: string, from: Locale, to: Locale): string {
  const rest =
    pathname === `/${from}` || pathname.startsWith(`/${from}/`)
      ? pathname.slice(`/${from}`.length)
      : "";
  const segments = rest.split("/").filter(Boolean);
  if (segments.length === 0) return `/${to}`;

  const canonical = canonicalSegments(from, segments);
  const [first, ...tail] = canonical;
  if (first !== undefined && canonical.length === 1 && segments.length === 1) {
    const sourceKey = Object.entries(SLUGS[from].categories).find(
      ([, slug]) => slug === first,
    )?.[0];
    if (sourceKey) return categoryHref(to, { slug: first, sourceKey });
  }
  return href(to, `/${[first, ...tail].join("/")}`);
}

/* --- Self-checks ------------------------------------------------------- */

/**
 * The slug tables are code, so a slip in one is a build failure rather than a
 * page nobody can reach. Checked once, when the module loads:
 *
 *   - no curated category slug is a route segment, in any locale;
 *   - no two categories share a landing slug within a locale;
 *   - no two sibling route segments share a spelling within a locale, which
 *     would make the proxy's reverse lookup ambiguous.
 */
export function assertSlugTables(): void {
  for (const locale of LOCALES) {
    const { segments, categories } = SLUGS[locale];
    const seen = new Set<string>();
    for (const [key, slug] of Object.entries(categories)) {
      if (isReservedSlug(slug)) {
        throw new Error(`i18n/slugs/${locale}: category "${key}" takes the route slug "${slug}"`);
      }
      if (seen.has(slug)) {
        throw new Error(`i18n/slugs/${locale}: two categories share the slug "${slug}"`);
      }
      seen.add(slug);
    }

    const siblings = new Map<string, Set<string>>();
    for (const key of ROUTE_SEGMENTS) {
      const parent = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
      const spelled = siblings.get(parent) ?? new Set<string>();
      const slug = segments[key];
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new Error(`i18n/slugs/${locale}: "${key}" is published as "${slug}", not a slug`);
      }
      if (spelled.has(slug)) {
        throw new Error(`i18n/slugs/${locale}: two routes under "/${parent}" are both "${slug}"`);
      }
      spelled.add(slug);
      siblings.set(parent, spelled);
    }
  }
}

assertSlugTables();
