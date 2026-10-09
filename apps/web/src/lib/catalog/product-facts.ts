import { MACHINE_BRANDS } from "@/content/machines";
import { getBrewingSystem, type BrewingSystem } from "@/lib/recommend/systems";
import type { Locale } from "@/i18n/config";
import { categoryHref, routes, type CategoryKeys } from "@/lib/routes";

/**
 * What the product page may say about one product beyond its name and price.
 *
 * Everything here turns a stored value into the words a customer reads, and
 * every function answers `null` (or an empty list) when the record does not
 * hold the value. The page omits the row; it never prints a dash, a zero or a
 * guess.
 */

/**
 * "Състав", from `products.arabica_percent`.
 *
 * The column holds the arabica share exactly as the product's page stated it,
 * and only that (`packages/scraper-core/src/parsers/productFacts.ts`): a page
 * that says "100% робуста" stores null, not 0, because it said nothing about
 * arabica. The same reasoning runs the other way here. "70% арабика" does not
 * say what the other 30% is — robusta is the usual answer and not the only
 * one — so the remainder is never named. Subtracting from 100 and calling the
 * result robusta would be inference presented as a stated fact.
 *
 * Null for anything the column cannot legitimately hold.
 */
export function compositionLabel(arabicaPercent: number | null | undefined): string | null {
  if (arabicaPercent === null || arabicaPercent === undefined) return null;
  if (!Number.isInteger(arabicaPercent) || arabicaPercent < 0 || arabicaPercent > 100) return null;
  return `${arabicaPercent}% арабика`;
}

/** Bulgarian writes a decimal comma: "0,5 кг". At most three decimals. */
function formatQuantity(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace(".", ",");
}

/**
 * The pack size as a figure with its unit: "1 кг", "500 г", "16 бр.".
 *
 * Built from the normalised weight columns rather than the raw `weight` text,
 * which arrives as "0.500кг." and "150бр." Null for a pack with no usable
 * size, and for a fractional piece count, which is a parsing accident.
 */
export function packLabel(
  pack: { readonly value: string; readonly unit: string } | null | undefined,
): string | null {
  if (!pack) return null;
  const quantity = Number(pack.value);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  switch (pack.unit) {
    case "g":
      return quantity >= 1000
        ? `${formatQuantity(quantity / 1000)} кг`
        : `${formatQuantity(quantity)} г`;
    case "ml":
      return quantity >= 1000
        ? `${formatQuantity(quantity / 1000)} л`
        : `${formatQuantity(quantity)} мл`;
    case "pc":
      return Number.isInteger(quantity) ? `${quantity} бр.` : null;
    default:
      return null;
  }
}

/**
 * Where the system badge links: the product's own category that binds it to
 * its system.
 *
 * Resolved through the system's `categorySlugs` and `categorySourceKeys`
 * against the categories the product is actually in — never from the system's
 * first slug, which may not exist in this catalog, and never from the name.
 * Null when no category of the product belongs to the system; the badge is
 * then shown unlinked rather than pointed at a guessed URL.
 */
export function systemListingHref(
  locale: Locale,
  systemId: string | null | undefined,
  categories: ReadonlyArray<
    Pick<CategoryKeys, "slug" | "previousSourceKeys"> & { readonly sourceKey?: string | null }
  >,
): string | null {
  const system = getBrewingSystem(systemId);
  if (!system) return null;

  const match = categories.find(
    (category) =>
      system.categorySlugs.includes(category.slug) ||
      (category.sourceKey ? system.categorySourceKeys.includes(category.sourceKey) : false),
  );
  return match ? categoryHref(locale, { ...match, sourceKey: match.sourceKey ?? null }) : null;
}

/**
 * The compatibility sentence under the title, for capsules and pods.
 *
 * It names the system and nothing else: which machines take that system is a
 * separate claim, made from the machine database below. Beans get no line —
 * "fits machines that take beans" tells nobody anything.
 */
export function compatibilityLine(system: BrewingSystem | null | undefined): string | null {
  if (!system || system.method === "beans") return null;
  // "Машини Дози ESE" is not Bulgarian; a pod fits a machine by its filter.
  if (system.method === "pod") return "Става за еспресо машини с цедка за дози ESE.";
  return `Става за машини ${system.name}.`;
}

export interface CompatibleMachine {
  /** Brand and model together: "Krups Dolce Gusto Piccolo". */
  readonly name: string;
  /**
   * The machine brand's page, where the model is listed with its system — a
   * canonical route (`routes.machineBrand`); the component localises it.
   */
  readonly href: string;
  readonly crossFormat: boolean;
}

export interface CompatibleMachines {
  readonly shown: readonly CompatibleMachine[];
  /** Every model in the machine database that takes this system. */
  readonly total: number;
  /** Brands among `shown` whose machines fit by shared format only. */
  readonly crossFormatBrands: readonly string[];
}

/** How many machine models a product page lists before linking to the rest. */
export const COMPATIBLE_MACHINE_LIMIT = 12;

/**
 * Machines that take a system, from `content/machines.ts` and nowhere else.
 *
 * A model appears only because the hand-written machine database says it takes
 * this system. The list is capped; which models make the cut is decided by
 * taking one from each brand in turn, in the order the database is written, so
 * a system shared by several brands (Caffitaly, Tchibo, K-fee) shows all of
 * them instead of twelve models of the first.
 */
export function compatibleMachines(
  systemId: string | null | undefined,
  limit: number = COMPATIBLE_MACHINE_LIMIT,
): CompatibleMachines {
  const system = getBrewingSystem(systemId);
  if (!system) return { shown: [], total: 0, crossFormatBrands: [] };

  const perBrand = MACHINE_BRANDS.map((brand) => ({
    brand,
    models: brand.models.filter((model) => model.system === system.id),
  })).filter((entry) => entry.models.length > 0);

  const total = perBrand.reduce((sum, entry) => sum + entry.models.length, 0);
  const cap = Math.max(0, Math.min(limit, total));

  // Choose by turns, then print in the database's own order, brand by brand.
  const chosen = new Set<string>();
  for (let round = 0; chosen.size < cap; round += 1) {
    for (const { models } of perBrand) {
      const model = models[round];
      if (model && chosen.size < cap) chosen.add(model.slug);
    }
  }

  const shown = perBrand.flatMap(({ brand, models }) =>
    models
      .filter((model) => chosen.has(model.slug))
      .map((model) => ({
        // Some models already carry their maker's name ("Smeg for Lavazza…").
        name: model.name.startsWith(brand.name) ? model.name : `${brand.name} ${model.name}`,
        href: routes.machineBrand(brand.slug),
        crossFormat: model.crossFormat === true,
        brandName: brand.name,
      })),
  );

  const crossFormatBrands = [
    ...new Set(shown.filter((machine) => machine.crossFormat).map((machine) => machine.brandName)),
  ];

  return {
    shown: shown.map(({ name, href, crossFormat }) => ({ name, href, crossFormat })),
    total,
    crossFormatBrands,
  };
}
