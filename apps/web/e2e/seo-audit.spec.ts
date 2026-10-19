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
