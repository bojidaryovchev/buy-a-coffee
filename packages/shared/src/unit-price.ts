import {
  type Decimal,
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
} from "./decimal.ts";

/**
 * Price per unit of measure — the "цена за единица мярка" a shelf label carries.
 *
 * ⚠ THIS IS A LEGAL REQUIREMENT, not a comparison feature, which is why it
 * lives beside `pricePerServing` rather than inside it. Directive 98/6/EC on
 * price indication, implemented in Bulgarian law, requires goods sold by weight
 * or volume to show a unit price alongside the selling price — and it applies
 * to distance selling exactly as it applies to a shelf. A 250 g bag priced only
 * as a total is the precise case the rule exists for.
 *
 * It is a different number from `pricePerServing` and both are worth having.
 * Per-serving answers "what does a cup cost me", is an estimate for ground
 * coffee because dose is a property of the machine, and is the one the wizard
 * ranks on. Per-kilogram answers "is this bag good value against that one", is
 * exact, and is the one the law asks for.
 *
 * Pieces are deliberately out of scope. A box of capsules is not sold by weight
 * or volume, so the unit-price rule does not reach it; `pricePerServing`
 * already gives a per-capsule figure, which is the useful comparison there.
 */

/** Fraction digits kept before display rounds. Two would lose cheap-per-litre syrups. */
export const UNIT_PRICE_SCALE = 4;

/** The reference quantity the price is expressed against. */
export type MeasureUnit = "kg" | "l";

export interface UnitPrice {
  /** Exact price for one kilogram or one litre, as a decimal string. */
  readonly amount: string;
  readonly unit: MeasureUnit;
}

/** 1000 g in a kilogram, 1000 ml in a litre — the same factor either way. */
const PER_BASE_UNIT: Decimal = parseDecimal("1000");

/**
 * Price for one kilogram or one litre, from the normalised weight columns.
 *
 * Returns null rather than guessing whenever the answer would be invented: no
 * price, no pack size, a zero size, or a unit that is not a weight or a volume.
 * A wrong unit price on a shelf label is a consumer-protection problem, so the
 * absent case has to stay absent.
 */
export function pricePerUnitMeasure(
  price: string | null | undefined,
  weightValue: string | null | undefined,
  weightUnit: string | null | undefined,
): UnitPrice | null {
  if (!price || !weightValue || !weightUnit) return null;

  /* Grams and millilitres are the base units the scraper normalises to; the
     reference quantity is a thousand of either. Pieces are not sold by measure. */
  const unit: MeasureUnit | null =
    weightUnit === "g" ? "kg" : weightUnit === "ml" ? "l" : null;
  if (!unit) return null;

  let amount: Decimal;
  let quantity: Decimal;
  try {
    amount = parseDecimal(price);
    quantity = parseDecimal(weightValue);
  } catch {
    return null;
  }
  if (quantity.unscaled <= 0n || amount.unscaled < 0n) return null;

  /* price / (quantity / 1000) === price * 1000 / quantity, and doing it in that
     order keeps the intermediate exact instead of dividing twice. */
  const scaledUp = multiplyDecimal(amount, PER_BASE_UNIT, amount.scale);
  const perUnit = divideDecimal(scaledUp, quantity, UNIT_PRICE_SCALE);

  return { amount: formatDecimal(perUnit), unit };
}
