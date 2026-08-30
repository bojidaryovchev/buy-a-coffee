import {
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  rescale,
  stripTrailingZeros,
} from "./decimal.ts";
import { decodeEntities, normalizeWhitespace } from "./text.ts";
import { normalizeNumericString } from "./money.ts";

/**
 * Pack-size normalisation.
 *
 * This is not cosmetic: pack size is part of product identity. The source
 * catalog contains two genuinely different products behind one URL
 * (`/borbone-crema-classica/` is both the 0.500кг and the 1кг pack), so the
 * canonical size token is what keeps them apart.
 */
export type WeightUnit = "g" | "pc" | "ml";

export interface NormalizedWeight {
  /** Original text exactly as scraped. */
  readonly raw: string;
  /** Quantity expressed in the base unit, as an exact decimal string. */
  readonly value: string;
  readonly unit: WeightUnit;
  /** Stable identity token, e.g. `1000g`, `250g`, `10pc`. */
  readonly canonical: string;
}

interface UnitRule {
  readonly pattern: RegExp;
  readonly unit: WeightUnit;
  /** Power of ten applied to reach the base unit. */
  readonly factorPow10: number;
}

/**
 * Order matters: `кг` must be tested before `г`, otherwise "1 кг." matches the
 * gram rule and becomes 1 g instead of 1000 g.
 */
const UNIT_RULES: readonly UnitRule[] = [
  { pattern: /(?:кг|kg|килограм\w*|kilogram\w*)\.?$/iu, unit: "g", factorPow10: 3 },
  { pattern: /(?:мл|ml|милилитр\w*)\.?$/iu, unit: "ml", factorPow10: 0 },
  { pattern: /(?:л|l|литр\w*|liter\w*|litre\w*)\.?$/iu, unit: "ml", factorPow10: 3 },
  { pattern: /(?:гр|г|g|грам\w*|gram\w*)\.?$/iu, unit: "g", factorPow10: 0 },
  { pattern: /(?:бр|броя|броj|pcs|pc|pieces?|шт)\.?$/iu, unit: "pc", factorPow10: 0 },
];

/**
 * Parse pack sizes such as `1 кг.`, `0.250кг.`, `10 бр.`, `150бр.`, `500 г`.
 * Returns null when the source omits a size (which genuinely happens).
 */
export function parseWeight(raw: string | null | undefined): NormalizedWeight | null {
  if (raw === null || raw === undefined) return null;
  const text = normalizeWhitespace(decodeEntities(String(raw)));
  if (!text) return null;

  const match = text.match(/^\s*([\d\s\u00a0.,']+)\s*(.*)$/u);
  if (!match) return null;
  const [, numericRaw = "", unitRaw = ""] = match;

  // Quantities legitimately carry three decimals ("0.250кг."), unlike retail
  // prices, so the ambiguous-tail reading is flipped for weights.
  const normalizedNumeric = normalizeNumericString(numericRaw.trim(), {
    ambiguousTail: "decimal",
  });
  if (normalizedNumeric === null) return null;

  const unitText = unitRaw.trim();
  if (!unitText) return null;

  const rule = UNIT_RULES.find((candidate) => candidate.pattern.test(unitText));
  if (!rule) return null;

  let quantity;
  try {
    quantity = parseDecimal(normalizedNumeric);
  } catch {
    return null;
  }

  // Exact scaling by a power of ten; never floating point.
  const scaled =
    rule.factorPow10 === 0
      ? quantity
      : multiplyDecimal(quantity, parseDecimal(`1${"0".repeat(rule.factorPow10)}`), quantity.scale);

  // Whole base units where possible keeps `1 кг.` and `1000 г` identical.
  const asInteger = rescale(scaled, 0);
  const isWhole = rescale(asInteger, scaled.scale).unscaled === scaled.unscaled;
  const value = isWhole ? formatDecimal(asInteger) : stripTrailingZeros(formatDecimal(scaled));

  return {
    raw: text,
    value,
    unit: rule.unit,
    canonical: `${value}${rule.unit}`,
  };
}

/** Identity token for a pack size; empty string when the source has none. */
export function weightIdentityToken(weight: NormalizedWeight | null): string {
  return weight === null ? "" : weight.canonical;
}
