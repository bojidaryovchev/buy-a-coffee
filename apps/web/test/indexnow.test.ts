import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/indexnow/[key]/route";
import { sitemapLocations } from "../scripts/indexnow-submit";

/*
 * The storefront's half of IndexNow: the key file at `/<key>.txt` (rewritten
 * to `app/indexnow/[key]` by `next.config.ts`) and the sitemap reading of the
 * one-off submission script. The submission itself is tested in
 * `packages/shared/test/indexnow.test.ts`; nothing here sends a request.
 */

const KEY = "0123456789abcdef0123456789abcdef";
const ask = (key: string) =>
  GET(new Request(`https://buy-a-coffee.com/${key}.txt`), { params: Promise.resolve({ key }) });

afterEach(() => vi.unstubAllEnvs());

describe("the key file", () => {
  it("serves the configured key as plain text, kept out of results", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    const response = await ask(KEY);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(KEY);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("is a 404 under any other name", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    expect((await ask("ffffffffffffffffffffffffffffffff")).status).toBe(404);
  });

  it("is a 404 while no key is configured, or a malformed one", async () => {
    vi.stubEnv("INDEXNOW_KEY", "");
    expect((await ask(KEY)).status).toBe(404);
    vi.stubEnv("INDEXNOW_KEY", "short");
    expect((await ask("short")).status).toBe(404);
  });
});

describe("reading the sitemap to submit", () => {
  it("lists every <loc> once, decoded", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://buy-a-coffee.com/bg</loc><xhtml:link rel="alternate" hreflang="bg" href="https://buy-a-coffee.com/bg"/></url>
<url><loc>https://buy-a-coffee.com/bg/tarsene?q=a&amp;b=c</loc></url>
<url><loc> https://buy-a-coffee.com/bg </loc></url>
</urlset>`;
    expect(sitemapLocations(xml)).toEqual([
      "https://buy-a-coffee.com/bg",
      "https://buy-a-coffee.com/bg/tarsene?q=a&b=c",
    ]);
  });
});
