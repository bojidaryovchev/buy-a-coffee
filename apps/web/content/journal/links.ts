import { getMachineBrand } from "@/content/machines";
import { getBrewingSystem, type BrewingSystemId } from "@/lib/recommend/systems";

/**
 * Link targets, derived rather than typed.
 *
 * An article never spells out a category or machine URL. It names the system
 * or the brand and the path is built from the same data the pages themselves
 * are built from — so a link cannot point at a slug that data does not have,
 * and a typo is a thrown error at render rather than a 404 for a reader.
 */

/** The catalog listing for a brewing system, as the machine pages link it. */
export function systemCategoryHref(id: BrewingSystemId): `/${string}` {
  const system = getBrewingSystem(id);
  const slug = system?.categorySlugs[0];
  if (!slug) throw new Error(`journal: no category for brewing system "${id}"`);
  return `/categories/${slug}`;
}

export function machineBrandHref(slug: string): `/${string}` {
  if (!getMachineBrand(slug)) throw new Error(`journal: unknown machine brand "${slug}"`);
  return `/wizard/machines/${slug}`;
}

export const productHref = (slug: string): `/${string}` => `/products/${slug}`;

export const articleHref = (slug: string): `/${string}` => `/journal/${slug}`;

export const MACHINES_HREF = "/wizard/machines" as const;
export const WIZARD_HREF = "/wizard" as const;
