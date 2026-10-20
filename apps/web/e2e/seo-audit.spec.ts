import { expect, test, type APIRequestContext } from "@playwright/test";
import { checkStructuredData } from "../test/helpers/structured-data";
import { BG } from "./support/paths";
import { characters } from "./support/titles";

/**
 * Every page a crawler is told about, as a crawler gets it.
 *
 * Walks the sitemap of the build under test and holds each URL to what a
 * search result needs: a 200, one `<h1>`, a title of at most sixty characters
 * and a description of at most 160, neither shared with another page, a
 * canonical naming the URL itself, the full robots directive, a share card
 * with its size, and structured data that passes the offline check
 * (`test/helpers/structured-data.ts`). The unit suite holds the wordings; this
 * holds what the catalog actually produces from them.
 */

const decode = (text: string) =>
  text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const metaContent = (html: string, attribute: string): string | null => {
  const match = new RegExp(`<meta ${attribute} content="([^"]*)"`).exec(html);
  return match ? decode(match[1]!) : null;
};

async function sitemapUrls(request: APIRequestContext): Promise<string[]> {
  const xml = await (await request.get("/sitemap.xml")).text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decode(match[1]!));
}

interface PageReport {
  readonly url: string;
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly problems: string[];
}

async function audit(request: APIRequestContext, url: string): Promise<PageReport> {
  const path = new URL(url).pathname;
  const response = await request.get(path, { maxRedirects: 0 });
  const html = await response.text();
  const problems: string[] = [];
  if (response.status() !== 200) problems.push(`status ${response.status()}`);

  const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "");
  const description = metaContent(html, 'name="description"') ?? "";
  if (!title) problems.push("no <title>");
  if (characters(title) > 60) problems.push(`title of ${characters(title)} characters: ${title}`);
  if (characters(description) > 160)
    problems.push(`description of ${characters(description)} characters: ${description}`);
  if (characters(description) < 50) problems.push(`description too short: ${description}`);

  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) problems.push(`${h1} h1 elements`);

  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  if (canonical !== url) problems.push(`canonical ${canonical}`);

  const robots = [...html.matchAll(/<meta name="robots" content="([^"]+)"/g)].map((m) => m[1]);
  if (robots.length !== 1 || robots[0] !== "index, follow")
    problems.push(`robots ${JSON.stringify(robots)}`);
  if (!/max-image-preview:large/.test(metaContent(html, 'name="googlebot"') ?? ""))
    problems.push("no max-image-preview:large");

  const image = metaContent(html, 'property="og:image"');
  if (!image) problems.push("no og:image");
  else if (/^https?:\/\/[^/]+\/+https?:/.test(image)) problems.push(`nested og:image ${image}`);
  if (metaContent(html, 'property="og:image:width"') !== "1200") problems.push("og:image:width");
  if (!metaContent(html, 'property="og:image:alt"')) problems.push("no og:image:alt");

  const blocks = [
    ...html.matchAll(/<script id="[^"]*" type="application\/ld\+json">([\s\S]*?)<\/script>/g),
  ].map((match) => JSON.parse(match[1]!) as unknown);
  if (blocks.length < 2) problems.push(`${blocks.length} JSON-LD blocks`);
  problems.push(...checkStructuredData(blocks).map((problem) => `JSON-LD: ${problem}`));

  return { url, path, title, description, problems };
}

test.describe("every URL in the sitemap", () => {
  test.describe.configure({ mode: "serial" });

  test("is a page a search result can show whole, told apart from every other", async ({
    request,
  }) => {
    test.setTimeout(600_000);
    const urls = await sitemapUrls(request);
    expect(urls.length).toBeGreaterThan(100);

    const reports: PageReport[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (next < urls.length) {
          const url = urls[next++]!;
          reports.push(await audit(request, url));
        }
      }),
    );

    const failing = reports
      .filter((report) => report.problems.length > 0)
      .map((report) => `${report.path}\n    ${report.problems.join("\n    ")}`);
    expect(failing, failing.join("\n")).toEqual([]);

    const repeated = (key: "title" | "description") => {
      const seen = new Map<string, string[]>();
      for (const report of reports)
        seen.set(report[key], [...(seen.get(report[key]) ?? []), report.path]);
      return [...seen]
        .filter(([, paths]) => paths.length > 1)
        .map(([text, paths]) => `${text}: ${paths.join(", ")}`);
    };
    expect(repeated("title")).toEqual([]);
    expect(repeated("description")).toEqual([]);
  });
});

/*
 * Google reads a canonical from `<head>` alone. Next streams the metadata of a
 * dynamically rendered page after `</head>` unless the user agent is on the
 * `htmlLimitedBots` list (`next.config.ts`), and it did so for Googlebot on a
 * slow `generateMetadata`, intermittently — so every URL is fetched as
 * Googlebot, three times over.
 */
const GOOGLEBOT =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

