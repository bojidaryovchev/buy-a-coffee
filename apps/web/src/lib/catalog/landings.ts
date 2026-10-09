import { compareDecimal, packServings, parseDecimal, pricePerServing } from "@catalog/shared";
import { routes, type CanonicalPath } from "@/lib/routes";
import {
  BREWING_SYSTEMS,
  type BrewMethod,
  type BrewingSystem,
  type BrewingSystemId,
} from "@/lib/recommend/systems";
import { packSizeLabel, resolveProductFormat } from "./fallback-copy";

/**
 * The four landing listings, as selections over the catalog.
 *
 * `/bg/lavazza-kapsuli`, `/bg/kafe-na-zarna-lavazza`, `/bg/bezkofeinovo-kafe`
 * and `/bg/nay-evtino-na-chasha` are pages the market study found demand for
 * and the catalog can already fill. None of them is a category the source
 * keeps: each is a rule applied to the products on sale, written here.
 *
 * This file is pure — rows in, a grouped and ordered selection out, no
 * database and no clock — so every rule below can be tested exhaustively. The
 * read that produces the rows, and the cards for what is selected, are in
 * `landing-queries.ts`.
 *
 * Three things hold for all four:
 *
 *  - **A page exists only while its selection is not empty.** The route 404s,
 *    the sitemap and `llms.txt` drop it and every link to it disappears, all
 *    from `landingAvailability` below.
 *  - **A product's system is the one its categories name**, resolved exactly as
 *    the card's badge is (`resolveProductFormat`). Nothing is read off a name.
 *  - **Price per cup is the shared helpers' figure** (`@catalog/shared`
 *    `packServings` and `pricePerServing`): the very number the card prints,
 *    kept at four decimals so that two near-identical packs still order.
 */

export type LandingId = "lavazzaCapsules" | "lavazzaBeans" | "decaf" | "cheapest";

export const LANDING_IDS: readonly LandingId[] = [
  "lavazzaCapsules",
  "lavazzaBeans",
  "decaf",
  "cheapest",
];

/** Canonical paths, from `lib/routes.ts`; `href()` gives each a locale. */
export const LANDING_PATHS: Readonly<Record<LandingId, CanonicalPath>> = {
  lavazzaCapsules: routes.lavazzaCapsules,
  lavazzaBeans: routes.lavazzaBeans,
  decaf: routes.decaf,
  cheapest: routes.cheapestPerCup,
};

/**
 * The landing a first-level canonical segment names, or null.
 *
 * For whoever has to decide about a landing before its page renders — the
 * proxy, which is the only place a 404 can be answered with the not-found page
 * already in the HTML.
 */
export function landingForSegment(segment: string): LandingId | null {
  return LANDING_IDS.find((id) => LANDING_PATHS[id] === `/${segment}`) ?? null;
}

/**
 * The brand the two brand × format pages are about, by source key or stored
 * slug — either may be the one that survives a rename upstream, which is how
 * a brewing system is bound to its categories too.
 */
export const LAVAZZA_BRAND_KEYS: readonly string[] = ["lavazza"];

/**
 * The systems Lavazza itself makes machines for. Its capsules for these are
 * "капсули за Lavazza Blue"; its capsules for anybody else's machine are
 * "съвместими с" that system, and the page says so. They also lead the page,
 * in this order, ahead of the compatible ones.
 */
export const LAVAZZA_OWN_SYSTEMS: readonly BrewingSystemId[] = ["lavazza-blue", "a-modo-mio"];

/**
 * How many products each system shows on the cheapest-per-cup page.
 *
 * Three is enough to compare and few enough that the page is a shortlist and
 * not the catalog sorted. The page prints this number from here, so the
 * sentence that states it cannot disagree with what is listed.
 */
export const CHEAPEST_PER_SYSTEM = 3;

/** One product on sale, as much of it as a selection needs. */
export interface LandingRow {
  readonly id: string;
  readonly name: string;
  readonly brandSlug: string | null;
  readonly brandSourceKey: string | null;
  /** Retail price as an exact decimal string. */
  readonly price: string | null;
  readonly weightValue: string | null;
  readonly weightUnit: string | null;
  readonly availability: string;
  readonly attributes: Readonly<Record<string, string>>;
  /** Slugs and source keys of the categories the product is filed under. */
  readonly categoryKeys: readonly string[];
}

export interface LandingItem {
  readonly id: string;
  /** Exact price per cup at four decimals, or null when it cannot be worked out. */
  readonly perCup: string | null;
  /** True when the cups come from weight and the figure is an estimate. */
  readonly estimated: boolean;
  /** The pack as a customer says it („1 кг“, „100 броя“), or null. */
  readonly pack: string | null;
}

