import {
  compareDecimal,
  packServings,
  parseDecimal,
  pricePerServing,
  stripTrailingZeros,
} from "@catalog/shared";
import { parseIntensity, STRENGTH_ORDER } from "./attributes";
import { toPriceView } from "./format";
import {
  BREWING_SYSTEMS,
  type BrewMethod,
  type BrewingSystem,
  type BrewingSystemId,
} from "@/lib/recommend/systems";

/**
 * Figures the journal quotes, derived from catalog rows.
 *
 * The articles talk about prices per cup and about the intensity scales in
 * use. Both move with every sync, so neither may be typed into prose: an
 * article that said "EUR 0.33 a cup" would be wrong the first time a price
 * changed and nobody would notice. Everything an article states as a number is
 * computed here, from the rows, with the same shared helpers the wizard and
 * the product page use — so the journal cannot contradict them.
 *
 * This file is pure: rows in, figures out, no database and no clock. The read
 * that produces the rows lives in `journal-queries.ts`. Keeping them apart is
 * what lets the selection logic below — which pair of packs makes the example,
 * which numeral shows the scale problem — be tested exhaustively.
 *
 * Every figure is nullable. A catalog that cannot support a figure (no priced
 * product, one scale only, an empty database) yields null rather than a
 * placeholder, and the article must read correctly without it.
 */

/** One active product, as much of it as the journal needs. */
export interface JournalCatalogRow {
  readonly slug: string;
  readonly name: string;
  readonly brandName: string | null;
  /** Retail price as an exact decimal string. */
  readonly price: string | null;
  readonly currency: string | null;
  readonly weightValue: string | null;
  readonly weightUnit: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  readonly categories: ReadonlyArray<{
    readonly slug: string;
    readonly sourceKey: string | null;
  }>;
}

/* --- Price per cup ------------------------------------------------------- */

/** A pack with a price and a serving count: everything a per-cup claim needs. */
export interface PricedPack {
  readonly slug: string;
  readonly name: string;
  readonly system: BrewingSystem;
  /** Whole servings in the pack. */
  readonly servings: number;
  /** True when servings come from weight rather than a piece count. */
  readonly estimated: boolean;
  /** Pack price, formatted for display. */
  readonly packPrice: string;
  /** Pack price as an exact decimal string, for comparison only. */
  readonly packPriceAmount: string;
  /** Price per cup, formatted, with "≈" in front when it is an estimate. */
  readonly perCup: string;
  /** Price per cup as an exact decimal string, for comparison only. */
  readonly perCupAmount: string;
}

export interface CupRange {
  /** How many products the range was computed over. */
  readonly count: number;
  readonly cheapest: PricedPack;
  readonly dearest: PricedPack;
}

/**
 * Two packs for the same system where pack price and per-cup price disagree
 * about which is cheaper.
 */
export interface PackReversal {
  /** More servings, higher pack price, lower price per cup. */
  readonly bigger: PricedPack;
  readonly smaller: PricedPack;
}

export interface CupCostFigures {
  readonly byMethod: Readonly<Record<BrewMethod, CupRange | null>>;
  /** Systems that have at least one priced pack, in `BREWING_SYSTEMS` order. */
  readonly bySystem: ReadonlyArray<{ readonly system: BrewingSystem; readonly range: CupRange }>;
  readonly reversal: PackReversal | null;
  /**
   * True when the dearest beans cost less per cup than the cheapest capsule.
   * Decided here, on exact decimals, so no article compares amounts itself.
   */
  readonly beansUndercutCapsules: boolean;
}

/* --- Formats ------------------------------------------------------------- */

export interface FormatSummary {
  readonly products: number;
  /** Distinct pack sizes on sale, smallest first, ready to print. */
  readonly packs: readonly string[];
}

export interface FormatFigures {
  readonly byMethod: Readonly<Record<BrewMethod, FormatSummary | null>>;
  /** Systems that hold at least one product, in `BREWING_SYSTEMS` order. */
  readonly bySystem: ReadonlyArray<{ readonly system: BrewingSystem; readonly products: number }>;
}

/* --- Intensity ----------------------------------------------------------- */

export interface IntensityScale {
  /** The top of the scale: the 12 in "8 от 12". */
  readonly max: number;
  readonly products: number;
  /** Brands with at least one product on this scale, alphabetical. */
  readonly brands: readonly string[];
}

