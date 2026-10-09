import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries/bg";
import { categoryHref, href, routes, type CategoryKeys } from "@/lib/routes";
import { BREWING_SYSTEMS, type BrewingSystem, type BrewingSystemId } from "@/lib/recommend/systems";
import type { CategoryView } from "@/lib/catalog/types";

/**
 * The site's navigation, as data.
 *
 * The rail, the drawer and the footer all draw the same structure, and the
 * design standard requires that they agree ("a drawer whose order differs from
 * the rail" is on its Never list). So the structure is worked out once, here,
 * from the category tree the layout already loads, and the three components
 * only decide how to draw it.
 *
 * It is organised by what the customer owns — a brewing system — rather than by
 * the catalog's own product types. `BREWING_SYSTEMS` is the only thing that
 * knows which category belongs to which system; the category tree is the only
 * thing that knows the category to link to and how many products are behind
 * it. No slug is typed here: every URL comes from `lib/routes.ts`, in the
 * locale being rendered, and every label from that locale's dictionary.
 *
 * WHY THE TREE AND NOT `getSystemAvailability`. A system can be linked only if
 * its category is in the tree — that is where the listing's URL comes from —
 * and the tree already carries that category's live product count. The
 * availability query would add a database round trip to every page to return
 * a number this function has in hand, for a system it could not link anyway
 * when the tree does not hold its category.
 *
 * Pure and synchronous: no database and no `server-only` import, so the client
 * drawer can share its types and the tests can hand it a tree and read the
 * answer.
 */

export interface NavSystem {
  readonly id: BrewingSystemId;
  readonly name: string;
  /**
   * What the listing calls itself: „Капсули за Nespresso“, „Кафе дози ESE“.
   * `name` is the short form for the rail, where the group's heading supplies
   * the noun; this is the anchor wherever the link stands on its own (the
   * footer), the same one a breadcrumb or a chip gives that listing.
   */
  readonly listingName: string;
  readonly href: string;
  /** Products on sale in the system's category. Always above zero. */
  readonly count: number;
}

export interface NavLink {
  readonly label: string;
  readonly href: string;
}

export interface NavCategory extends NavLink {
  readonly count: number;
}

/** The fixed destinations every part of the frame links to, in the page's locale. */
export interface NavLinks {
  readonly home: string;
  readonly findByMachine: NavLink;
  readonly wizard: NavLink;
  readonly brands: NavLink;
  readonly promotions: NavLink;
  readonly delivery: NavLink;
  readonly journal: NavLink;
  readonly contact: NavLink;
  readonly allCategories: NavLink;
  readonly search: string;
  readonly terms: string;
  readonly privacy: string;
  readonly cookies: string;
}

export interface SiteNavigation {
  readonly locale: Locale;
  readonly links: NavLinks;
  /** The capsule systems that have products, in `BREWING_SYSTEMS` order. */
  readonly capsules: {
    /** The parent listing, or the category index when the tree has no parent. */
    readonly href: string;
    readonly systems: readonly NavSystem[];
  } | null;
  /** ESE pods, or null while none are on sale. */
  readonly pods: NavSystem | null;
  /** Coffee beans, or null while none are on sale. */
  readonly beans: NavSystem | null;
  /**
   * Top-level categories the systems do not account for. Empty today. It is
   * here so that a category the sync adds tomorrow is reachable from the
   * drawer and the footer without a deploy, as the old category rail was.
   */
  readonly otherCategories: readonly NavCategory[];
  readonly vending: NavLink;
  readonly consumables: NavLink;
  readonly hasPromotions: boolean;
  readonly hasJournal: boolean;
}

/**
 * What this module needs to know about a business section: its page, and the
 * category keys the sync will one day file its products under. The shape of an
 * entry in `BUSINESS_SECTIONS` (`lib/catalog/business-sections.ts`), which is
 * where the values come from. `path` is canonical; it is localised here.
 */
export interface NavSection {
  readonly path: string;
  readonly categoryKeys: readonly string[];
}

export type NavSections = Readonly<Record<"vending" | "consumables", NavSection>>;

/**
 * True for a category that backs a business section, by its stored slug or the
 * source key behind it.
 *
 * Such a category has a page of its own (`/kafe-za-vending`, `/konsumativi`)
 * with copy and an enquiry form around the listing. Linking the bare category
 * as well would put the same products in the menu twice under two names.
 */
export function isSectionCategory(
  category: Pick<CategoryKeys, "slug" | "sourceKey">,
  sections: NavSections,
): boolean {
  return Object.values(sections).some(
    (section) =>
      section.categoryKeys.includes(category.slug) ||
      (category.sourceKey !== null && section.categoryKeys.includes(category.sourceKey)),
  );
}

