import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The guard in front of every `/api/cron/*` route.
 *
 * Vercel calls a cron path with a plain GET and, when a `CRON_SECRET`
 * environment variable exists, sends it as `Authorization: Bearer <secret>`.
 * That header is the only thing separating the route from the public internet,
 * and these routes send mail and delete rows, so the check has to be right
 * rather than merely present.
 *
 * Two decisions worth keeping:
 *
 *  - **No secret configured means the route does not exist.** A cron route that
 *    is open until somebody remembers to set a variable is worse than one that
 *    is absent, so it answers 404 — the same answer an unknown path gets —
 *    rather than 401, which would confirm that something is here.
 *  - **The comparison hashes both sides first.** `timingSafeEqual` throws on
 *    buffers of different lengths, and checking the length beforehand is itself
 *    a timing signal for the secret's length. Equal-length digests remove both.
 */

export type CronAuthResult = "ok" | "not_found" | "unauthorized";

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/** Pure: the header and the secret in, a verdict out. */
export function checkCronAuth(
  authorization: string | null | undefined,
  secret: string | undefined,
): CronAuthResult {
  if (!secret) return "not_found";
  if (!authorization) return "unauthorized";

  const expected = `Bearer ${secret}`;
  return timingSafeEqual(digest(authorization), digest(expected)) ? "ok" : "unauthorized";
}

/**
 * For route handlers: `null` means carry on, anything else is the answer to
 * send. Reads `CRON_SECRET` on every call, so a rotated secret takes effect on
 * the next invocation instead of the next cold start.
 */
export function guardCron(request: Request): Response | null {
  const verdict = checkCronAuth(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (verdict === "ok") return null;

  if (verdict === "not_found") return new Response("Not Found", { status: 404 });
  return new Response("Unauthorized", {
    status: 401,
    headers: { "www-authenticate": "Bearer" },
  });
}
