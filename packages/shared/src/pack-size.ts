import { normalizeLabel } from "./text.ts";
import { type NormalizedWeight, parseWeight } from "./weight.ts";

/**
 * A product's pack size: the one place that decides it.
 *
 * The supplier states a pack size twice, in two fields typed separately: at
 * the end of the product's name ("Дозети Illy Decaffeinato 18бр.") and in a
 * pack field of its own ("100 бр."). For that tin the two disagree, and the
 * price (9,20 €) is the price of 18 pods. Dividing it by the pack field's 100
 * printed 0,09 € a cup on a product that costs 0,51 € a cup — on the figure
 * this shop exists to get right.
 *
 * **The rule: where the name and the pack field disagree, the name's size is
 * the pack size.** A name is what the supplier's own customers read, order by
 * and complain about, so it is the one of the two that has been checked; the
 * pack field is a filter facet nobody looks at twice.
 *
 * Everything that needs a pack size gets it from here, so nothing can show
 * one size and compute from another:
 *
 *   - the sync's normalisation (`normalizeProduct` in `@catalog/scraper-core`)
 *     stores it: `products.weight`, `weight_value`, `weight_unit`, and from
 *     those `servings`. Every price per cup on the storefront is read from
 *     those columns, which is why no reader had to change;
 *   - the name model (`productName`) prints it;
 *   - `catalog:pack-size` applies it to rows stored before the rule existed.
 *
 * What the rule does not touch is identity. A product's source key is built
 * from the pack field as the supplier typed it (`/illy-decaffeinato-18/#100pc`),
 * because a key has to recognise the supplier's record, not be right about
 * coffee; re-keying on a correction would move the product for nothing.
 *
 * A disagreement is the supplier's mistake and only the supplier can fix it,
 * so it is never silent: the decision carries both sizes (`conflict`), the
 * sync stores them on the row, and the admin's sync page lists them.
 *
 * Pure and deterministic.
 */

export interface PackSizeConflict {
  /** The size the name states, as the shop writes it: „18 бр.“. */
  readonly inName: string;
  /** The size the pack field states, as the shop writes it: „100 бр.“. */
  readonly inPackField: string;
}

export interface PackSizeDecision {
  /**
   * Which of the two the pack size is taken from. `pack_field` whenever the
   * field states a size the name does not contradict; `name` when the name
   * contradicts it, or when the field states none; null when neither does.
   */
  readonly from: "pack_field" | "name" | null;
  /**
   * The size to store when `from` is `name`: parsed from the name, with `raw`
   * set to the size as the shop writes it. Null otherwise — the pack field
   * stands exactly as the caller holds it.
   */
  readonly named: NormalizedWeight | null;
  /** The pack size as the shop writes it beside a name, or null. */
  readonly label: string | null;
  /** Set only when both state a size and the two differ. */
  readonly conflict: PackSizeConflict | null;
}

/** A pack size at the end of a name: "16 бр.", "100бр.", "0.500кг.", "1кг.". */
export const TRAILING_QUANTITY = /\s*\d+(?:[.,]\d+)?\s*(?:кг|гр|г|мл|л|бр|kg|g|ml|l|pcs|pc)\.?$/iu;

/**
 * "2 x 250 г": the name ends with one part of a multipack, not with its size.
 * The digit is required, or every line ending in an "x" ("Lux 16 бр.") would
 * be read as one.
 */
const MULTIPLIED = /\d\s*[x×*х]\s*$/iu;

/** Bulgarian writes a decimal comma: „1,5 кг“. At most three decimals. */
function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace(".", ",");
}

/**
 * The pack size as the shop writes it beside a name: „1 кг“, „250 г“,
 * „16 бр.“. Null for anything that is not a positive quantity in a known
 * unit, and for a fractional piece count, which is a parsing accident.
 */
export function packQuantityLabel(
  value: string | number | null | undefined,
  unit: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const quantity = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  switch (unit) {
    case "g":
      return quantity >= 1000
        ? `${formatNumber(quantity / 1000)} кг`
        : `${formatNumber(quantity)} г`;
    case "ml":
      return quantity >= 1000
        ? `${formatNumber(quantity / 1000)} л`
        : `${formatNumber(quantity)} мл`;
    case "pc":
      return Number.isInteger(quantity) ? `${quantity} бр.` : null;
    default:
      return null;
  }
}

/**
 * The pack size the supplier's name ends with, or null when it states none
 * that can be read as one.
 *
 * A name that ends "2 x 250 г" states 500 g in a way this does not attempt to
 * multiply out; it is read as stating nothing, so the pack field stands and no
 * conflict is raised on a guess.
 */
function sizeInName(sourceName: string): { weight: NormalizedWeight; label: string } | null {
  const name = normalizeLabel(sourceName);
  const match = name.match(TRAILING_QUANTITY);
  if (!match || match.index === undefined) return null;
  if (MULTIPLIED.test(name.slice(0, match.index))) return null;
  const weight = parseWeight(match[0]);
  const label = weight ? packQuantityLabel(weight.value, weight.unit) : null;
  return weight && label ? { weight: { ...weight, raw: label }, label } : null;
}

/**
 * Decide a product's pack size from the supplier's name and its pack field.
 *
 * The two are compared as the shop would print them, so "0.500кг." in a name
 * and 500 g in the field are one size written two ways, not a conflict.
 */
export function decidePackSize(
  sourceName: string,
  packField: {
    readonly value: string | number | null | undefined;
    readonly unit: string | null | undefined;
  } | null,
): PackSizeDecision {
  const inPackField = packField ? packQuantityLabel(packField.value, packField.unit) : null;
  const named = sizeInName(sourceName);

  if (named && inPackField && named.label !== inPackField) {
    return {
      from: "name",
      named: named.weight,
      label: named.label,
      conflict: { inName: named.label, inPackField },
    };
  }
  if (inPackField) return { from: "pack_field", named: null, label: inPackField, conflict: null };
  // The field states nothing the shop can print: the name's size, if any.
  if (named) return { from: "name", named: named.weight, label: named.label, conflict: null };
  const stated =
    packField?.value !== null && packField?.value !== undefined && packField.value !== "";
  return { from: stated ? "pack_field" : null, named: null, label: null, conflict: null };
}

/** Reads a `PackSizeConflict` back out of a `jsonb` column; null for anything else. */
export function parsePackSizeConflict(value: unknown): PackSizeConflict | null {
  if (typeof value !== "object" || value === null) return null;
  const { inName, inPackField } = value as Record<string, unknown>;
  return typeof inName === "string" && typeof inPackField === "string"
    ? { inName, inPackField }
    : null;
}
