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
 * thing that knows the slug to link to and how many products are behind it.
 * No slug is typed here.
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

export interface SiteNavigation {
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

export const FIND_BY_MACHINE: NavLink = { label: "Намери по машина", href: "/wizard/machines" };
export const WIZARD: NavLink = { label: "Кое кафе е за вас", href: "/wizard" };
export const BRANDS: NavLink = { label: "Марки", href: "/brands" };
export const PROMOTIONS: NavLink = { label: "Промоции", href: "/promotions" };
export const DELIVERY: NavLink = { label: "Доставка и плащане", href: "/delivery" };
export const JOURNAL: NavLink = { label: "Дневник", href: "/journal" };
export const CONTACT: NavLink = { label: "Контакти", href: "/contact" };
export const ALL_CATEGORIES: NavLink = { label: "Всички категории", href: "/categories" };

/**
 * What this module needs to know about a business section: its page, and the
 * category keys the sync will one day file its products under. The shape of an
 * entry in `BUSINESS_SECTIONS` (`lib/catalog/vending.ts`), which is where the
 * values come from. They are passed in rather than imported because that
 * module opens a database connection, and this one is also read by the client
 * drawer and by unit tests.
 */
export interface NavSection {
  readonly path: string;
  readonly categoryKeys: readonly string[];
}

export type NavSections = Readonly<Record<"vending" | "consumables", NavSection>>;

const SECTION_LABELS: Readonly<Record<keyof NavSections, string>> = {
  vending: "Вендинг зона",
  consumables: "Консумативи",
};

/**
 * True for a category that backs a business section.
 *
 * Such a category has a page of its own (`/vending`, `/consumables`) with copy
 * and an enquiry form around the listing. Linking the bare category as well
 * would put the same products in the menu twice under two names.
 */
export function isSectionCategory(
  category: Pick<CategoryView, "slug">,
  sections: NavSections,
): boolean {
  return Object.values(sections).some((section) => section.categoryKeys.includes(category.slug));
}

const categoryHref = (slug: string): string => `/categories/${slug}`;

function flatten(nodes: readonly CategoryView[]): CategoryView[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/**
 * The category that holds a system's products, or null when it holds none.
 *
 * The tree carries slugs, not source keys. A storefront slug is derived from
 * the category's name and is, for every system today, the same string as the
 * source key — so both lists are tried, which is what `getSectionCategory`
 * does for the business sections too.
 */
function systemCategory(system: BrewingSystem, all: readonly CategoryView[]): CategoryView | null {
  const keys = new Set([...system.categorySlugs, ...system.categorySourceKeys]);
  const matches = all.filter((category) => keys.has(category.slug) && category.productCount > 0);
  // Two bindings for one system is a rename in progress; the fuller one wins.
  return matches.sort((a, b) => b.productCount - a.productCount)[0] ?? null;
}

export interface NavigationOptions {
  readonly sections: NavSections;
  /**
   * Whether any product is reduced right now. Defaults to true — the link is
   * shown — because finding out costs a query on every page, and a promotions
   * page that says "nothing is reduced today" is a smaller fault than that.
   */
  readonly hasPromotions?: boolean;
  readonly hasJournal?: boolean;
}

export function buildNavigation(
  categories: readonly CategoryView[],
  options: NavigationOptions,
): SiteNavigation {
  const all = flatten(categories);
  const used = new Set<string>();

  const toNavSystem = (system: BrewingSystem): NavSystem | null => {
    const category = systemCategory(system, all);
    if (!category) return null;
    used.add(category.slug);
    return {
      id: system.id,
      name: system.name,
      href: categoryHref(category.slug),
      count: category.productCount,
    };
  };

  const single = (method: BrewingSystem["method"]): NavSystem | null =>
    BREWING_SYSTEMS.filter((system) => system.method === method)
      .map(toNavSystem)
      .find((system) => system !== null) ?? null;

  const capsuleSystems = BREWING_SYSTEMS.filter((system) => system.method === "capsule")
    .map(toNavSystem)
    .filter((system): system is NavSystem => system !== null);

  /*
   * "Капсули" links the category the capsule systems hang off. Nothing names
   * that category — it is whichever parent most of them share — so it is read
   * from the tree rather than assumed to be called `kapsuli`.
   */
  const parentVotes = new Map<string, number>();
  for (const system of capsuleSystems) {
    const parent = all.find((category) => categoryHref(category.slug) === system.href)?.parentSlug;
    if (parent) parentVotes.set(parent, (parentVotes.get(parent) ?? 0) + 1);
  }
  const capsuleParent = [...parentVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (capsuleParent) used.add(capsuleParent);

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
      href: categoryHref(category.slug),
      count: category.productCount,
    }));

  return {
    capsules:
      capsuleSystems.length > 0
        ? {
            href: capsuleParent ? categoryHref(capsuleParent) : ALL_CATEGORIES.href,
            systems: capsuleSystems,
          }
        : null,
    pods,
    beans,
    otherCategories,
    vending: { label: SECTION_LABELS.vending, href: options.sections.vending.path },
    consumables: { label: SECTION_LABELS.consumables, href: options.sections.consumables.path },
    hasPromotions: options.hasPromotions ?? true,
    hasJournal: options.hasJournal ?? true,
  };
}

/**
 * Whether `pathname` is `href` itself or a page beneath it.
 *
 * `/wizard` must not light up on `/wizard/machines`, which is a rail item of
 * its own, so a caller can name the paths that belong to someone else.
 */
export function isCurrentSection(
  pathname: string,
  href: string,
  except: readonly string[] = [],
): boolean {
  const under = (base: string): boolean => pathname === base || pathname.startsWith(`${base}/`);
  if (href === "/") return pathname === "/";
  return under(href) && !except.some(under);
}
