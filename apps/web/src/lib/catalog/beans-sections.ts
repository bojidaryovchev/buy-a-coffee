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
 * demand landing there. Each section is a few sentences
 * (`content/category-copy.ts`) over a short list of products, and the list is
 * what this file decides.
 *
 * Pure, like `landings.ts`: rows in, an ordered selection out, no database and
 * no clock. The two facts a rule reads that the catalog row does not carry —
 * whether the brand is Italian, whether the maker designates the blend for
 * machines — are resolved by the caller (`beans-section-queries.ts`) from the
 * one place each is decided, and handed in on the row, so every rule below can
 * be tested with fixtures.
 *
 * What holds for both sections:
 *
 *  - **Only coffee beans**: the product's categories name the beans system,
 *    resolved exactly as the card's badge is (`resolveProductFormat`), so
 *    instant coffee filed under beans is never one of them.
 *  - **Only what can be ordered**: not marked sold out. A shortlist that
 *    points at a pack nobody can buy is a claim about nothing.
 *  - **Only with a price per kilogram**: price and pack weight both known.
 *    The order is by that price and the page prints it beside each product,
 *    so a product without one has no place in the order.
 *  - **One total order**: price per kilogram, then the supplier's name, then
 *    the id — the tie-break the listings' sorts and the landings use — so two
 *    renders of the same catalog list the same products in the same order.
 *  - **Between `BEANS_SECTION_MIN` and `BEANS_SECTION_MAX` products**, or no
 *    section at all. Fewer than three is not a choice, and a heading over one
 *    pack would promise a range the shop does not have; the page then shows
 *    neither the heading nor the sentences.
 *  - **A product stands in one section at most** (see `selectBeansSections`).
 */

export type BeansSectionId = "italian" | "automatic";

/** In the order the page shows them. */
export const BEANS_SECTION_IDS: readonly BeansSectionId[] = ["italian", "automatic"];

/** The most products a section lists: a shortlist, not the listing again. */
export const BEANS_SECTION_MAX = 6;

/** The fewest a section may list and still be shown. */
export const BEANS_SECTION_MIN = 3;

/** A product on sale, with the two facts the rules read already resolved. */
export interface BeansSectionRow extends LandingRow {
  /**
   * The brand is recorded as Italian, with the evidence beside it, in
   * `content/brand-facts.ts`. A brand with no entry there is not Italian here,
   * whatever its name sounds like.
   */
  readonly italianBrand: boolean;
  /**
   * The maker's own name for the blend designates it for machines that grind
   * every cup: „Vending“ in the name, by the rule `/kafe-za-vending-mashini`
   * lists its blends by (`isVendingBlendName` in `vending.ts`).
   */
  readonly machineBlend: boolean;
}

export interface BeansSectionItem {
  readonly id: string;
  /** Exact price per kilogram, as `pricePerUnitMeasure` gives it. */
  readonly perKg: string;
}

export interface BeansSection {
  readonly id: BeansSectionId;
  readonly items: readonly BeansSectionItem[];
}

interface Candidate {
  readonly row: BeansSectionRow;
  readonly perKg: string;
}

function candidate(row: BeansSectionRow): Candidate | null {
  if (resolveProductFormat(row.categoryKeys, row.name).system?.id !== "beans") return null;
  if (row.availability === "out_of_stock") return null;
  const unit = pricePerUnitMeasure(row.price, row.weightValue, row.weightUnit);
  if (!unit || unit.unit !== "kg") return null;
  return { row, perKg: unit.amount };
}

/** Lowest price per kilogram first; then name, then id, so the order is total. */
function byKilogramPrice(a: Candidate, b: Candidate): number {
  const order = compareDecimal(parseDecimal(a.perKg), parseDecimal(b.perKg));
  if (order !== 0) return order;
  if (a.row.name !== b.row.name) return a.row.name < b.row.name ? -1 : 1;
  return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
}

/** The first `BEANS_SECTION_MAX` of an ordered pool, or nothing below the minimum. */
function shortlist(id: BeansSectionId, ordered: readonly Candidate[]): BeansSection | null {
  if (ordered.length < BEANS_SECTION_MIN) return null;
  return {
    id,
    items: ordered
      .slice(0, BEANS_SECTION_MAX)
      .map((entry) => ({ id: entry.row.id, perKg: entry.perKg })),
  };
}

/** The brand a product is grouped under: its stored slug, else its source key. */
const brandKey = (row: BeansSectionRow): string | null => row.brandSlug ?? row.brandSourceKey;

/**
 * What each section lists, in page order; a section with too little to list
 * is left out.
 *
 *  - **`automatic`** — „Кафе на зърна за автоматична кафемашина“. Every bean
 *    here goes in an automatic machine: the machine database files every
 *    automatic model under the beans system, whatever its brand. Nothing the
 *    catalog holds says one bag suits such a machine better than another —
 *    no roast for most products, no oil content, attributes that are about
 *    the cup — except the maker's own name for the blend, and so that is the
 *    rule: the blends whose name designates them for machines that grind every
 *    cup. Lowest price per kilogram first, up to the cap.
 *  - **`italian`** — „Италианско кафе на зърна“. The products of brands that
 *    `brand-facts.ts` records as Italian, **one per brand**: the brand's pack
 *    with the lowest price per kilogram. The brands are then ordered by that
 *    price, lowest first, up to the cap. One per brand because the question
 *    the heading answers is which Italian coffees there are, and six packs of
 *    one brand would answer a narrower one.
 *
 * **A product stands in one section at most.** The automatic section's rule is
 * the narrower claim, and its blends are the whole of it, so a blend it lists
 * is left to it; the Italian section then takes that brand's next pack. Only
 * while the automatic section is shown: a blend it would not list is free to
 * stand for its brand.
 */
export function selectBeansSections(rows: readonly BeansSectionRow[]): readonly BeansSection[] {
  const pool = rows
    .map(candidate)
    .filter((entry): entry is Candidate => entry !== null)
    .sort(byKilogramPrice);

  const automatic = shortlist(
    "automatic",
    pool.filter((entry) => entry.row.machineBlend),
  );
  const taken = new Set(automatic?.items.map((item) => item.id) ?? []);

  // The pool is already in order, so a brand's first pack is its lowest per kilogram.
  const perBrand = new Map<string, Candidate>();
  for (const entry of pool) {
    const brand = brandKey(entry.row);
    if (!entry.row.italianBrand || brand === null || taken.has(entry.row.id)) continue;
    if (!perBrand.has(brand)) perBrand.set(brand, entry);
  }
  const italian = shortlist("italian", [...perBrand.values()].sort(byKilogramPrice));

  const chosen: Readonly<Record<BeansSectionId, BeansSection | null>> = { italian, automatic };
  return BEANS_SECTION_IDS.flatMap((id) => {
    const section = chosen[id];
    return section ? [section] : [];
  });
}
