/**
 * Minimal exact decimal helpers backed by BigInt.
 *
 * Money and weights are parsed from scraped text and then used for identity,
 * hashing and display. Floating point is never used: `0.1 + 0.2` style drift
 * would silently corrupt prices and make semantic hashes unstable.
 */

export interface Decimal {
  /** Unscaled value. `123n` with scale 2 means 1.23. */
  readonly unscaled: bigint;
  /** Number of fraction digits. */
  readonly scale: number;
}

export class DecimalParseError extends Error {
  constructor(readonly input: string) {
    super(`Not a valid decimal: ${JSON.stringify(input)}`);
    this.name = "DecimalParseError";
  }
}

/** Parse a plain decimal string (`-12.340`) into an exact Decimal. */
export function parseDecimal(input: string): Decimal {
  const trimmed = input.trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) throw new DecimalParseError(input);
  const [, sign = "", intPart = "", fracPart = ""] = match;
  if (intPart === "" && fracPart === "") throw new DecimalParseError(input);
  const digits = `${intPart}${fracPart}` || "0";
  const unscaled = BigInt(digits) * (sign === "-" ? -1n : 1n);
  return { unscaled, scale: fracPart.length };
}

function pow10(n: number): bigint {
  let result = 1n;
  for (let i = 0; i < n; i += 1) result *= 10n;
  return result;
}

/** Re-scale a Decimal, rounding half-away-from-zero when digits are lost. */
export function rescale(value: Decimal, targetScale: number): Decimal {
  if (targetScale === value.scale) return value;
  if (targetScale > value.scale) {
    return {
      unscaled: value.unscaled * pow10(targetScale - value.scale),
      scale: targetScale,
    };
  }
  const factor = pow10(value.scale - targetScale);
  const negative = value.unscaled < 0n;
  const abs = negative ? -value.unscaled : value.unscaled;
  const quotient = abs / factor;
  const remainder = abs % factor;
  // Half-away-from-zero: the conventional expectation for retail money.
  const rounded = remainder * 2n >= factor ? quotient + 1n : quotient;
  return { unscaled: negative ? -rounded : rounded, scale: targetScale };
}

/** Render a Decimal as a plain decimal string with exactly `scale` digits. */
export function formatDecimal(value: Decimal): string {
  const negative = value.unscaled < 0n;
  const digits = (negative ? -value.unscaled : value.unscaled).toString();
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(value.scale + 1, "0");
  const intPart = padded.slice(0, padded.length - value.scale);
  const fracPart = padded.slice(padded.length - value.scale);
  return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}

/** Multiply by a decimal factor exactly, then round to `targetScale`. */
export function multiplyDecimal(value: Decimal, factor: Decimal, targetScale: number): Decimal {
  const product: Decimal = {
    unscaled: value.unscaled * factor.unscaled,
    scale: value.scale + factor.scale,
  };
  return rescale(product, targetScale);
}

export function compareDecimal(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const scale = Math.max(a.scale, b.scale);
  const left = rescale(a, scale).unscaled;
  const right = rescale(b, scale).unscaled;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Convert to an integer count of the smallest unit at `scale` (e.g. cents). */
export function toScaledInteger(value: Decimal, scale: number): bigint {
  return rescale(value, scale).unscaled;
}

/**
 * Drop insignificant trailing zeros from a plain decimal string.
 * "0.5000" -> "0.5", "250.00" -> "250", "0.000" -> "0".
 */
export function stripTrailingZeros(decimalString: string): string {
  if (!decimalString.includes(".")) return decimalString;
  const trimmed = decimalString.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}