async function metadataOutsideHead(request: APIRequestContext, url: string): Promise<string[]> {
  const path = new URL(url).pathname;
  const response = await request.get(path, {
    maxRedirects: 0,
    headers: { "user-agent": GOOGLEBOT },
  });
  const html = await response.text();
  const headEnd = html.indexOf("</head>");
  const problems: string[] = [];
  for (const [name, pattern] of [
    ["title", /<title>/],
    ["canonical", /<link rel="canonical"/],
    ["robots", /<meta name="robots"/],
  ] as const) {
    const at = pattern.exec(html)?.index;
    if (at === undefined) problems.push(`no ${name}`);
    else if (headEnd < 0 || at > headEnd) problems.push(`${name} after </head>`);
  }
  return problems.map((problem) => `${path}: ${problem}`);
}

test.describe("the metadata a crawler reads", () => {
  test("is in <head> on every URL in the sitemap, for Googlebot, every time", async ({
    request,
  }) => {
    test.setTimeout(900_000);
    const urls = await sitemapUrls(request);
    expect(urls.length).toBeGreaterThan(100);

    const problems: string[] = [];
    for (let pass = 1; pass <= 3; pass += 1) {
      let next = 0;
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          while (next < urls.length) {
            const url = urls[next++]!;
            for (const problem of await metadataOutsideHead(request, url))
              problems.push(`pass ${pass} ${problem}`);
          }
        }),
      );
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

test.describe("the sitemap", () => {
  test("lists a product's photographs, and a brand's logo where there is one", async ({
    request,
  }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]!);
    const withImages = entries.filter((entry) => entry.includes("<image:loc>"));
    expect(withImages.length).toBeGreaterThan(50);
    for (const entry of withImages) {
      for (const [, image] of entry.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)) {
        expect(image, entry).toMatch(/^https?:\/\//);
        expect(image, entry).not.toMatch(/^https?:\/\/[^/]+\/+https?:/);
        expect(image, entry).not.toContain("placeholder");
      }
    }
    const lavazza = entries.find((entry) => entry.includes(`${BG.brand("lavazza")}</loc>`));
    expect(lavazza).toMatch(/<image:loc>[^<]*\/brand-logos\/lavazza\.svg<\/image:loc>/);
  });

  test("dates nothing by the moment it was generated", async ({ request }) => {
    const before = Date.now();
    const xml = await (await request.get("/sitemap.xml")).text();
    const dates = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => Date.parse(m[1]!));
    expect(dates.length).toBeGreaterThan(100);
    // A real date is a past one; "now" would land inside this request.
    for (const date of dates) expect(date).toBeLessThan(before - 60_000);
  });

  test("is drawn on request and kept by the CDN for an hour, ten minutes stale at most", async ({
    request,
  }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-type"]).toBe("application/xml");
    // What a browser or a crawler is told: ask again every time.
    expect(headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    // What the CDN is told (`lib/seo/sitemap-cache.ts`); `next start` has none to obey it.
    expect(headers["cdn-cache-control"]).toBe(
      "public, s-maxage=3600, stale-while-revalidate=600, stale-if-error=86400",
    );
    // Not a prerender: there is no build-time copy for the server to hand out.
    expect(headers["x-nextjs-cache"]).toBeUndefined();
    // A draw, or one at most a minute old; the kept copy only while the database is down.
    expect(["drawn", "recent"]).toContain(headers["x-sitemap-copy"]);

    // The document Next.js writes for a sitemap, every address once and on one origin.
    const xml = await response.text();
    expect(xml).toMatch(
      /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1" xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml">\n/,
    );
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!);
    expect(new Set(locs).size).toBe(locs.length);
    const origin = new URL(locs[0]!).origin;
    // The shop's tag, named after the site (tags a Vercel team's projects share),
    // which its revalidation expires, so it reaches the CDN's copy.
    expect(headers["vercel-cache-tag"]).toBe(`${new URL(origin).host}:sitemap`);
    for (const [, url] of xml.matchAll(/(?:<loc>|hreflang="[^"]+" href=")([^<"]+)/g)) {
      expect(new URL(url!).origin, url).toBe(origin);
    }
  });

  test("is one address: a query string is sent to it, and odd request headers cost no draw", async ({
    request,
  }, testInfo) => {
    // Once: the phone run's own revalidation below would make this one's draws.
    test.skip(testInfo.project.name !== "desktop", "one draw to share at a time");
    // Each query string would be a CDN entry, and a draw, of its own.
    for (const query of ["?x=1", "?utm_source=feed&utm_medium=rss", "?"]) {
      const response = await request.get(`/sitemap.xml${query}`, { maxRedirects: 0 });
      if (query === "?") {
        expect(response.status(), query).toBe(200);
        continue;
      }
      expect(response.status(), query).toBe(308);
      expect(response.headers()["location"], query).toBe("/sitemap.xml");
      expect(await response.body(), query).toHaveLength(0);
    }

    // Next.js lists `rsc` and `next-router-*` in every app route's `Vary`, and a
    // route cannot take that back, so the CDN keeps a copy per value. Whatever
    // comes in under them is handed the draw just made, not a new one. Declared
    // changed first (as `playwright.config.ts` gives the server the secret), so
    // the plain request draws and the minute starts now.
    const declared = await request.post("/api/revalidate", {
      headers: {
        authorization: "Bearer e2e-only-revalidate-secret-not-a-real-one-0123456789",
      },
      data: { paths: ["/bg"] },
    });
    expect(declared.status()).toBe(200);
    const plain = await request.get("/sitemap.xml");
    // Drawn now, or by the phone run a moment before: either way, after the change.
    expect(["drawn", "recent"]).toContain(plain.headers()["x-sitemap-copy"]);
    const xml = await plain.text();
    for (const headers of [
      { rsc: "1" },
      { "next-router-state-tree": encodeURIComponent(JSON.stringify(["", { x: Math.random() }])) },
      { "next-router-prefetch": "1", "next-router-segment-prefetch": "/_tree" },
    ]) {
      const odd = await request.get("/sitemap.xml", { headers });
      expect(odd.status(), JSON.stringify(headers)).toBe(200);
      expect(odd.headers()["x-sitemap-copy"], JSON.stringify(headers)).toBe("recent");
      expect(await odd.text()).toBe(xml);
    }
  });
});

test.describe("share cards", () => {
  const PAGES = [
    BG.capsules,
    BG.nespresso,
    BG.brand("lavazza"),
    BG.lavazzaCapsules,
    BG.decaf,
    "/bg/blog/vidove-kapsuli-za-kafe",
  ];

  for (const path of PAGES) {
    test(`${path} shares its own 1200 × 630 card`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      const image = new URL(metaContent(html, 'property="og:image"')!);
      expect(image.pathname).toMatch(
        new RegExp(`^${path}/opengraph-image-[a-z0-9]+/card-[0-9a-f]{12}$`),
      );
      expect(metaContent(html, 'name="twitter:image"')).toBe(image.href);
      const response = await request.get(image.pathname + image.search);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      const png = await response.body();
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    });
  }

  test("a card under an id its page no longer names is a 404", async ({ request }) => {
    // The id is a hash of what the card shows; one from before a price change
    // is not served the new card under the old address, or the old one.
    const html = await (await request.get(BG.capsules)).text();
    const image = new URL(metaContent(html, 'property="og:image"')!);
    const stale = image.pathname.replace(/card-[0-9a-f]{12}$/, "card-000000000000");
    expect(stale).not.toBe(image.pathname);
    expect((await request.get(stale)).status()).toBe(404);
  });

  test("an article's structured data names the picture its share card is", async ({ request }) => {
    const html = await (await request.get("/bg/blog/vidove-kapsuli-za-kafe")).text();
    const image = metaContent(html, 'property="og:image"')!;
    const article = [
      ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([^<]+)<\/script>/g),
    ]
      .flatMap((match) => [JSON.parse(match[1]!)].flat() as Array<Record<string, unknown>>)
      .flatMap((node) => (Array.isArray(node["@graph"]) ? node["@graph"] : [node]))
      .find((node) => node["@type"] === "Article" || node["@type"] === "BlogPosting");
    expect(article, "Article JSON-LD").toBeTruthy();
    expect(article!.image).toEqual([image]);
  });

  test("a card for something that does not exist is a 404", async ({ request }) => {
    const html = await (await request.get(BG.capsules)).text();
    const image = new URL(metaContent(html, 'property="og:image"')!);
    const dead = image.pathname.replace(BG.capsules, "/bg/no-such-product-or-category");
    expect((await request.get(dead)).status()).toBe(404);
  });
});

