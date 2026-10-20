import { compareDecimal, parseDecimal, pricePerUnitMeasure } from "@catalog/shared";
import { resolveProductFormat } from "./fallback-copy";
import type { LandingRow } from "./landings";

/**
 * The beans listing's two sections by use, as selections over the catalog.
 *
 * Research `09`, T2.2: „италианско кафе на зърна“ and the searches for beans
 * for an automatic machine („хубаво кафе за кафеавтомат“, „кафе на зърна за
 * кафеавтомат“) are answered on `/bg/kafe-na-zarna` itself, under headings of
 * their own, and get no address of their own until Search Console shows the
 * demand landing there. The words are in `content/category-copy.ts`; what
 * each section shows is decided here.
 *
 * Pure, like `landings.ts`: rows in, a selection out, no database and no
 * clock. The facts a rule reads that the catalog row does not carry — whether
 * the brand is Italian, how the shop writes the brand's name — are resolved by
 * the caller (`beans-section-queries.ts`) from the one place each is decided,
 * and handed in on the row, so every rule below can be tested with fixtures.
 *
 * **Coffee beans** means what the card's badge means: the product's
 * categories name the beans system (`resolveProductFormat`), so instant
 * coffee filed under beans is never one of them.
 */

export type BeansSectionId = "italian" | "automatic";

/** In the order the page shows them. */
export const BEANS_SECTION_IDS: readonly BeansSectionId[] = ["italian", "automatic"];

/**
 * The most brands the Italian section lists. Above the number of Italian
 * brands the shop sells beans of, so today it lists every one; the bound is
 * written down so the section stays a shortlist if that ever changes, and the
 * copy is worded to stay true either way.
 */
export const ITALIAN_SECTION_MAX = 12;

/** The fewest brands the Italian section lists and is still shown. */
export const ITALIAN_SECTION_MIN = 3;

/** A product on sale, with the facts the rules read already resolved. */
export interface BeansSectionRow extends LandingRow {
  /**
   * The brand is recorded as Italian, with the evidence beside it, in
   * `content/brand-facts.ts`. A brand with no entry there is not Italian here,
   * whatever its name sounds like.
   */
  readonly italianBrand: boolean;
  /** The brand's name as the shop writes it („Biancaffè“, „illy“), for the order. */
  readonly brandName: string | null;
}

export interface BeansSectionItem {
  readonly id: string;
  /** Exact price per kilogram, as `pricePerUnitMeasure` gives it. */
  readonly perKg: string;
}

export interface BeansSections {
  /**
   * „Италианско кафе на зърна“: one pack per Italian brand, by brand name.
   * Null with fewer than `ITALIAN_SECTION_MIN` brands to list.
   */
  readonly italian: readonly BeansSectionItem[] | null;
  /**
   * „Кафе на зърна за автоматична кафемашина“, which lists no products: every
   * bean on the page goes in such a machine, and nothing the catalog holds
   * says one bag suits it better than another. Shown while any coffee beans
   * are on sale; null when none are.
   */
  readonly automatic: {
    /**
     * Whether a flavoured coffee is among the beans on sale. The section says
     * every bean on the page suits an automatic machine only while none is:
     * that is not something the shop knows of a flavoured one.
     */
    readonly flavoured: boolean;
  } | null;
}

const isBeans = (row: LandingRow): boolean =>
  resolveProductFormat(row.categoryKeys, row.name).system?.id === "beans";

/**
 * Flavoured is what the record says, and only that: the listings' „Ароматизирано“
 * filter reads the same attribute (`lower(attributes->>'aromas') = 'yes'`).
 */
export const isFlavoured = (row: LandingRow): boolean =>
  row.attributes.aromas?.trim().toLowerCase() === "yes";

interface Candidate {
  readonly row: BeansSectionRow;
  readonly brand: string;
  readonly perKg: string;
}

/**
 * A pack the Italian section may choose: an Italian brand's beans that can be
 * ordered — not marked sold out, since a shortlist that points at a pack
 * nobody can buy is a claim about nothing — with a price per kilogram, which
 * is how the brand's pack is chosen and what the page prints beside it.
 */
function italianCandidate(row: BeansSectionRow): Candidate | null {
  if (!row.italianBrand || !isBeans(row) || row.availability === "out_of_stock") return null;
  const brand = row.brandSlug ?? row.brandSourceKey;
  if (brand === null) return null;
  const unit = pricePerUnitMeasure(row.price, row.weightValue, row.weightUnit);
  if (!unit || unit.unit !== "kg") return null;
  return { row, brand, perKg: unit.amount };
}

/**
 * Lowest price per kilogram first; then the supplier's name, then the id —
 * the tie-break the listings' sorts and the landings use — so the order is
 * total and the same catalog always gives the same pack.
 */
function byKilogramPrice(a: Candidate, b: Candidate): number {
  const order = compareDecimal(parseDecimal(a.perKg), parseDecimal(b.perKg));
  if (order !== 0) return order;
  if (a.row.name !== b.row.name) return a.row.name < b.row.name ? -1 : 1;
  return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
}

/** By the brand's name as the page writes it, case aside; then by its key. */
function byBrandName(a: Candidate, b: Candidate): number {
  const order = (a.row.brandName ?? a.brand).localeCompare(b.row.brandName ?? b.brand, "bg", {
    sensitivity: "base",
  });
  if (order !== 0) return order;
  return a.brand < b.brand ? -1 : a.brand > b.brand ? 1 : 0;
}

/**
 * What each section shows.
 *
 *  - **`italian`** — every brand that `brand-facts.ts` records as Italian and
 *    that has beans to order, with one pack each: the brand's lowest price per
 *    kilogram. Ordered by the brand's name, not by price: the heading asks
 *    which Italian coffees there are, and an order by price would turn the
 *    list into the cheapest beans, which is `/bg/nay-evtino-na-chasha`'s
 *    question („евтино кафе на зърна“). Up to `ITALIAN_SECTION_MAX` brands,
 *    and none below `ITALIAN_SECTION_MIN`.
 *  - **`automatic`** — no products. Present while any coffee beans are on
 *    sale, with whether one of them is flavoured.
 */
export function selectBeansSections(rows: readonly BeansSectionRow[]): BeansSections {
  const perBrand = new Map<string, Candidate>();
  const candidates = rows
    .map(italianCandidate)
    .filter((entry): entry is Candidate => entry !== null)
    .sort(byKilogramPrice);
  // Already in price order, so a brand's first pack is its lowest per kilogram.
  for (const entry of candidates) if (!perBrand.has(entry.brand)) perBrand.set(entry.brand, entry);

  const brands = [...perBrand.values()].sort(byBrandName);
  const beans = rows.filter(isBeans);

  return {
    italian:
      brands.length >= ITALIAN_SECTION_MIN
        ? brands
            .slice(0, ITALIAN_SECTION_MAX)
            .map((entry) => ({ id: entry.row.id, perKg: entry.perKg }))
        : null,
    automatic: beans.length > 0 ? { flavoured: beans.some(isFlavoured) } : null,
  };
}
