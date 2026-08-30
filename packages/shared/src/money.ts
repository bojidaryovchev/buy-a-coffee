import { type Decimal, formatDecimal, parseDecimal, rescale, toScaledInteger } from "./decimal.ts";
import { decodeEntities } from "./text.ts";

/** Money is always stored as an exact decimal string plus an ISO currency. */
export interface Money {
  /** ISO 4217 code, or null when the source omitted any currency marker. */
  readonly currency: string | null;
  /** Canonical decimal string with exactly 2 fraction digits, e.g. "30.00". */
  readonly amount: string;
  /** Amount in minor units (cents) for exact comparison. */
  readonly minor: bigint;
}

export const MONEY_SCALE = 2;

/**
 * `\b` is ASCII-only in JavaScript regular expressions, so `\bлв\b` never
 * matches Cyrillic text. Currency markers outside ASCII are matched directly.
 */
const CURRENCY_SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
  [/€|\beur\b/i, "EUR"],
  [/лв|\bbgn\b/i, "BGN"],
  [/\$|\busd\b/i, "USD"],
  [/£|\bgbp\b/i, "GBP"],
];

export function detectCurrency(raw: string): string | null {
  for (const [pattern, code] of CURRENCY_SYMBOLS) {
    if (pattern.test(raw)) return code;
  }
  return null;
}

/**
 * Work out which of `.` / `,` is the decimal separator.
 *
 * Both separators appear in the source catalog: most prices are `€30.00` but
 * at least one is `€4,90`. Guessing wrong turns 4.90 into 490.
 */
export type AmbiguousTailPolicy = "grouping" | "decimal";

export function normalizeNumericString(
  numeric: string,
  options?: { readonly ambiguousTail?: AmbiguousTailPolicy },
): string | null {
  const cleaned = numeric.replace(/[\s\u00a0'\u2019]/g, "");
  if (!/^\d[\d.,]*$/.test(cleaned) && !/^[.,]\d+$/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const dotCount = (cleaned.match(/\./g) ?? []).length;
  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const ambiguousTail = options?.ambiguousTail ?? "grouping";

  let decimalSep: "." | "," | null = null;

  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the rightmost one is the decimal separator.
    decimalSep = lastDot > lastComma ? "." : ",";
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep: "." | "," = lastDot >= 0 ? "." : ",";
    const count = sep === "." ? dotCount : commaCount;
    const index = sep === "." ? lastDot : lastComma;
    const fractionDigits = cleaned.length - index - 1;
    const integerPart = cleaned.slice(0, index);
    if (count > 1) {
      // 1.234.567 -> grouping only.
      decimalSep = null;
    } else if (/^0\d*$/.test(integerPart) || integerPart === "") {
      // A leading-zero integer part can never be a thousands group, so the
      // separator is unambiguously decimal ("0.250", ".5").
      decimalSep = sep;
    } else if (fractionDigits === 3 && index > 0) {
      // Exactly three trailing digits with a single separator is the classic
      // ambiguous case. Retail prices do not use three decimals, so grouping
      // is the safe reading; quantities such as "1.250 \u043a\u0433" are the opposite,
      // which is why callers can override the policy.
      decimalSep = ambiguousTail === "decimal" ? sep : null;
    } else {
      decimalSep = sep;
    }
  }

  let result: string;
  if (decimalSep === null) {
    result = cleaned.replace(/[.,]/g, "");
  } else {
    const other = decimalSep === "." ? "," : ".";
    const withoutGrouping = cleaned.split(other).join("");
    const parts = withoutGrouping.split(decimalSep);
    const intPart = parts.slice(0, -1).join("") || "0";
    const fracPart = parts[parts.length - 1] ?? "";
    result = fracPart ? `${intPart}.${fracPart}` : intPart;
  }
  if (!/^\d+(\.\d+)?$/.test(result)) return null;
  return result;
}

/**
 * Parse a scraped price such as `€30.00`, `€4,90`, `10,70 лв.` or `""`.
 * Returns null for absent/unparseable prices — several real products genuinely
 * have no price, so this is an expected outcome, not an error.
 */
export function parseMoney(
  raw: string | null | undefined,
  options?: { readonly defaultCurrency?: string },
): Money | null {
  if (raw === null || raw === undefined) return null;
  const text = decodeEntities(String(raw)).trim();
  if (!text) return null;

  const currency = detectCurrency(text) ?? options?.defaultCurrency ?? null;

  const numericMatch = text.match(/\d[\d\s\u00a0.,']*/);
  if (!numericMatch) return null;
  const normalized = normalizeNumericString(numericMatch[0]);
  if (normalized === null) return null;

  let decimal: Decimal;
  try {
    decimal = parseDecimal(normalized);
  } catch {
    return null;
  }
  const scaled = rescale(decimal, MONEY_SCALE);
  return {
    currency,
    amount: formatDecimal(scaled),
    minor: toScaledInteger(scaled, MONEY_SCALE),
  };
}

/** Build a Money from an already-exact decimal string (e.g. a DB value). */
export function moneyFromDecimalString(amount: string, currency: string | null): Money | null {
  try {
    const scaled = rescale(parseDecimal(amount), MONEY_SCALE);
    return { currency, amount: formatDecimal(scaled), minor: toScaledInteger(scaled, MONEY_SCALE) };
  } catch {
    return null;
  }
}

export function moneyEquals(a: Money | null, b: Money | null): boolean {
  if (a === null || b === null) return a === b;
  return a.minor === b.minor && a.currency === b.currency;
}

/** Stable representation used inside semantic hashes. */
export function moneyHashToken(value: Money | null): string {
  return value === null ? "" : `${value.currency ?? "?"}:${value.amount}`;
}
