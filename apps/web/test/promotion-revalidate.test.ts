import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * What a saved promotion refreshes (`lib/promotions/revalidate.ts`), held to
 * the app's own folders: every page under the shop's layout is either
 * regenerated on demand or left to its own clock, and only a route that
 * prebuilds its whole list (`dynamicParams = false`) may be left — a
 * regenerated one of those is drawn as a 404 and cached.
 */

const revalidated = vi.hoisted(() => [] as Array<[string, string | undefined]>);
const tags = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (route: string, type?: string) => revalidated.push([route, type]),
  revalidateTag: (tag: string, profile: unknown) => tags.push([tag, profile]),
}));

const { SELF_TIMED_ROUTES, SHOP_PAGE_ROUTES, revalidateShop } =
  await import("@/lib/promotions/revalidate");

const SHOP = path.resolve(import.meta.dirname, "../src/app/(site)/[lang]");

/** Every folder under the shop's layout holding a `page.tsx`, as a route below it. */
function pageRoutes(dir = SHOP, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `_components`, `_lib`: private folders, never routes.
      if (!entry.startsWith("_")) found.push(...pageRoutes(full, `${prefix}/${entry}`));
    } else if (entry === "page.tsx") {
      found.push(prefix);
    }
  }
  return found;
}

const pageFile = (route: string) => path.join(SHOP, route, "page.tsx");
const prebuildsItsList = (route: string) =>
  /export const dynamicParams = false/.test(readFileSync(pageFile(route), "utf8"));

describe("what a saved promotion refreshes", () => {
  it("names every page under the shop's layout, once", () => {
    const listed = [...SHOP_PAGE_ROUTES, ...SELF_TIMED_ROUTES];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(pageRoutes().sort());
  });

  it("leaves out exactly the routes that prebuild their whole list", () => {
    for (const route of SELF_TIMED_ROUTES) expect(prebuildsItsList(route), route).toBe(true);
    for (const route of SHOP_PAGE_ROUTES) expect(prebuildsItsList(route), route).toBe(false);
  });

  it("refreshes each of them as a page, never the layout, and the sitemap and llms.txt", () => {
    revalidated.length = 0;
    tags.length = 0;
    revalidateShop();
    expect(revalidated).toContainEqual(["/(site)/[lang]", "page"]);
    expect(revalidated).toContainEqual(["/(site)/[lang]/[slug]", "page"]);
    // `/llms.txt` by its path; the sitemap by the shop's tag, at once (`lib/seo/sitemap-cache.ts`).
    expect(revalidated).toContainEqual(["/llms.txt", undefined]);
    expect(tags).toEqual([["sitemap", { expire: 0 }]]);
    expect(revalidated.some(([, type]) => type === "layout")).toBe(false);
    expect(revalidated).toHaveLength(SHOP_PAGE_ROUTES.length + 1);
  });
});
