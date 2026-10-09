import "server-only";
import { eq } from "drizzle-orm";
import { brands, categories, products } from "@catalog/db/schema";
import { LOCALES } from "@/i18n/config";
import { categorySlug } from "@/lib/routes";
import { LANDING_IDS, LANDING_PATHS } from "./landings";

/**
 * Does the catalog hold anything at this slug? Asked by the proxy, before the
 * route tree, for the kinds of URL whose existence only the database knows:
 * `/bg/<category or product>`, `/bg/marki/<brand>`, and a landing listing
 * (`/bg/bezkofeinovo-kafe`), which is a static route that exists only while
 * it has products to list.
 *
 * WHY THE PROXY ASKS AT ALL. A page that calls `notFound()` gets the right
 * status and the wrong document: Next 16 catches the throw in a *client*
 * error boundary, the server render has no boundary to stop at, and the
 * response is its bare `<html id="__next_error__">` with the not-found page
 * only in the inlined payload — blank with JavaScript off. (Measured on a
 * production build, and equally on the tree before locales.) The one 404 Next
 * renders on the server is the `/_not-found` route, `app/global-not-found.tsx`,
 * and only routing can send a request there. So the proxy rewrites a slug that
 * names nothing to `/_not-found`, and the dead link arrives as finished HTML.
 *
 * WHAT IT COSTS. One read of every slug — a few hundred short strings — held
 * for five minutes, the same age the pages themselves revalidate at. A slug
 * that is not in the list is the only case that can be stale (the sync added
 * it a moment ago), so a miss reloads the list before it is believed, at most
 * once every fifteen seconds: a crawler walking dead links cannot turn into a
 * query per request.
 *
 * WHEN IT CANNOT TELL — no database, a failed query — the answer is `null` and
 * the proxy lets the request through to the page, whose own `notFound()` is
 * still there. Never a wrong 404 because a lookup failed.
 *
 * It knows exactly what the pages accept: a product by its stored slug,
 * whatever its status (a removed product keeps its URL); an active category
 * by its stored slug or its landing slug in any locale (the page redirects the
 * ones it does not publish); an active brand; a landing listing while its
 * selection (`landings.ts`) is not empty, which is the same count its page
 * 404s on.
 */

export type SlugKind = "first-level" | "brand" | "landing";

interface Snapshot {
  readonly at: number;
  readonly slugs: Readonly<Record<SlugKind, ReadonlySet<string>>>;
}

const FRESH_FOR_MS = 5 * 60_000;
const RELOAD_ON_MISS_AFTER_MS = 15_000;

let snapshot: Snapshot | null = null;
let loading: Promise<Snapshot> | null = null;

async function load(): Promise<Snapshot> {
  /* Imported here, not at the top: `lib/db` opens its pool when it loads and
     throws without a `DATABASE_URL`. A proxy that failed to load would take
     every page down with it; a lookup that fails only answers "cannot tell". */
  const { db } = await import("@/lib/db");
  const { getLandingAvailability } = await import("./landing-queries");
  const [productRows, categoryRows, brandRows, landings] = await Promise.all([
    db.select({ slug: products.slug }).from(products),
    db
      .select({
        slug: categories.slug,
        sourceKey: categories.sourceKey,
        previousSourceKeys: categories.previousSourceKeys,
      })
      .from(categories)
      .where(eq(categories.status, "active")),
    db.select({ slug: brands.slug }).from(brands).where(eq(brands.status, "active")),
    getLandingAvailability(),
  ]);

  return {
    at: Date.now(),
    slugs: {
      "first-level": new Set([
        ...productRows.map((row) => row.slug),
        ...categoryRows.flatMap((row) => [
          row.slug,
          ...LOCALES.map((locale) => categorySlug(locale, row)),
        ]),
      ]),
      brand: new Set(brandRows.map((row) => row.slug)),
      // By canonical segment, which is what the proxy holds when it asks.
      landing: new Set(
        LANDING_IDS.filter((id) => landings.counts[id] > 0).map((id) => LANDING_PATHS[id].slice(1)),
      ),
    },
  };
}

/** One load at a time, however many requests arrive while it runs. */
function reload(): Promise<Snapshot> {
  loading ??= load()
    .then((next) => (snapshot = next))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** True or false when the catalog answers; null when it could not be asked. */
export async function slugExists(kind: SlugKind, slug: string): Promise<boolean | null> {
  try {
    let current = snapshot;
    if (!current || Date.now() - current.at > FRESH_FOR_MS) current = await reload();
    if (current.slugs[kind].has(slug)) return true;

    if (Date.now() - current.at > RELOAD_ON_MISS_AFTER_MS) current = await reload();
    return current.slugs[kind].has(slug);
  } catch {
    return null;
  }
}