export interface IntensityFigures {
  /** Active products considered. */
  readonly total: number;
  /** Products that declare an intensity we can parse. */
  readonly declared: number;
  readonly undeclared: number;
  /** Scales in use, lowest top first. */
  readonly scales: readonly IntensityScale[];
  /** Brands whose products are spread over more than one scale. */
  readonly mixedBrands: ReadonlyArray<{
    readonly name: string;
    readonly scales: readonly number[];
  }>;
  /**
   * One numeral that is declared on two or more scales, with where it sits on
   * each. Null when the catalog has no such numeral.
   */
  readonly sameNumeral: {
    readonly value: number;
    readonly readings: ReadonlyArray<{ readonly max: number; readonly percent: number }>;
  } | null;
  /** A decaffeinated product that nonetheless declares an intensity. */
  readonly decafWithIntensity: {
    readonly slug: string;
    readonly name: string;
    /** The declaration as published, e.g. "7 от 10". */
    readonly declared: string;
  } | null;
  /** Products per step of the shop's own three-step filter. */
  readonly strengths: ReadonlyArray<{ readonly key: string; readonly products: number }>;
}

export interface JournalFigures {
  readonly cupCost: CupCostFigures | null;
  readonly formats: FormatFigures | null;
  readonly intensity: IntensityFigures | null;
}

/** What an empty or unreachable catalog produces. Articles must survive it. */
export const EMPTY_JOURNAL_FIGURES: JournalFigures = {
  cupCost: null,
  formats: null,
  intensity: null,
};

/* --- Derivation ---------------------------------------------------------- */

const METHODS: readonly BrewMethod[] = ["beans", "capsule", "pod"];

/**
 * The brewing system a product belongs to, by category slug or source key —
 * the same either-or the wizard uses, so an upstream rename cannot make the
 * journal and the wizard disagree about what a product is.
 */
export function systemOfRow(row: JournalCatalogRow): BrewingSystem | null {
  for (const system of BREWING_SYSTEMS) {
    const matches = row.categories.some(
      (category) =>
        system.categorySlugs.includes(category.slug) ||
        (category.sourceKey !== null && system.categorySourceKeys.includes(category.sourceKey)),
    );
    if (matches) return system;
  }
  return null;
}

function toPricedPack(
  row: JournalCatalogRow,
  system: BrewingSystem,
  currency: string,
): PricedPack | null {
  // Mixed currencies cannot be ranked against each other, so only the shop's
  // own currency takes part. A product priced in anything else is left out.
  if (!row.price || (row.currency ?? currency) !== currency) return null;

  const servings = packServings(row.weightValue, row.weightUnit);
  const perCupAmount = pricePerServing(row.price, servings);
  if (!servings || !perCupAmount) return null;

  const packPrice = toPriceView(row.price, currency);
  const perCup = toPriceView(perCupAmount, currency);
  if (!packPrice || !perCup) return null;

  return {
    slug: row.slug,
    name: row.name,
    system,
    servings: servings.whole,
    estimated: servings.estimated,
    packPrice: packPrice.formatted,
    packPriceAmount: row.price,
    perCup: `${servings.estimated ? "≈ " : ""}${perCup.formatted}`,
    perCupAmount,
  };
}

const compareAmounts = (a: string, b: string): -1 | 0 | 1 =>
  compareDecimal(parseDecimal(a), parseDecimal(b));

/** Cheapest first per cup; slug breaks ties so the result is deterministic. */
function byPerCup(a: PricedPack, b: PricedPack): number {
  return compareAmounts(a.perCupAmount, b.perCupAmount) || a.slug.localeCompare(b.slug);
}

function rangeOf(packs: readonly PricedPack[]): CupRange | null {
  if (packs.length === 0) return null;
  const sorted = [...packs].sort(byPerCup);
  return { count: sorted.length, cheapest: sorted[0]!, dearest: sorted[sorted.length - 1]! };
}

/**
 * The pair that best shows pack price misleading.
 *
 * Both packs are for the same system, because comparing a capsule with a bag
 * of beans proves nothing to someone who owns one machine. The bigger pack must
 * cost more on the shelf and less in the cup, and the two per-cup prices must
 * still differ once rounded for display — "EUR 0.33 against EUR 0.33" is true
 * at four decimals and useless on a page.
 *
 * Among qualifying pairs, one counted by the piece beats one estimated from
 * weight — an example built on "≈" invites the reply that the estimate is
 * off — and after that the widest gap per cup wins: it is the pair where
 * trusting the pack price costs the buyer most.
 */
