import type { Locale } from "@/i18n/config";
import { getMachineBrand } from "@/content/machines";
import { categoryHref, href, routes, systemCategory } from "@/lib/routes";
import { getBrewingSystem, type BrewingSystemId } from "@/lib/recommend/systems";
import { relatedCopy } from "../../../content/landing-copy";
import { resolveProductFormat } from "./fallback-copy";
import { LANDING_PATHS, type LandingAvailability, type LandingId } from "./landings";

/**
 * The links between pages that would otherwise compete for one search.
 *
 * The market study gives each cluster of queries one owner (`docs/seo.md` §1)
 * and asks the owner's neighbours to say what it is and link to it (§13.5,
 * §13.7): the Lavazza brand page, the Lavazza capsules page and the two
 * Lavazza systems; the Caffitaly shelf and the Tchibo machine page; and, from
 * every system's shelf, the decaf and cheapest-per-cup pages.
 *
 * Worked out here once, as data, so a page asks only "what do I link to" and
 * every page gives the same anchor to the same URL. **A link is offered only
 * while its target has something to show**: `LandingAvailability` is the same
 * answer the routes 404 on and the sitemap is built from.
 *
 * Pure: no database. The component that draws these reads the availability.
 */

/** The page asking. */
export type RelatedSubject =
  | { readonly category: { readonly slug: string; readonly sourceKey: string | null } }
  /** A brand page, by the brand's stored slug. */
  | { readonly brand: { readonly slug: string } }
  | { readonly landing: LandingId }
  /** A machine-brand page, by its slug in the machine database. */
  | { readonly machineBrand: string };

export interface RelatedLink {
  readonly key: string;
  readonly href: string;
  readonly label: string;
  /** What the target is, in a few words. A link without one stands on its label. */
  readonly note?: string;
}

/** The machine page that is really about one system's capsules, and that system. */
export const TCHIBO_PAIR = { machineBrand: "tchibo", system: "caffitaly" } as const satisfies {
  machineBrand: string;
  system: BrewingSystemId;
};

type Member = "lavazzaCapsules" | "lavazzaBeans" | "lavazzaBrand" | "lavazzaBlue" | "aModoMio";

/** What each page of the Lavazza cluster links to, in the order it lists them. */
const LAVAZZA_NEIGHBOURS: Readonly<Record<Member, readonly Member[]>> = {
  lavazzaCapsules: ["lavazzaBlue", "aModoMio", "lavazzaBrand"],
  lavazzaBeans: ["lavazzaBrand", "lavazzaCapsules"],
  lavazzaBrand: ["lavazzaCapsules", "lavazzaBeans", "lavazzaBlue", "aModoMio"],
  lavazzaBlue: ["lavazzaCapsules", "aModoMio", "lavazzaBrand"],
  aModoMio: ["lavazzaCapsules", "lavazzaBlue", "lavazzaBrand"],
};

const MEMBER_SYSTEM: Readonly<Partial<Record<Member, BrewingSystemId>>> = {
  lavazzaBlue: "lavazza-blue",
  aModoMio: "a-modo-mio",
};

export function relatedLandingLinks(
  locale: Locale,
  subject: RelatedSubject,
  availability: LandingAvailability,
): readonly RelatedLink[] {
  const links: RelatedLink[] = [];

  const landingHref = (id: LandingId, anchor?: BrewingSystemId): string | null => {
    if (availability.counts[id] === 0) return null;
    const fragment = anchor && availability.groups[id].includes(anchor) ? `#${anchor}` : "";
    return href(locale, `${LANDING_PATHS[id]}${fragment}`);
  };

  const systemHref = (id: BrewingSystemId): string | null => {
    const system = getBrewingSystem(id);
    return system && availability.systems[id] > 0
      ? categoryHref(locale, systemCategory(system))
      : null;
  };

  const memberHref = (member: Member): string | null => {
    switch (member) {
      case "lavazzaCapsules":
      case "lavazzaBeans":
        return landingHref(member);
      case "lavazzaBrand":
        return availability.lavazzaBrandSlug
          ? href(locale, routes.brand(availability.lavazzaBrandSlug))
          : null;
      default: {
        const system = MEMBER_SYSTEM[member];
        return system ? systemHref(system) : null;
      }
    }
  };

  const add = (key: string, target: string | null, label: string, note?: string) => {
    if (target) links.push({ key, href: target, label, ...(note ? { note } : {}) });
  };

  /* The system a category page is the shelf of, exactly as its badge decides it. */
  const system =
    "category" in subject
      ? resolveProductFormat([subject.category.slug, subject.category.sourceKey ?? ""]).system
      : null;

  let member: Member | null = null;
  if ("landing" in subject) {
    if (subject.landing === "lavazzaCapsules" || subject.landing === "lavazzaBeans") {
      member = subject.landing;
    }
  } else if ("brand" in subject) {
    if (subject.brand.slug === availability.lavazzaBrandSlug) member = "lavazzaBrand";
  } else if (system?.id === "lavazza-blue") {
    member = "lavazzaBlue";
  } else if (system?.id === "a-modo-mio") {
    member = "aModoMio";
  }

  if (member) {
    for (const neighbour of LAVAZZA_NEIGHBOURS[member]) {
      const copy = relatedCopy[neighbour];
      add(neighbour, memberHref(neighbour), copy.label, copy.note);
    }
  }

  /* The bean shelf names the one brand × format page cut out of it. */
  if (system?.id === "beans") {
    const copy = relatedCopy.lavazzaBeans;
    add("lavazzaBeans", landingHref("lavazzaBeans"), copy.label, copy.note);
  }

  /* Caffitaly and Tchibo: one format, two pages, each pointing at the other. */
  if (system?.id === TCHIBO_PAIR.system && getMachineBrand(TCHIBO_PAIR.machineBrand)) {
    add(
      "tchibo",
      href(locale, routes.machineBrand(TCHIBO_PAIR.machineBrand)),
      relatedCopy.tchibo.label,
      relatedCopy.tchibo.note,
    );
  }
  if ("machineBrand" in subject && subject.machineBrand === TCHIBO_PAIR.machineBrand) {
    add(
      "caffitaly",
      systemHref(TCHIBO_PAIR.system),
      relatedCopy.caffitaly.label,
      relatedCopy.caffitaly.note,
    );
  }

  /*
   * Every shelf links the decaf and cheapest-per-cup pages — to its own
   * system's group when that group is there, to the top of the page when it
   * is not. The two landings link each other.
   */
  if ("category" in subject) {
    const decafHere = system !== null && availability.groups.decaf.includes(system.id);
    add(
      "decaf",
      landingHref("decaf", system?.id),
      decafHere ? relatedCopy.decafInSystem : relatedCopy.decaf,
    );
    add("cheapest", landingHref("cheapest", system?.id), relatedCopy.cheapest);
  } else if ("landing" in subject) {
    if (subject.landing === "decaf") add("cheapest", landingHref("cheapest"), relatedCopy.cheapest);
    if (subject.landing === "cheapest") add("decaf", landingHref("decaf"), relatedCopy.decaf);
  }

  return links;
}
