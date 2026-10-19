import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";

/*
 * robots.txt (`app/robots.ts`): what a crawler may fetch on production, and
 * that a preview may fetch nothing.
 */

afterEach(() => vi.unstubAllEnvs());

const disallowed = () => {
  const rules = robots().rules;
  const [rule] = Array.isArray(rules) ? rules : [rules];
  return ([] as string[]).concat(rule?.disallow ?? []);
};

describe("robots.txt on production", () => {
  it("keeps search, filters, sorts and answered wizard states out", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const rules = disallowed();
    for (const path of [
      "/bg/tarsene",
      "/bg/izbor-na-kafe/rezultat",
      "/*?brand=",
      "/*?sort=",
      "/admin",
    ]) {
      expect(rules).toContain(path);
    }
  });

  /* Page two links the products page one has no room for. It is `noindex,
     follow`; disallowed, those products were linked from nothing a crawler
     could fetch. */
  it("lets a crawler follow a listing's pages", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(disallowed().some((rule) => rule.includes("page="))).toBe(false);
  });

  it("names the sitemap", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(robots().sitemap).toMatch(/^https?:\/\/[^/]+\/sitemap\.xml$/);
  });
});

describe("robots.txt anywhere else", () => {
  it("disallows everything on a preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(robots().rules).toEqual([{ userAgent: "*", disallow: "/" }]);
  });
});