export interface LandingGroup {
  /** The group's anchor on the page: the system's id. */
  readonly key: BrewingSystemId;
  readonly system: BrewingSystem;
  readonly items: readonly LandingItem[];
  /**
   * Products the group was chosen from. Equal to `items.length` except on the
   * cheapest-per-cup page, where it is every product of the system that could
   * have been chosen.
   */
  readonly poolSize: number;
}

/** One end of a per-cup range. */
export interface CupPrice {
  readonly amount: string;
  readonly estimated: boolean;
}

export interface LandingSelection {
  readonly groups: readonly LandingGroup[];
  /** Products listed, over all groups. Zero means the page does not exist. */
  readonly count: number;
  /** Lowest and highest price per cup among what is listed, or null. */
  readonly cupRange: { readonly min: CupPrice; readonly max: CupPrice } | null;
  /** The formats listed, in the order capsules, pods, beans. */
  readonly methods: readonly BrewMethod[];
  /** The one pack size every listed product shares („1 кг“), or null. */
  readonly commonPack: string | null;
}

const METHOD_ORDER: readonly BrewMethod[] = ["capsule", "pod", "beans"];

interface Resolved extends LandingItem {
  readonly row: LandingRow;
  readonly system: BrewingSystem | null;
}

function resolve(row: LandingRow): Resolved {
  const servings = packServings(row.weightValue, row.weightUnit);
  return {
    row,
    id: row.id,
    system: resolveProductFormat(row.categoryKeys).system,
    perCup: pricePerServing(row.price, servings),
    estimated: servings?.estimated ?? false,
    pack: packSizeLabel(row.weightValue, row.weightUnit),
  };
}

/**
 * Cheapest per cup first; a product with no per-cup figure last.
 *
 * The same order the listings' "Цена на чаша" sort gives, with the same tie
 * break — name, then id — so the order is total and a page never reshuffles
 * between two renders. Compared as exact decimals, never as floats.
 */
