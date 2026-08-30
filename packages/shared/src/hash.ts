import { createHash } from "node:crypto";

/** Hex SHA-256 of a string or buffer. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Deterministic JSON serialisation: object keys are sorted recursively so that
 * two structurally equal values always produce the same string. Arrays keep
 * their order because array order is usually meaningful; callers sort first
 * when it is not.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = canonicalize(v);
  return out;
}

/**
 * Hash of the business-relevant fields of an entity.
 *
 * Callers must pass only semantically meaningful values — never timestamps,
 * generated ids or run counters — otherwise every sync reports every product
 * as changed.
 */
export function semanticHash(fields: Record<string, unknown>): string {
  return sha256Hex(stableStringify(fields));
}

/** Short, human-friendly hash prefix for log lines and object keys. */
export function shortHash(hex: string, length = 16): string {
  return hex.slice(0, length);
}