function flatten(nodes: readonly CategoryView[]): CategoryView[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/**
 * The category that holds a system's products, or null when it holds none.
 *
 * A system binds to its category by stored slug or source key, either of which
 * may be the one that survives an upstream rename, so both lists are tried —
 * which is what `brewingSystemForCategory` does for the listing pages too.
 */
function systemCategory(system: BrewingSystem, all: readonly CategoryView[]): CategoryView | null {
  const keys = new Set([...system.categorySlugs, ...system.categorySourceKeys]);
  const matches = all.filter(
    (category) =>
      (keys.has(category.slug) || (category.sourceKey !== null && keys.has(category.sourceKey))) &&
      category.productCount > 0,
  );
  // Two bindings for one system is a rename in progress; the fuller one wins.
  return matches.sort((a, b) => b.productCount - a.productCount)[0] ?? null;
}

/** The frame's fixed links, in one locale. */
export function navLinks(locale: Locale, labels: Dictionary["nav"]): NavLinks {
  const link = (label: string, path: string): NavLink => ({ label, href: href(locale, path) });
  return {
    home: href(locale, routes.home),
    findByMachine: link(labels.findByMachine, routes.machines),
    wizard: link(labels.wizard, routes.wizard),
    brands: link(labels.brands, routes.brands),
    promotions: link(labels.promotions, routes.promotions),
    delivery: link(labels.delivery, routes.delivery),
    journal: link(labels.journal, routes.journal),
    contact: link(labels.contact, routes.contact),
    allCategories: link(labels.allCategories, routes.categories),
    search: href(locale, routes.search),
    terms: href(locale, routes.terms),
    privacy: href(locale, routes.privacy),
    cookies: href(locale, routes.cookies),
  };
}

export interface NavigationOptions {
  readonly locale: Locale;
  readonly labels: Dictionary["nav"];
  readonly sections: NavSections;
  /**
   * Whether any product is reduced right now. Defaults to true — the link is
   * shown — because finding out costs a query on every page, and a promotions
   * page that says "nothing is reduced today" is a smaller fault than that.
   */
  readonly hasPromotions?: boolean;
  readonly hasJournal?: boolean;
  /**
   * What a category's listing calls itself (`categoryNameFor` in
   * `content/category-copy.ts`). Handed in, not imported: this module is shared
   * with the client drawer, and the copy file is not something to ship to a
   * browser for one function. Left out, a listing goes by its stored name.
   */
  readonly listingName?: (category: CategoryView) => string;
}

export function buildNavigation(
  categories: readonly CategoryView[],
  options: NavigationOptions,
): SiteNavigation {
  const { locale, labels } = options;
  const all = flatten(categories);
  const used = new Set<string>();
  const links = navLinks(locale, labels);

  /* The two systems named after a kind of coffee take the dictionary's name;
     the capsule systems are trade names and read the same in every language. */
  const systemName = (system: BrewingSystem): string =>
    system.id === "ese-pod" || system.id === "beans" ? labels.systems[system.id] : system.name;

  const toNavSystem = (system: BrewingSystem): (NavSystem & { categorySlug: string }) | null => {
    const category = systemCategory(system, all);
    if (!category) return null;
    used.add(category.slug);
    return {
      id: system.id,
      name: systemName(system),
      listingName: options.listingName?.(category) ?? category.name,
      href: categoryHref(locale, category),
      count: category.productCount,
      categorySlug: category.slug,
    };
  };

  const strip = (system: NavSystem & { categorySlug: string }): NavSystem => ({
    id: system.id,
    name: system.name,
    listingName: system.listingName,
    href: system.href,
    count: system.count,
  });

  const single = (method: BrewingSystem["method"]): NavSystem | null => {
    const found = BREWING_SYSTEMS.filter((system) => system.method === method)
      .map(toNavSystem)
      .find((system) => system !== null);
    return found ? strip(found) : null;
  };

  const capsuleSystems = BREWING_SYSTEMS.filter((system) => system.method === "capsule")
    .map(toNavSystem)
    .filter((system): system is NavSystem & { categorySlug: string } => system !== null);

  /*
   * "Капсули" links the category the capsule systems hang off. Nothing names
   * that category — it is whichever parent most of them share — so it is read
   * from the tree rather than assumed to be called `kapsuli`.
   */
  const parentVotes = new Map<string, number>();
  for (const system of capsuleSystems) {
    const parent = all.find((category) => category.slug === system.categorySlug)?.parentSlug;
    if (parent) parentVotes.set(parent, (parentVotes.get(parent) ?? 0) + 1);
  }
  const capsuleParentSlug = [...parentVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const capsuleParent = capsuleParentSlug
    ? (all.find((category) => category.slug === capsuleParentSlug) ?? null)
    : null;
  if (capsuleParent) used.add(capsuleParent.slug);

  const pods = single("pod");
  const beans = single("beans");

  const otherCategories = categories
    .filter(
      (category) =>
        category.productCount > 0 &&
        !used.has(category.slug) &&
        !isSectionCategory(category, options.sections),
    )
    .map((category) => ({
      label: category.name,
      href: categoryHref(locale, category),
      count: category.productCount,
    }));

  return {
    locale,
    links,
    capsules:
      capsuleSystems.length > 0
        ? {
            href: capsuleParent ? categoryHref(locale, capsuleParent) : links.allCategories.href,
            systems: capsuleSystems.map(strip),
          }
        : null,
    pods,
    beans,
    otherCategories,
    vending: { label: labels.vending, href: href(locale, options.sections.vending.path) },
    consumables: {
      label: labels.consumables,
      href: href(locale, options.sections.consumables.path),
    },
    hasPromotions: options.hasPromotions ?? true,
    hasJournal: options.hasJournal ?? true,
  };
}

/**
 * Whether `pathname` is `href` itself or a page beneath it.
 *
 * A locale's home (`/bg`) is above every page, so it counts only as itself.
 * A caller can name paths beneath `href` that belong to another rail item.
 */
export function isCurrentSection(
  pathname: string,
  href: string,
  except: readonly string[] = [],
): boolean {
  const under = (base: string): boolean => pathname === base || pathname.startsWith(`${base}/`);
  if (href.split("/").filter(Boolean).length <= 1) return pathname === href;
  return under(href) && !except.some(under);
}
