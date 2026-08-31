import "server-only";
import { createHash } from "node:crypto";

/**
 * Rate limiting for public write endpoints.
 *
 * An in-memory fixed-window counter. That is honest about its limits: it is
 * per-process, so a multi-instance deployment gets N times the configured
 * limit, and it resets on deploy. For a small shop's enquiry form that is
 * proportionate — the goal is to stop a script hammering the form, not to
 * enforce a billing quota.
 *
 * `createRateLimiter` takes the storage backend as a parameter so swapping in
 * Redis later is a one-line change at the call site, not a rewrite.
 */

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
}): RateLimiter {
  const buckets = new Map<string, Bucket>();
  const now = options.now ?? (() => Date.now());

  /** Drop expired buckets so the map cannot grow without bound. */
  const sweep = (currentTime: number): void => {
    if (buckets.size < 5_000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= currentTime) buckets.delete(key);
    }
  };

  return {
    check(key: string): RateLimitResult {
      const currentTime = now();
      sweep(currentTime);

      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= currentTime) {
        const resetAt = currentTime + options.windowMs;
        buckets.set(key, { count: 1, resetAt });
        return { allowed: true, remaining: options.limit - 1, resetAt };
      }

      bucket.count += 1;
      return {
        allowed: bucket.count <= options.limit,
        remaining: Math.max(0, options.limit - bucket.count),
        resetAt: bucket.resetAt,
      };
    },
  };
}

/**
 * Identify a caller without storing their IP address.
 *
 * The raw address is never persisted or logged: it is salted and hashed, so
 * rate limiting works while the stored value is not personal data we have to
 * account for.
 */
export function clientFingerprint(headers: Headers, salt = process.env.RATE_LIMIT_SALT ?? "catalog-storefront"): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip") || "unknown";
  const agent = headers.get("user-agent") ?? "";
  return createHash("sha256").update(`${salt}:${address}:${agent}`).digest("hex").slice(0, 32);
}

/**
 * Deterministic idempotency key.
 *
 * Buckets by a coarse time window so a double-clicked button or a retried
 * request collapses into one row, while a genuine second order minutes later
 * still goes through.
 */
export function idempotencyKey(parts: readonly string[], windowMs = 5 * 60_000, now = Date.now()): string {
  const bucket = Math.floor(now / windowMs);
  return createHash("sha256").update([...parts, String(bucket)].join("|")).digest("hex");
}

/** Shared limiters. Module scope so they survive between requests. */
export const inquiryLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 });
export const newsletterLimiter = createRateLimiter({ limit: 3, windowMs: 60 * 60_000 });
export const contactLimiter = createRateLimiter({ limit: 3, windowMs: 30 * 60_000 });
/*
 * Search suggestions are a read, not a write, and one visitor genuinely makes
 * many of them — the client debounces, but a fast typist still fires several
 * requests per search. The limit is set to stop a script from turning the
 * typeahead into a load generator, and is far above what typing produces.
 */
export const suggestLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