function findReversal(packs: readonly PricedPack[]): PackReversal | null {
  let best: { pair: PackReversal; exact: boolean; gap: string } | null = null;

  for (const bigger of packs) {
    for (const smaller of packs) {
      if (bigger.system.id !== smaller.system.id) continue;
      if (bigger.servings <= smaller.servings) continue;
      if (compareAmounts(bigger.packPriceAmount, smaller.packPriceAmount) <= 0) continue;
      if (compareAmounts(bigger.perCupAmount, smaller.perCupAmount) >= 0) continue;
      if (bigger.perCup === smaller.perCup) continue;

      const exact = !bigger.estimated && !smaller.estimated;
      const gap = subtract(smaller.perCupAmount, bigger.perCupAmount);
      const better =
        best === null ||
        (exact && !best.exact) ||
        (exact === best.exact &&
          (compareAmounts(gap, best.gap) > 0 ||
            (compareAmounts(gap, best.gap) === 0 &&
              `${bigger.slug}|${smaller.slug}` <
                `${best.pair.bigger.slug}|${best.pair.smaller.slug}`)));
      if (better) best = { pair: { bigger, smaller }, exact, gap };
    }
  }

  return best?.pair ?? null;
}

/** Exact difference of two decimal strings, as a decimal string. */
function subtract(a: string, b: string): string {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  const scale = Math.max(left.scale, right.scale);
  const factor = (value: { unscaled: bigint; scale: number }) =>
    value.unscaled * 10n ** BigInt(scale - value.scale);
  const diff = factor(left) - factor(right);
  const negative = diff < 0n;
  const digits = (negative ? -diff : diff).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** "250 г", "1 кг", "16" — a pack size the way a customer would say it. */
function packLabel(
  weightValue: string,
  weightUnit: string,
): { sort: number; label: string } | null {
  const amount = Number(weightValue);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const plain = stripTrailingZeros(weightValue);

  if (weightUnit === "pc") return { sort: amount, label: plain };
  if (weightUnit === "g") {
    return amount >= 1000 && amount % 1000 === 0
      ? { sort: amount, label: `${amount / 1000} кг` }
      : { sort: amount, label: `${plain} г` };
  }
  return null;
}

function intensityFigures(rows: readonly JournalCatalogRow[]): IntensityFigures | null {
  if (rows.length === 0) return null;

  const scales = new Map<number, { products: number; brands: Set<string> }>();
  const brandScales = new Map<string, Set<number>>();
  /** numeral → the scales it is declared on */
  const numerals = new Map<number, Set<number>>();
  let declared = 0;
  let decaf: { slug: string; name: string; declared: string; fraction: number } | null = null;

  for (const row of rows) {
    const raw = row.attributes.intensity;
    const reading = parseIntensity(raw);
    if (!reading || !raw) continue;
    declared += 1;

    const scale = scales.get(reading.max) ?? { products: 0, brands: new Set<string>() };
    scale.products += 1;
    if (row.brandName) {
      scale.brands.add(row.brandName);
      const seen = brandScales.get(row.brandName) ?? new Set<number>();
      seen.add(reading.max);
      brandScales.set(row.brandName, seen);
    }
    scales.set(reading.max, scale);

    const on = numerals.get(reading.value) ?? new Set<number>();
    on.add(reading.max);
    numerals.set(reading.value, on);

    if (row.attributes.decaf === "yes") {
      const better =
        decaf === null ||
        reading.fraction > decaf.fraction ||
        (reading.fraction === decaf.fraction && row.slug < decaf.slug);
      if (better) {
        decaf = {
          slug: row.slug,
          name: row.name,
          declared: raw.trim(),
          fraction: reading.fraction,
        };
      }
    }
  }

  /*
   * The numeral that makes the point best: declared on the most scales, then
   * with the widest spread between where it sits on them, then the larger
   * numeral. Chosen from the data so the example is always one a reader can
   * find in the catalog.
   */
  let sameNumeral: IntensityFigures["sameNumeral"] = null;
  let bestSpread = -1;
  for (const [value, on] of [...numerals.entries()].sort((a, b) => a[0] - b[0])) {
    if (on.size < 2) continue;
    const readings = [...on]
      .sort((a, b) => a - b)
      .map((max) => ({ max, percent: Math.round((value / max) * 100) }));
    const spread = readings[0]!.percent - readings[readings.length - 1]!.percent;
    const current = sameNumeral?.readings.length ?? 0;
    if (readings.length > current || (readings.length === current && spread >= bestSpread)) {
      sameNumeral = { value, readings };
      bestSpread = spread;
    }
  }

  const strengthCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.attributes.strength;
    if (key) strengthCounts.set(key, (strengthCounts.get(key) ?? 0) + 1);
  }

  return {
    total: rows.length,
    declared,
    undeclared: rows.length - declared,
    scales: [...scales.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([max, scale]) => ({
        max,
        products: scale.products,
        brands: [...scale.brands].sort((a, b) => a.localeCompare(b)),
      })),
    mixedBrands: [...brandScales.entries()]
      .filter(([, seen]) => seen.size > 1)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, seen]) => ({ name, scales: [...seen].sort((a, b) => a - b) })),
    sameNumeral,
    decafWithIntensity: decaf
      ? { slug: decaf.slug, name: decaf.name, declared: decaf.declared }
      : null,
    strengths: STRENGTH_ORDER.filter((key) => strengthCounts.has(key)).map((key) => ({
      key,
      products: strengthCounts.get(key) ?? 0,
    })),
  };
}

