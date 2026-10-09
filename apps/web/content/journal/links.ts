import { getMachineBrand } from "@/content/machines";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { SLUGS } from "@/i18n/slugs";
import type { JournalLandings } from "@/lib/catalog/journal-figures";
import { LANDING_PATHS, type LandingId } from "@/lib/catalog/landings";
import { routes, type RouteTarget } from "@/lib/routes";
import { getBrewingSystem, type BrewingSystemId } from "@/lib/recommend/systems";
import { link, type InlineLink } from "./blocks";

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

/**
 * The capsule parent listing — „Кафе капсули“, the shelf every capsule system
 * hangs off. No brewing system names it (a system is one of its children), so
 * it is named here by the source key the slug table curates and by the slug
 * the category is stored under. Checked against the slug table when this
 * module loads: if the landing page is ever dropped from it, every article
 * that links here fails at build, not in front of a reader.
 */
const CAPSULES_SOURCE_KEY = "kafe-kapsuli";
if (!Object.hasOwn(SLUGS[DEFAULT_LOCALE].categories, CAPSULES_SOURCE_KEY)) {
  throw new Error(`journal: no landing slug for the capsule parent "${CAPSULES_SOURCE_KEY}"`);
}
export const CAPSULES_HREF: RouteTarget = {
  category: { slug: "kapsuli", sourceKey: CAPSULES_SOURCE_KEY },
};

export function machineBrandHref(slug: string): RouteTarget {
  if (!getMachineBrand(slug)) throw new Error(`journal: unknown machine brand "${slug}"`);
  return routes.machineBrand(slug);
}

/**
 * A landing listing — „Капсули Lavazza“, „Безкофеиново кафе“ — or null while
 * it has nothing to list.
 *
 * A landing is a page only while its selection has products; the rest of the
 * time its address is a 404. So this does not hand back a target
 * unconditionally the way the others here do: it takes the availability the
 * article's figures carry and answers null when the page is not there, which
 * leaves the caller no way to link to it by accident.
 */
export function landingHref(id: LandingId, landings: JournalLandings): RouteTarget | null {
  return landings[id] ? LANDING_PATHS[id] : null;
}

/**
 * Words that are a link while their target exists and plain words when it does
 * not, so the sentence around them is the same sentence either way.
 */
export const linkWhile = (target: RouteTarget | null, text: string): InlineLink | string =>
  target ? link(target, text) : text;

export const productHref = (slug: string): RouteTarget => ({ product: slug });

export const articleHref = (slug: string): RouteTarget => routes.article(slug);

export const MACHINES_HREF: RouteTarget = routes.machines;
export const VENDING_HREF: RouteTarget = routes.vending;
export const WIZARD_HREF: RouteTarget = routes.wizard;