function byCupPrice(a: Resolved, b: Resolved): number {
  if (a.perCup !== null && b.perCup !== null) {
    const order = compareDecimal(parseDecimal(a.perCup), parseDecimal(b.perCup));
    if (order !== 0) return order;
  } else if (a.perCup !== b.perCup) {
    return a.perCup === null ? 1 : -1;
  }
  if (a.row.name !== b.row.name) return a.row.name < b.row.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const isLavazza = (row: LandingRow): boolean =>
  [row.brandSourceKey, row.brandSlug].some(
    (key) => key !== null && LAVAZZA_BRAND_KEYS.includes(key.trim().toLowerCase()),
  );

/**
 * Decaf is what the record says, and only that: the same test the listings'
 * "Без кофеин" filter applies in SQL (`lower(attributes->>'decaf') = 'yes'`).
 * A name that contains "Decaf" proves nothing and is never read.
 */
export const isDecaf = (row: LandingRow): boolean =>
  row.attributes.decaf?.trim().toLowerCase() === "yes";

/**
 * On sale, for the purposes of calling something the cheapest: listed, and not
 * marked sold out. Naming a pack the cheapest way to drink coffee when it
 * cannot be ordered would be a claim about nothing.
 */
const canBeOrdered = (row: LandingRow): boolean => row.availability !== "out_of_stock";

function strip(item: Resolved): LandingItem {
  return { id: item.id, perCup: item.perCup, estimated: item.estimated, pack: item.pack };
}

/** Group by system, in the order given, each group cheapest per cup first. */
function groupBySystem(
  items: readonly Resolved[],
  order: readonly BrewingSystem[],
  limit?: number,
): LandingGroup[] {
  return order.flatMap((system) => {
    const pool = items.filter((item) => item.system?.id === system.id).sort(byCupPrice);
    if (pool.length === 0) return [];
    const chosen = limit === undefined ? pool : pool.slice(0, limit);
    return [{ key: system.id, system, items: chosen.map(strip), poolSize: pool.length }];
  });
}

function selection(groups: readonly LandingGroup[]): LandingSelection {
  const items = groups.flatMap((group) => group.items);
  const priced = items
    .filter((item): item is LandingItem & { perCup: string } => item.perCup !== null)
    .sort((a, b) => compareDecimal(parseDecimal(a.perCup), parseDecimal(b.perCup)));
  const min = priced[0];
  const max = priced[priced.length - 1];
  const packs = new Set(items.map((item) => item.pack));
  const [onlyPack] = [...packs];

  return {
    groups,
    count: items.length,
    cupRange:
      min && max
        ? {
            min: { amount: min.perCup, estimated: min.estimated },
            max: { amount: max.perCup, estimated: max.estimated },
          }
        : null,
    methods: METHOD_ORDER.filter((method) =>
      groups.some((group) => group.system.method === method),
    ),
    commonPack: packs.size === 1 ? (onlyPack ?? null) : null,
  };
}

/**
 * What each landing lists.
 *
 *  - **`lavazzaCapsules`** — Lavazza's products whose categories name one
 *    capsule system, a group per system: the two Lavazza makes machines for
 *    first, then the systems its capsules are merely compatible with.
 *  - **`lavazzaBeans`** — Lavazza's products filed under coffee beans.
 *  - **`decaf`** — every product whose record says decaf, a group per system
 *    in the shop's usual order (capsule systems, ESE pods, beans). A decaf
 *    product filed under no system has no group to stand in and is left out:
 *    a group is a statement about which machine takes what is in it.
 *  - **`cheapest`** — per system, the `CHEAPEST_PER_SYSTEM` products with the
 *    lowest price per cup among those that can be ordered and have a per-cup
 *    figure. Ties are broken by name, so a fourth product at exactly the third
 *    one's price is left out; nothing left out is ever cheaper than anything
 *    shown.
 */
export function selectLanding(id: LandingId, rows: readonly LandingRow[]): LandingSelection {
  const resolved = rows.map(resolve);

  switch (id) {
    case "lavazzaCapsules": {
      const capsules = BREWING_SYSTEMS.filter((system) => system.method === "capsule");
      const order = [
        ...LAVAZZA_OWN_SYSTEMS.flatMap((own) => capsules.filter((system) => system.id === own)),
        ...capsules.filter((system) => !LAVAZZA_OWN_SYSTEMS.includes(system.id)),
      ];
      return selection(
        groupBySystem(
          resolved.filter((item) => isLavazza(item.row)),
          order,
        ),
      );
    }
    case "lavazzaBeans":
      return selection(
        groupBySystem(
          resolved.filter((item) => isLavazza(item.row)),
          BREWING_SYSTEMS.filter((system) => system.method === "beans"),
        ),
      );
    case "decaf":
      return selection(
        groupBySystem(
          resolved.filter((item) => isDecaf(item.row)),
          BREWING_SYSTEMS,
        ),
      );
    case "cheapest":
      return selection(
        groupBySystem(
          resolved.filter((item) => canBeOrdered(item.row) && item.perCup !== null),
          BREWING_SYSTEMS,
          CHEAPEST_PER_SYSTEM,
        ),
      );
  }
}

/**
 * Everything on sale in one system, cheapest per cup first: one group, or none.
 *
 * For a page that is about a system without being its category — the Tchibo
 * machine page lists the Caffitaly shelf, because that is what goes in a
 * Cafissimo.
 */
export function selectSystem(
  systemId: BrewingSystemId,
  rows: readonly LandingRow[],
): LandingSelection {
  return selection(
    groupBySystem(
      rows.map(resolve),
      BREWING_SYSTEMS.filter((system) => system.id === systemId),
    ),
  );
}

/**
 * Which landings exist right now, and what a link to one may point at.
 *
 * The one answer the routes, the sitemap, `llms.txt`, the footer and the
 * cross-links all read, so a page and the links to it appear and disappear
 * together.
 */
export interface LandingAvailability {
  /** Products each landing lists; zero means the page 404s. */
  readonly counts: Readonly<Record<LandingId, number>>;
  /** The group anchors each landing has: a link may name one only while it is there. */
  readonly groups: Readonly<Record<LandingId, readonly BrewingSystemId[]>>;
  /** Products on sale per brewing system. */
  readonly systems: Readonly<Record<BrewingSystemId, number>>;
  /** Lavazza's stored brand slug while it has products on sale, for the link to its page. */
  readonly lavazzaBrandSlug: string | null;
}

export function landingAvailability(rows: readonly LandingRow[]): LandingAvailability {
  const selections = LANDING_IDS.map((id) => [id, selectLanding(id, rows)] as const);
  const perLanding = <T>(read: (selection: LandingSelection) => T) =>
    Object.fromEntries(selections.map(([id, entry]) => [id, read(entry)])) as Record<LandingId, T>;

  const systems = Object.fromEntries(BREWING_SYSTEMS.map((system) => [system.id, 0])) as Record<
    BrewingSystemId,
    number
  >;
  for (const row of rows) {
    const system = resolveProductFormat(row.categoryKeys).system;
    if (system) systems[system.id] += 1;
  }

  return {
    counts: perLanding((entry) => entry.count),
    groups: perLanding((entry) => entry.groups.map((group) => group.key)),
    systems,
    lavazzaBrandSlug: rows.find((row) => isLavazza(row) && row.brandSlug)?.brandSlug ?? null,
  };
}

/** What every caller falls back to when there is no catalog to read. */
export const NO_LANDINGS: LandingAvailability = landingAvailability([]);