test.describe("installing and verifying", () => {
  test("the manifest shows a phone and a desktop screenshot that exist", async ({ request }) => {
    const manifest = (await (await request.get("/manifest.webmanifest")).json()) as {
      screenshots?: Array<{ src: string; sizes: string; type: string; form_factor?: string }>;
    };
    const shots = manifest.screenshots ?? [];
    expect(shots.map((shot) => shot.form_factor).sort()).toEqual(["narrow", "narrow", "wide"]);
    for (const shot of shots) {
      const response = await request.get(shot.src);
      expect(response.status(), shot.src).toBe(200);
      expect(response.headers()["content-type"], shot.src).toBe(shot.type);
    }
  });

  test("an iPhone home-screen shortcut is named and coloured", async ({ request }) => {
    const html = await (await request.get(BG.home)).text();
    expect(metaContent(html, 'name="apple-mobile-web-app-title"')).toBe("Buy a Coffee");
    expect(metaContent(html, 'name="apple-mobile-web-app-status-bar-style"')).toBe("black");
  });

  test("the IndexNow key file serves the configured key, and nothing else", async ({ request }) => {
    const key = process.env.E2E_INDEXNOW_KEY ?? "e2e-only-indexnow-key-0123";
    const response = await request.get(`/${key}.txt`);
    expect(response.status()).toBe(200);
    expect((await response.text()).trim()).toBe(key);
    expect((await request.get("/ffffffff-not-the-key.txt")).status()).toBe(404);
    // The folder the file is rewritten to is not an address of its own.
    expect((await request.get(`/indexnow/${key}`, { maxRedirects: 0 })).status()).toBe(404);
  });
});
