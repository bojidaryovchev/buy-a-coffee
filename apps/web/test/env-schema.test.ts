import { afterEach, describe, expect, it, vi } from "vitest";
import { project, retired, vars } from "../env.schema.mjs";
import { assertManifestValid, createReport, evaluateVars, resolve } from "../scripts/env-lib.mjs";

/**
 * The production requirements of the manifest, exercised through the same
 * `evaluateVars` that `env:check` runs, so the test cannot pass while the
 * command disagrees.
 */

type Level = "error" | "warning" | "note";

const spec = (name: string) => {
  const found = vars.find((v: { name: string }) => v.name === name);
  if (!found) throw new Error(`${name} is not in the manifest`);
  return found;
};

const NAMES: string[] = vars.map((v: { name: string }) => v.name);

/** Run the check with exactly these variables set and nothing else. */
const check = (env: Record<string, string>, ctx: { isProductionish: boolean }) => {
  for (const name of NAMES) vi.stubEnv(name, "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return evaluateVars(vars, { ...ctx, onServerless: ctx.isProductionish, report: createReport() });
};

const titles = (report: ReturnType<typeof createReport>, level: Level): string =>
  report.items[level].map((i: { title: string }) => i.title).join("\n");

afterEach(() => vi.unstubAllEnvs());

const DB = "postgres://u:p@db.example.com/x";
const GOOD: Record<string, string> = {
  DATABASE_URL: DB,
  RATE_LIMIT_SALT: "a".repeat(32),
  NEXT_PUBLIC_IMAGE_BASE_URL: "https://cdn.example.com",
  ADMIN_PASSWORD: "correct horse battery",
  ADMIN_SESSION_SECRET: "b".repeat(32),
  CRON_SECRET: "c".repeat(32),
};

const without = (name: string) =>
  Object.fromEntries(Object.entries(GOOD).filter(([k]) => k !== name));

describe("manifest", () => {
  it("is internally valid", () => {
    expect(() => assertManifestValid(vars, retired)).not.toThrow();
  });

  it("commits the production site URL for production only", () => {
    const site = spec("NEXT_PUBLIC_SITE_URL");
    expect(site.kind).toBe("config");
    expect(site.value).toBe("https://buy-a-coffee.com");
    expect(site.targets).toEqual(["production"]);
    expect(resolve(site, "deploy")).toEqual({
      value: "https://buy-a-coffee.com",
      source: "manifest",
    });
  });

  it("commits no secret value", () => {
    expect(project.vercelName).toBeTruthy();
    for (const v of vars) if (v.kind === "secret") expect(v.value).toBeUndefined();
  });
});

describe("production requirements", () => {
  it("accepts a complete production configuration", () => {
    expect(check(GOOD, { isProductionish: true }).counts.errors).toBe(0);
  });

  it.each(["ADMIN_SESSION_SECRET", "NEXT_PUBLIC_IMAGE_BASE_URL", "CRON_SECRET"])(
    "requires %s in production",
    (name) => {
      const report = check(without(name), { isProductionish: true });
      expect(titles(report, "error")).toContain(`${name} is not set`);
    },
  );

  it("does not require them locally", () => {
    const report = check({ DATABASE_URL: DB }, { isProductionish: false });
    for (const name of ["ADMIN_SESSION_SECRET", "NEXT_PUBLIC_IMAGE_BASE_URL", "CRON_SECRET"])
      expect(titles(report, "error")).not.toContain(`${name} is not set`);
  });

  it("keeps the helpful local message for a missing image host", () => {
    const report = check({ DATABASE_URL: DB }, { isProductionish: false });
    const note = (report.items.note as { title: string; message?: string }[]).find((i) =>
      i.title.startsWith("NEXT_PUBLIC_IMAGE_BASE_URL"),
    );
    expect(note?.message).toContain("STORAGE_LOCAL_DIR");
  });

  it("makes a short ADMIN_PASSWORD an error in production and a warning locally", () => {
    const env = { ...GOOD, ADMIN_PASSWORD: "short" };
    expect(titles(check(env, { isProductionish: true }), "error")).toContain("ADMIN_PASSWORD");
    const local = check(env, { isProductionish: false });
    expect(titles(local, "error")).not.toContain("ADMIN_PASSWORD");
    expect(titles(local, "warning")).toContain("ADMIN_PASSWORD");
  });

  it("requires CRON_SECRET to be at least 32 characters", () => {
    const short = check({ ...GOOD, CRON_SECRET: "c".repeat(31) }, { isProductionish: true });
    expect(titles(short, "error")).toContain("CRON_SECRET");
    const exact = check({ ...GOOD, CRON_SECRET: "c".repeat(32) }, { isProductionish: true });
    expect(titles(exact, "error")).not.toContain("CRON_SECRET");
  });

  it("scopes CRON_SECRET to production as a secret", () => {
    const cron = spec("CRON_SECRET");
    expect(cron.kind).toBe("secret");
    expect(cron.targets).toEqual(["production"]);
    expect(cron.required).toBe("production");
  });
});
