import { existsSync } from "node:fs";
import path from "node:path";
import type { MetadataRoute } from "next";
import { resolveSitemap } from "next/dist/build/webpack/loaders/metadata/resolve-route-data";
import { describe, expect, it, vi } from "vitest";

/**
 * `/sitemap.xml` as a route: drawn on request, cached by the CDN for an hour
 * and no longer, purged by the tag the shop's revalidation expires, and the
 * same document Next.js wrote for the metadata file it replaced.
 *
 * The entries are a stand-in; `layout-frame.test.ts` holds what they are.
 */

const entries = vi.hoisted((): MetadataRoute.Sitemap => [
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
]);
vi.mock("@/lib/seo/sitemap", () => ({ sitemapEntries: async () => entries }));

const route = await import("@/app/sitemap.xml/route");
const { SITEMAP_CACHE_TAG, SITEMAP_PATH } = await import("@/lib/seo/sitemap-cache");

const APP = path.resolve(import.meta.dirname, "../src/app");

describe("/sitemap.xml", () => {
  it("is drawn on every request, never prerendered", () => {
    // A prerendered `/sitemap.xml` is deployed as a static file and never refreshed.
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("is Next.js's own sitemap XML of the entries, byte for byte", async () => {
    const response = await route.GET();
    expect(response.status).toBe(200);
    const xml = await response.text();
    expect(xml).toBe(resolveSitemap(entries));
    expect(xml).toContain("<lastmod>2026-10-19T12:30:00.000Z</lastmod>");
    expect(xml).toContain("<image:loc>https://images.example/catalog/ab/cd/1.jpg</image:loc>");
  });

  it("tells browsers to ask every time, and the CDN to keep it an hour, then ten minutes stale", async () => {
    const { headers } = await route.GET();
    expect(headers.get("content-type")).toBe("application/xml");
    expect(headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(headers.get("cdn-cache-control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=600",
    );
  });

  it('carries the tag revalidatePath("/sitemap.xml") expires', async () => {
    // `revalidatePath(p)` expires `_N_T_` + p (next/dist/server/web/spec-extension/revalidate.js),
    // the tag the prerendered sitemap carried in its `x-next-cache-tags`.
    expect(SITEMAP_PATH).toBe("/sitemap.xml");
    expect(SITEMAP_CACHE_TAG).toBe("_N_T_/sitemap.xml");
    expect((await route.GET()).headers.get("vercel-cache-tag")).toBe(SITEMAP_CACHE_TAG);
  });

  it("has no metadata file beside it to take its place", () => {
    // `app/sitemap.ts` would be prerendered and deployed as a static file again.
    for (const name of ["sitemap.ts", "sitemap.tsx", "sitemap.js", "sitemap.xml"]) {
      const file = path.join(APP, name);
      expect(existsSync(file) && !existsSync(path.join(file, "route.ts")), name).toBe(false);
    }
  });
});
