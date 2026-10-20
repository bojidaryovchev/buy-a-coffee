import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { MetadataRoute } from "next";
import { resolveSitemap } from "next/dist/build/webpack/loaders/metadata/resolve-route-data";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as SitemapCopies from "@/lib/seo/sitemap-copy";

/**
 * `/sitemap.xml` as a route: drawn on request, cached by the CDN for an hour
 * and no longer, and a day on an error, purged by the shop's own tag; the
 * kept copy while the database is down; one address whatever the query
 * string. Which copy is handed out is `sitemap-copy.test.ts`; here it is a
 * stand-in.
 */

const entries: MetadataRoute.Sitemap = [
  {
    url: "https://buy-a-coffee.com/bg",
    lastModified: new Date("2026-10-20T08:00:00.000Z"),
    changeFrequency: "daily",
    priority: 1,
    alternates: {
      languages: { bg: "https://buy-a-coffee.com/bg", "x-default": "https://buy-a-coffee.com/bg" },
    },
  },
  {
    url: "https://buy-a-coffee.com/bg/lavazza-crema",
    lastModified: new Date("2026-10-19T12:30:00.000Z"),
    changeFrequency: "weekly",
    priority: 0.9,
    alternates: { languages: { bg: "https://buy-a-coffee.com/bg/lavazza-crema" } },
    images: ["https://images.example/catalog/ab/cd/1.jpg"],
  },
  { url: "https://buy-a-coffee.com/bg/kontakti", changeFrequency: "monthly", priority: 0.5 },
];
const XML = resolveSitemap(entries);

const copies = vi.hoisted(() => ({ currentSitemap: vi.fn() }));
vi.mock("@/lib/seo/sitemap-copy", async (importOriginal) => ({
  ...(await importOriginal<typeof SitemapCopies>()),
  currentSitemap: copies.currentSitemap,
}));
vi.mock("@/lib/seo/sitemap", () => ({ sitemapEntries: async () => [] }));
// Outside a request `connection()` throws; inside one it only marks the route dynamic.
vi.mock("next/server", () => ({ connection: async () => undefined }));

const route = await import("@/app/sitemap.xml/route");
const { SITEMAP_ORIGIN, SITEMAP_TAG } = await import("@/lib/seo/sitemap-cache");
const { SitemapUnavailable } = await import("@/lib/seo/sitemap-copy");
const { absoluteUrl } = await import("@/config/site");

const APP = path.resolve(import.meta.dirname, "../src/app");
const get = (query = "") => route.GET(new Request(`https://buy-a-coffee.com/sitemap.xml${query}`));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("/sitemap.xml", () => {
  it("is never prerendered, and nothing makes its cache reads no-store", () => {
    // A prerendered `/sitemap.xml` is deployed as a static file and never refreshed;
    // `force-dynamic` would make `unstable_cache` skip the kept copy.
    const source = readFileSync(path.join(APP, "sitemap.xml", "route.ts"), "utf8");
    expect(source).toMatch(/await connection\(\)/);
    expect(Object.keys(route)).toEqual(["GET"]);
  });

  it("hands out the drawn sitemap with the CDN's hour, a day on an error, and the shop's tag", async () => {
    copies.currentSitemap.mockResolvedValue({ xml: XML, drawnAt: 1, source: "drawn" });
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(XML);
    expect(Object.fromEntries(response.headers)).toEqual({
      "content-type": "application/xml",
      "cache-control": "public, max-age=0, must-revalidate",
      "cdn-cache-control":
        "public, s-maxage=3600, stale-while-revalidate=600, stale-if-error=86400",
      "vercel-cache-tag": SITEMAP_TAG,
      "x-sitemap-copy": "drawn",
    });
  });

  it("names its tag after the site, for tags a Vercel team's projects share", () => {
    const site = new URL(absoluteUrl("/"));
    expect(SITEMAP_ORIGIN).toBe(site.origin);
    expect(SITEMAP_TAG).toBe(`${site.host}:sitemap`);
    expect(SITEMAP_TAG).not.toContain(",");
  });

  it("says when it hands out a draw at most a minute old", async () => {
    copies.currentSitemap.mockResolvedValue({ xml: XML, drawnAt: 1, source: "recent" });
    const response = await get();
    expect(response.headers.get("x-sitemap-copy")).toBe("recent");
    expect(response.headers.get("cdn-cache-control")).toMatch(/^public, s-maxage=3600,/);
  });

  it("hands out the kept copy while the database is down, for a minute at the CDN, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    copies.currentSitemap.mockResolvedValue({
      xml: XML,
      drawnAt: Date.parse("2026-10-20T09:00:00.000Z"),
      source: "kept",
      failure: "connect ECONNREFUSED 127.0.0.1:5433",
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(XML);
    expect(response.headers.get("x-sitemap-copy")).toBe("kept");
    expect(response.headers.get("cdn-cache-control")).toBe(
      "public, s-maxage=60, stale-if-error=86400",
    );
    expect(response.headers.get("vercel-cache-tag")).toBe(SITEMAP_TAG);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('"msg":"sitemap.draw_failed"'));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("2026-10-20T09:00:00.000Z"));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('"keptAgeHours":'));
  });

  it("answers 503, and says why loudly, when no copy of ours may stand in", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    for (const [kept, drawnAt] of [
      ["none", null],
      ["foreign", eightDaysAgo],
      ["too_old", eightDaysAgo],
    ] as const) {
      logged.mockClear();
      copies.currentSitemap.mockRejectedValue(
        new SitemapUnavailable("database down", kept, drawnAt),
      );
      const response = await get();
      expect(response.status, kept).toBe(503);
      expect(response.headers.get("cache-control"), kept).toBe("no-store");
      expect(response.headers.get("retry-after"), kept).toBe("60");
      const line = JSON.parse(String(logged.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(line).toMatchObject({
        level: "error",
        msg: "sitemap.unavailable",
        kept,
        error: "database down",
      });
      if (drawnAt === null) expect(line.keptAgeHours).toBeNull();
      else expect(line.keptAgeHours).toBeCloseTo(192, 0);
    }
  });

  it("lets anything else fail as it would", async () => {
    copies.currentSitemap.mockRejectedValue(new TypeError("a bug"));
    await expect(get()).rejects.toThrow("a bug");
  });

  it("sends any query string to the one address, without a draw", async () => {
    for (const query of ["?x=1", "?utm_source=feed", "?sitemap.xml"]) {
      const response = await get(query);
      expect(response.status, query).toBe(308);
      expect(response.headers.get("location"), query).toBe("/sitemap.xml");
      expect(await response.text(), query).toBe("");
    }
    expect(copies.currentSitemap).not.toHaveBeenCalled();
  });

  it("serves Next.js's own `_rsc` query, which a redirect would turn into a loop", async () => {
    // Next.js answers a request with an `rsc` header with a 307 to `?_rsc=<hash>`.
    copies.currentSitemap.mockResolvedValue({ xml: XML, drawnAt: 1, source: "recent" });
    const response = await get("?_rsc=1a2b3");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(XML);
    // Anything beside it is still sent to the one address.
    expect((await get("?_rsc=1a2b3&x=1")).status).toBe(308);
  });

  it("has no metadata file beside it to take its place", () => {
    // `app/sitemap.ts` would be prerendered and deployed as a static file again.
    for (const name of ["sitemap.ts", "sitemap.tsx", "sitemap.js", "sitemap.xml"]) {
      const file = path.join(APP, name);
      expect(existsSync(file) && !existsSync(path.join(file, "route.ts")), name).toBe(false);
    }
  });
});
