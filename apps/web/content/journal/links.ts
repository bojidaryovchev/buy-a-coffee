import { getMachineBrand } from "@/content/machines";
import { routes, type RouteTarget } from "@/lib/routes";
import { getBrewingSystem, type BrewingSystemId } from "@/lib/recommend/systems";

/**
 * Link targets, derived rather than typed — and route keys, not URLs.
 *
 * An article never spells out a category or machine URL. It names the system
 * or the brand, and the target is built from the same data the pages
 * themselves are built from — so a link cannot point at a slug that data does
 * not have, and a typo is a thrown error at render rather than a 404 for a
 * reader.
 *
 * None of these carries a locale. An article is written once and rendered in
 * whichever locale the page is in, so each target is a canonical route or a
 * catalog key, resolved by `targetHref` in `lib/routes.ts` at render time: a
 * category to its landing slug in that locale, a product to its slug in that
 * locale, a static page to its translated path.
 */

/** The catalog listing for a brewing system, as the machine pages link it. */
export function systemCategoryHref(id: BrewingSystemId): RouteTarget {
  const system = getBrewingSystem(id);
  const slug = system?.categorySlugs[0];
  if (!system || !slug) throw new Error(`journal: no category for brewing system "${id}"`);
  return { category: { slug, sourceKey: system.categorySourceKeys[0] ?? null } };
}

export function machineBrandHref(slug: string): RouteTarget {
  if (!getMachineBrand(slug)) throw new Error(`journal: unknown machine brand "${slug}"`);
  return routes.machineBrand(slug);
}

export const productHref = (slug: string): RouteTarget => ({ product: slug });

export const articleHref = (slug: string): RouteTarget => routes.article(slug);

export const MACHINES_HREF: RouteTarget = routes.machines;
export const WIZARD_HREF: RouteTarget = routes.wizard;