/**
 * Everything the journal quotes, from one pass over the active catalog.
 *
 * `currency` is the shop's currency; it is a parameter rather than an import
 * so the function stays a pure one and a test can pin it.
 */
export function computeJournalFigures(
  rows: readonly JournalCatalogRow[],
  currency: string,
): JournalFigures {
  const packs: PricedPack[] = [];
  const productsBySystem = new Map<BrewingSystemId, number>();
  const packSizes = new Map<BrewMethod, Map<string, number>>();

  for (const row of rows) {
    const system = systemOfRow(row);
    if (!system) continue;

    productsBySystem.set(system.id, (productsBySystem.get(system.id) ?? 0) + 1);

    if (row.weightValue && row.weightUnit) {
      const size = packLabel(row.weightValue, row.weightUnit);
      if (size) {
        const sizes = packSizes.get(system.method) ?? new Map<string, number>();
        sizes.set(size.label, size.sort);
        packSizes.set(system.method, sizes);
      }
    }

    const pack = toPricedPack(row, system, currency);
    if (pack) packs.push(pack);
  }

  const systemsWithProducts = BREWING_SYSTEMS.filter(
    (system) => (productsBySystem.get(system.id) ?? 0) > 0,
  );

  const formats: FormatFigures | null =
    systemsWithProducts.length === 0
      ? null
      : {
          byMethod: Object.fromEntries(
            METHODS.map((method) => {
              const products = systemsWithProducts
                .filter((system) => system.method === method)
                .reduce((sum, system) => sum + (productsBySystem.get(system.id) ?? 0), 0);
              const sizes = [...(packSizes.get(method)?.entries() ?? [])]
                .sort((a, b) => a[1] - b[1])
                .map(([label]) => label);
              return [method, products > 0 ? { products, packs: sizes } : null];
            }),
          ) as Record<BrewMethod, FormatSummary | null>,
          bySystem: systemsWithProducts.map((system) => ({
            system,
            products: productsBySystem.get(system.id) ?? 0,
          })),
        };

  const byMethod = Object.fromEntries(
    METHODS.map((method) => [
      method,
      rangeOf(packs.filter((pack) => pack.system.method === method)),
    ]),
  ) as Record<BrewMethod, CupRange | null>;

  const cupCost: CupCostFigures | null =
    packs.length === 0
      ? null
      : {
          byMethod,
          bySystem: BREWING_SYSTEMS.flatMap((system) => {
            const range = rangeOf(packs.filter((pack) => pack.system.id === system.id));
            return range ? [{ system, range }] : [];
          }),
          reversal: findReversal(packs),
          beansUndercutCapsules:
            byMethod.beans !== null &&
            byMethod.capsule !== null &&
            compareAmounts(
              byMethod.beans.dearest.perCupAmount,
              byMethod.capsule.cheapest.perCupAmount,
            ) < 0,
        };

  return { cupCost, formats, intensity: intensityFigures(rows) };
}
