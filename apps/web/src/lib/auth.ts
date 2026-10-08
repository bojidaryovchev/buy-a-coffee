import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Admin authentication.
 *
 * One shop, one person answering the phone, one account. A password in an
 * environment variable plus a signed cookie is the right weight — an identity
 * provider here would be ceremony, and there is nobody to administer it.
 *
 * With no `ADMIN_PASSWORD` configured the admin is **disabled** rather than
 * falling back to a default. A shipped default password is worse than no admin
 * at all, and this panel reads every customer's phone number and can send mail
 * over the shop's own DKIM signature.
 *
 * On a deployment the bar is higher, and missing it lands in that same
 * disabled state — see `adminGate`. Guessing is bounded separately, in
 * `sign-in-guard.ts`.
 *
 * What this is not: a general authorisation system. There are no roles, no
 * users table and no audit trail, because there is one operator. If a second
 * person ever needs their own login, this file is the thing to replace, not to
 * extend.
 */

const COOKIE = "bac_admin";
const MAX_AGE_SECONDS = 60 * 60 * 12;

/**
 * `||`, not `??`, and it matters.
 *
 * A key declared but left blank in `.env` arrives as an empty string, not as
 * undefined, so `??` keeps it and every signature is made with an empty key.
 * Sessions then sign fine and never verify: login succeeds, the cookie is set,
 * and the layout bounces straight back to the login form.
 *
 * The fallback to the password is a local-development convenience only. On a
 * deployment `adminGate` refuses to enable the panel without a separate
 * secret, so this line never signs a real session with the password.
 */
const secret = (): string => process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";

/** Shorter than this, a password is not allowed to guard a deployed panel. */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Is this a deployment, as opposed to somebody's machine or a test run?
 *
 * Precisely:
 *
 *  - `VERCEL_ENV` is `production` or `preview`; or
 *  - `VERCEL_ENV` is unset (not on Vercel at all) and
 *    `NEXT_PUBLIC_ENVIRONMENT` is `production`.
 *
 * `VERCEL_ENV` is a system variable the platform sets on every deployment and
 * nobody can forget, which is why it is asked first — the same reasoning as
 * `robots.ts`. Previews count, unlike there: a preview is a public URL, and
 * previews currently read the same database as production, so a weak password
 * on one exposes exactly the same customer data.
 *
 * `NODE_ENV` is deliberately **not** the signal. `next build && next start` on
 * a laptop is `NODE_ENV=production` too, and that is how the end-to-end suite
 * runs; it must keep working with the local values in `.env.local`.
 */
export function isDeployment(env: Environment = process.env): boolean {
  const host = env.VERCEL_ENV;
  if (host) return host === "production" || host === "preview";
  return env.NEXT_PUBLIC_ENVIRONMENT === "production";
}

export type AdminGate =
  | { readonly enabled: true }
  | {
      readonly enabled: false;
      readonly reason: "no_password" | "short_password" | "no_session_secret";
    };

/**
 * Whether the panel may be used at all.
 *
 * Anywhere: no password, no panel. On a deployment, additionally:
 *
 *  - the password must be at least `MIN_ADMIN_PASSWORD_LENGTH` characters, and
 *  - `ADMIN_SESSION_SECRET` must be set and must not be the password. Without
 *    it the cookie is signed with the password itself: every session cookie
 *    becomes an offline oracle for guessing the password, and the password
 *    cannot be rotated without also signing everybody out.
 *
 * A refusal is the same safe state as having no password: the pages say the
 * panel is off, sign-in always fails, and no existing cookie verifies.
 */
export function adminGate(env: Environment = process.env): AdminGate {
  const password = env.ADMIN_PASSWORD;
  if (!password) return { enabled: false, reason: "no_password" };
  if (!isDeployment(env)) return { enabled: true };

  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return { enabled: false, reason: "short_password" };
  }
  const sessionSecret = env.ADMIN_SESSION_SECRET;
  if (!sessionSecret || sessionSecret === password) {
    return { enabled: false, reason: "no_session_secret" };
  }
  return { enabled: true };
}

const REFUSAL_DETAIL = {
  short_password: `ADMIN_PASSWORD is shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters.`,
  no_session_secret:
    "ADMIN_SESSION_SECRET is not set, or is the same value as ADMIN_PASSWORD. Set it to its own long random value.",
} as const;

let refusalLogged = false;

/**
 * The gate, for callers, with its one log line.
 *
 * Logged once per process, not once per request: the panel pages call this on
 * every render, and a line per render would bury the one that matters. A
 * missing password is not logged at all — that is the documented way to run
 * without a panel, not a mistake.
 */
export function isAdminConfigured(): boolean {
  const gate = adminGate();
  if (gate.enabled) return true;

  if (gate.reason !== "no_password" && !refusalLogged) {
    refusalLogged = true;
    console.error(
      JSON.stringify({
        level: "error",
        msg: "admin.disabled",
        reason: gate.reason,
        detail: `Admin panel is DISABLED on this deployment: ${REFUSAL_DETAIL[gate.reason]}`,
      }),
    );
  }
  return false;
}

function sign(expiresAt: number): string {
  const payload = String(expiresAt);
  const mac = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${mac}`;
}

function verify(token: string | undefined): boolean {
  /* A disabled panel has no sessions. Without this, a cookie issued before the
     configuration was tightened would keep working against every server
     action, each of which trusts `isSignedIn` and nothing else. */
  if (!token || !isAdminConfigured()) return false;

  const [payload, mac] = token.split(".");
  if (!payload || !mac) return false;

  const expected = createHmac("sha256", secret()).update(payload).digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  return Number(payload) > Date.now();
}

/** Constant-time password comparison, so timing cannot leak the length. */
export function passwordMatches(candidate: string): boolean {
  const actual = process.env.ADMIN_PASSWORD;
  if (!actual || !isAdminConfigured()) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function createSession(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, sign(Date.now() + MAX_AGE_SECONDS * 1000), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function isSignedIn(): Promise<boolean> {
  const store = await cookies();
  return verify(store.get(COOKIE)?.value);
}
