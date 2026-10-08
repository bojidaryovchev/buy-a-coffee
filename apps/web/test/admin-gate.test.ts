import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The production gate on the admin panel.
 *
 * `auth.ts` reads cookies through `next/headers`, which only works inside a
 * request. The cookie jar is faked so that `isSignedIn` can be exercised too:
 * a refused configuration must also invalidate sessions that already exist.
 */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const STRONG = "a-long-local-passphrase";
const SECRET = "0123456789abcdef0123456789abcdef";

async function loadAuth() {
  vi.resetModules();
  return import("@/lib/auth");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  jar.clear();
});

describe("isDeployment", () => {
  it("is decided by VERCEL_ENV when the platform sets it", async () => {
    const { isDeployment } = await loadAuth();
    expect(isDeployment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isDeployment({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isDeployment({ VERCEL_ENV: "development" })).toBe(false);
    // The platform's answer wins over the manual flag.
    expect(isDeployment({ VERCEL_ENV: "development", NEXT_PUBLIC_ENVIRONMENT: "production" })).toBe(
      false,
    );
  });

  it("falls back to NEXT_PUBLIC_ENVIRONMENT off the platform", async () => {
    const { isDeployment } = await loadAuth();
    expect(isDeployment({ NEXT_PUBLIC_ENVIRONMENT: "production" })).toBe(true);
    expect(isDeployment({ NEXT_PUBLIC_ENVIRONMENT: "staging" })).toBe(false);
    expect(isDeployment({})).toBe(false);
  });

  it("does not treat a local production build as a deployment", async () => {
    const { isDeployment } = await loadAuth();
    // `next build && next start`, which is how the end-to-end suite runs.
    expect(isDeployment({ NODE_ENV: "production" })).toBe(false);
  });
});

describe("adminGate", () => {
  it("is disabled without a password, everywhere", async () => {
    const { adminGate } = await loadAuth();
    expect(adminGate({})).toEqual({ enabled: false, reason: "no_password" });
    expect(adminGate({ ADMIN_PASSWORD: "" })).toEqual({ enabled: false, reason: "no_password" });
    expect(adminGate({ VERCEL_ENV: "production", ADMIN_SESSION_SECRET: SECRET })).toEqual({
      enabled: false,
      reason: "no_password",
    });
  });

  it("accepts a short password and no session secret locally", async () => {
    const { adminGate } = await loadAuth();
    expect(adminGate({ ADMIN_PASSWORD: "short" })).toEqual({ enabled: true });
    expect(adminGate({ ADMIN_PASSWORD: "short", NODE_ENV: "production" })).toEqual({
      enabled: true,
    });
    expect(adminGate({ ADMIN_PASSWORD: "short", VERCEL_ENV: "development" })).toEqual({
      enabled: true,
    });
  });

  it("refuses a password shorter than 12 characters in production", async () => {
    const { adminGate, MIN_ADMIN_PASSWORD_LENGTH } = await loadAuth();
    expect(MIN_ADMIN_PASSWORD_LENGTH).toBe(12);

    const production = { VERCEL_ENV: "production", ADMIN_SESSION_SECRET: SECRET };
    expect(adminGate({ ...production, ADMIN_PASSWORD: "elevenchars" })).toEqual({
      enabled: false,
      reason: "short_password",
    });
    expect(adminGate({ ...production, ADMIN_PASSWORD: "twelve-chars" })).toEqual({ enabled: true });
  });

  it("refuses production without a separate session secret", async () => {
    const { adminGate } = await loadAuth();
    const production = { VERCEL_ENV: "production", ADMIN_PASSWORD: STRONG };

    expect(adminGate(production)).toEqual({ enabled: false, reason: "no_session_secret" });
    expect(adminGate({ ...production, ADMIN_SESSION_SECRET: "" })).toEqual({
      enabled: false,
      reason: "no_session_secret",
    });
    // Set, but to the password itself: not separate.
    expect(adminGate({ ...production, ADMIN_SESSION_SECRET: STRONG })).toEqual({
      enabled: false,
      reason: "no_session_secret",
    });
    expect(adminGate({ ...production, ADMIN_SESSION_SECRET: SECRET })).toEqual({ enabled: true });
  });

  it("holds previews, and production off the platform, to the same bar", async () => {
    const { adminGate } = await loadAuth();
    expect(adminGate({ VERCEL_ENV: "preview", ADMIN_PASSWORD: "short" })).toEqual({
      enabled: false,
      reason: "short_password",
    });
    expect(adminGate({ NEXT_PUBLIC_ENVIRONMENT: "production", ADMIN_PASSWORD: STRONG })).toEqual({
      enabled: false,
      reason: "no_session_secret",
    });
  });
});

describe("a refused configuration", () => {
  it("logs one clear line saying why, once per process, without the values", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ADMIN_PASSWORD", "tooshort");
    vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { isAdminConfigured } = await loadAuth();

    expect(isAdminConfigured()).toBe(false);
    expect(isAdminConfigured()).toBe(false);
    expect(isAdminConfigured()).toBe(false);

    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ msg: "admin.disabled", reason: "short_password" });
    expect(line).toContain("DISABLED");
    expect(line).toContain("ADMIN_PASSWORD is shorter than 12 characters");
    expect(line).not.toContain("tooshort");
    expect(line).not.toContain(SECRET);
  });

  it("names the session secret when that is what is missing", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ADMIN_PASSWORD", STRONG);
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { isAdminConfigured } = await loadAuth();

    expect(isAdminConfigured()).toBe(false);
    expect(String(logged.mock.calls[0]?.[0])).toContain("ADMIN_SESSION_SECRET is not set");
  });

  it("stays silent when there is simply no password", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ADMIN_PASSWORD", "");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { isAdminConfigured } = await loadAuth();

    expect(isAdminConfigured()).toBe(false);
    expect(logged).not.toHaveBeenCalled();
  });

  it("rejects the correct password", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ADMIN_PASSWORD", STRONG);
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { passwordMatches } = await loadAuth();

    expect(passwordMatches(STRONG)).toBe(false);
  });

  it("invalidates a session that was issued before the gate closed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Local: password only, so the cookie is signed with the password.
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_ENVIRONMENT", "");
    vi.stubEnv("ADMIN_PASSWORD", STRONG);
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    const local = await loadAuth();
    await local.createSession();
    expect(await local.isSignedIn()).toBe(true);

    // The same cookie, presented to a production deployment with that config.
    vi.stubEnv("VERCEL_ENV", "production");
    const production = await loadAuth();
    expect(await production.isSignedIn()).toBe(false);
  });
});

describe("a valid configuration", () => {
  it("keeps working locally with a password and a separate secret", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_ENVIRONMENT", "");
    vi.stubEnv("ADMIN_PASSWORD", STRONG);
    vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
    const auth = await loadAuth();

    expect(auth.isAdminConfigured()).toBe(true);
    expect(auth.passwordMatches(STRONG)).toBe(true);
    expect(auth.passwordMatches(`${STRONG}x`)).toBe(false);

    expect(await auth.isSignedIn()).toBe(false);
    await auth.createSession();
    expect(await auth.isSignedIn()).toBe(true);
    await auth.destroySession();
    expect(await auth.isSignedIn()).toBe(false);
  });

  it("works in production with a long password and a separate secret", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ADMIN_PASSWORD", STRONG);
    vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const auth = await loadAuth();

    expect(auth.isAdminConfigured()).toBe(true);
    expect(auth.passwordMatches(STRONG)).toBe(true);
    await auth.createSession();
    expect(await auth.isSignedIn()).toBe(true);
    expect(logged).not.toHaveBeenCalled();
  });
});
