import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BG, PRODUCT_LINK } from "./support/paths";

/**
 * Locales, URLs and the redirects from the shop's pre-locale addresses, as a
 * crawler meets them: status codes, `Location` headers, `<head>` tags.
 */

/** A GET that does not follow redirects. */
const raw = (request: APIRequestContext, path: string, headers: Record<string, string> = {}) =>
  request.get(path, { maxRedirects: 0, headers });

const locationOf = (response: Awaited<ReturnType<APIRequestContext["get"]>>) => {
  const value = response.headers()["location"];
  if (!value) return null;
  const url = new URL(value, "http://x");
  return url.pathname + url.search;
};

test.describe("the bare /", () => {
  test("resolves to Bulgarian, temporarily, by Accept-Language and nothing else", async ({
    request,
  }) => {
    for (const language of ["bg-BG,bg;q=0.9", "en-GB,en;q=0.8", "de-DE"]) {
      const response = await raw(request, "/", { "accept-language": language });
      expect(response.status(), language).toBe(307);
      expect(locationOf(response)).toBe(BG.home);
      expect(response.headers()["vary"]).toMatch(/Accept-Language/i);
      // The Cookies page promises the shop sets none; the language is no exception.
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
  });
});

test.describe("the pre-locale URLs", () => {
  const permanent = async (request: APIRequestContext, from: string, to: string) => {
    const response = await raw(request, from);
    expect(response.status(), from).toBe(308);
    expect(locationOf(response), from).toBe(to);
  };

  test("every static route answers 308 to its Bulgarian equivalent", async ({ request }) => {
    const table: ReadonlyArray<readonly [string, string]> = [
      ["/categories", BG.categories],
      ["/brands", BG.brands],
      ["/search", BG.search],
      ["/promotions", BG.promotions],
      ["/vending", BG.vending],
      ["/consumables", BG.consumables],
      ["/delivery", BG.delivery],
      ["/contact", BG.contact],
      ["/privacy", BG.privacy],
      ["/terms", BG.terms],
      ["/cookies", BG.cookies],
      ["/journal", BG.journal],
      ["/wizard", BG.wizard],
      ["/wizard/result", BG.wizardResult],
      ["/wizard/machines", BG.machines],
      ["/wizard/machines/krups", BG.machineBrand("krups")],
      ["/newsletter/unsubscribe", BG.unsubscribe],
    ];
    for (const [from, to] of table) await permanent(request, from, to);
  });

  test("an old category slug lands on its landing slug in one hop", async ({ request }) => {
    await permanent(request, "/categories/kapsuli", BG.capsules);
    await permanent(request, "/categories/nespresso", BG.nespresso);
    await permanent(request, "/categories/kafe-na-zarna", "/bg/kafe-na-zarna");
  });

  test("filters, sorting and search terms travel with the redirect", async ({ request }) => {
    await permanent(
      request,
      "/categories/kapsuli?brand=lavazza&sort=price-per-cup",
      `${BG.capsules}?brand=lavazza&sort=price-per-cup`,
    );
    await permanent(request, "/brands/lavazza?page=2", `${BG.brand("lavazza")}?page=2`);
    const term = encodeURIComponent("лаваца");
    await permanent(request, `/search?q=${term}`, `${BG.search}?q=${term}`);
    await permanent(
      request,
      "/wizard/result?brew=capsule&system=dolce-gusto",
      `${BG.wizardResult}?brew=capsule&system=dolce-gusto`,
    );
    await permanent(request, "/newsletter/unsubscribe?token=abc", `${BG.unsubscribe}?token=abc`);
  });

  test("an old product, brand and article URL lands on the page", async ({ page, request }) => {
    await page.goto(BG.capsules);
    const product = await page.locator(PRODUCT_LINK).first().getAttribute("href");
    expect(product).toMatch(/^\/bg\/[a-z0-9-]+$/);
    const slug = product!.slice("/bg/".length);
    await permanent(request, `/products/${slug}`, product!);

    await permanent(request, "/brands/lavazza", BG.brand("lavazza"));

    await page.goto(BG.journal);
    const article = await page.locator('main a[href^="/bg/blog/"]').first().getAttribute("href");
    await permanent(request, `/journal/${article!.slice("/bg/blog/".length)}`, article!);

    // And followed through, the old product URL is the product page.
    await page.goto(`/products/${slug}`);
    await expect(page).toHaveURL(new RegExp(`${product}$`));
    await expect(page.locator("#order")).toBeAttached();
  });

  test("a category's stored slug redirects to its landing slug", async ({ request }) => {
    await permanent(request, "/bg/kapsuli", BG.capsules);
    await permanent(request, "/bg/kapsuli?sort=price-asc", `${BG.capsules}?sort=price-asc`);
  });

  test("leaves the admin, the API and the files where they are", async ({ request }) => {
    for (const path of ["/sitemap.xml", "/robots.txt", "/manifest.webmanifest"]) {
      expect((await raw(request, path)).status(), path).toBe(200);
    }
    const admin = await raw(request, "/admin/vhod");
    expect([200, 404]).toContain(admin.status());
    expect(admin.headers()["location"]).toBeUndefined();
    expect((await raw(request, "/api/search/suggest?q=la")).status()).toBe(200);
  });
});

test.describe("locales", () => {
  test("English is switched off: it serves nothing", async ({ request }) => {
    for (const path of ["/en", "/en/brands", "/en/coffee-capsules"]) {
      expect((await raw(request, path)).status(), path).toBe(404);
    }
  });

  test("a path that names no locale is a real 404 with the way home", async ({ page }) => {
    const response = await page.goto("/nope");
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "bg");
    await expect(page.getByRole("link", { name: /началната страница/i })).toHaveAttribute(
      "href",
      BG.home,
    );
  });

  test("a slug nobody sells is a 404 inside the shop's frame", async ({ page }) => {
    const response = await page.goto("/bg/no-such-product-or-category");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Тази страница я няма" }),
    ).toBeVisible();
    await expect(page.locator("header").first()).toBeVisible();
  });

  /*
   * A plain request, as a crawler or a browser without JavaScript makes it:
   * no script runs, so what is asserted is the HTML the server sent. A page's
   * own `notFound()` would pass a browser test and fail here — Next draws that
   * one on the client — which is why the proxy sends dead links to the 404
   * the server renders.
   */
  test("a dead link is a 404 whose page is in the HTML as sent", async ({ request }) => {
    const dead = [
      "/bg/no-such-product-or-category",
      "/bg/marki/no-such-brand",
      "/bg/blog/no-such-article",
      "/bg/za-kafemashina/no-such-machine",
      "/bg/a/b/c",
      "/nope",
    ];
    for (const path of dead) {
      const response = await raw(request, path);
      expect(response.status(), path).toBe(404);

      const html = await response.text();
      expect(html, path).toMatch(/<html[^>]*\slang="bg"/);
      const body = html.slice(html.indexOf("<body"));
      // The heading, as markup in the body, not as data in a script.
      expect(body, path).toMatch(/<h1[^>]*>Тази страница я няма<\/h1>/);
      // Inside the shop's frame: its header, its navigation, its footer.
      expect(body, path).toContain("<header");
      expect(body, path).toContain("<footer");
      expect(body, path).toContain(`href="${BG.machines}"`);
      // And a search that needs no script.
      expect(body, path).toMatch(new RegExp(`<form[^>]*action="${BG.search}"`));
    }
  });

  test("no language switcher is drawn while one locale ships", async ({ page }) => {
    await page.goto(BG.home);
    await expect(page.locator("a[hreflang]")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Език" })).toHaveCount(0);
  });
});

const SHOP = "Buy a Coffee";
/** The storefront's default `<title>`: the shop's name and its tagline. */
const DEFAULT_TITLE = new RegExp(`^${SHOP} — `);
const ARTICLE = "/bg/blog/kolko-struva-edna-chasha-kafe";

/** A meta tag's content, or `null` at once when the page has no such tag. */
const meta = (page: Page, selector: string): Promise<string | null> =>
  page.locator(`meta[${selector}]`).evaluateAll((tags) => tags[0]?.getAttribute("content") ?? null);

const canonicalOf = (page: Page) => page.locator('link[rel="canonical"]').getAttribute("href");

/**
 * A page shares as itself: under its own address, title and description.
 *
 * WHY THIS IS ASSERTED PAGE BY PAGE. Next hands the layout's whole `openGraph`
 * to a page that declares none, so a page that forgets `shareMetadata`
 * (`lib/seo/share.ts`) does not fail anywhere: it quietly shares as whatever
 * the layout describes. That was once the home page, for most of the shop. A
 * page that forgets today sends no `og:url`, and its `og:title` is its whole
 * `<title>`, shop's name included; both are caught here.
 */
async function expectSharesAsItself(page: Page, canonical: string): Promise<void> {
  // The same address the canonical names, to the character.
  expect(await meta(page, 'property="og:url"'), "og:url").toBe(canonical);

  const title = await meta(page, 'property="og:title"');
  expect(title, "og:title").toBeTruthy();
  expect(title, "og:title").not.toMatch(DEFAULT_TITLE);
  // The page's own words: `og:site_name` carries the shop's name.
  expect(title, "og:title").not.toContain(`| ${SHOP}`);
  expect(await meta(page, 'property="og:site_name"')).toBe(SHOP);
  // And they are the words its `<title>` is made of.
  expect(await page.title(), "<title>").toBe(`${title} | ${SHOP}`);

  const description = await meta(page, 'name="description"');
  expect(description, "description").toBeTruthy();
  expect(await meta(page, 'property="og:description"'), "og:description").toBe(description);

  expect(await meta(page, 'property="og:locale"')).toBe("bg_BG");
  const image = await meta(page, 'property="og:image"');
  expect(new URL(image!).origin, "og:image").toBe(new URL(canonical).origin);
  expect(new URL(image!).pathname, "og:image").toMatch(/^\/(opengraph-image$|media\/)/);

  // The card X draws says the same thing.
  expect(await meta(page, 'name="twitter:card"')).toBe("summary_large_image");
  expect(await meta(page, 'name="twitter:title"'), "twitter:title").toBe(title);
  expect(await meta(page, 'name="twitter:description"'), "twitter:description").toBe(description);
  expect(await meta(page, 'name="twitter:image"'), "twitter:image").toBe(image);
}

test.describe("the head of every page", () => {
  /*
   * One of every kind of indexable page. A NEW PAGE GOES IN THIS LIST: it is
   * what holds its canonical, its `hreflang` and what it shares as.
   */
  const pages = [
    BG.home,
    BG.categories,
    BG.capsules,
    BG.nespresso,
    BG.dolceGusto,
    BG.beans,
    BG.lavazzaCapsules,
    BG.lavazzaBeans,
    BG.decaf,
    BG.cheapestPerCup,
    BG.brands,
    BG.brand("lavazza"),
    BG.promotions,
    BG.wizard,
    BG.machines,
    BG.machineBrand("krups"),
    BG.machineBrand("tchibo"),
    BG.delivery,
    BG.contact,
    BG.privacy,
    BG.terms,
    BG.cookies,
    BG.journal,
    ARTICLE,
    BG.vending,
  ];

  for (const path of pages) {
    test(`${path}: lang, canonical, hreflang, share tags and JSON-LD all name /bg`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", "bg");

      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(new URL(canonical!).pathname).toBe(path);

      const alternates = await page
        .locator('link[rel="alternate"][hreflang]')
        .evaluateAll((links) =>
          links.map((link) => [link.getAttribute("hreflang"), link.getAttribute("href")]),
        );
      expect(alternates).toEqual([
        ["bg", canonical],
        ["x-default", canonical],
      ]);

      await expectSharesAsItself(page, canonical!);

      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
      const urls = blocks.join(" ").match(/https?:\/\/[^"\s]+/g) ?? [];
      const ours = urls.filter((url) => !url.startsWith("https://schema.org"));
      expect(ours.length).toBeGreaterThan(0);
      for (const url of ours) {
        const { pathname } = new URL(url);
        expect(pathname, url).toMatch(/^\/(bg(\/|$)|media\/|brand-logos\/|opengraph-image)/);
      }
    });
  }

  test("a product shares as itself, under its own name", async ({ page }) => {
    await page.goto(BG.capsules);
    const product = await page.locator(PRODUCT_LINK).first().getAttribute("href");
    await page.goto(product!);
    await expect(page.locator("#order")).toBeAttached();

    const canonical = await canonicalOf(page);
    expect(new URL(canonical!).pathname).toBe(product);
    await expectSharesAsItself(page, canonical!);
    expect(await meta(page, 'property="og:type"')).toBe("website");
  });

  test("an article shares as an article, with its dates", async ({ page }) => {
    await page.goto(ARTICLE);
    expect(await meta(page, 'property="og:type"')).toBe("article");
    expect(await meta(page, 'property="article:published_time"')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await meta(page, 'property="article:modified_time"')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("a filtered listing, a search and an answered wizard share as the clean page", async ({
    page,
  }) => {
    const views: ReadonlyArray<readonly [string, string]> = [
      [`${BG.capsules}?sort=price-asc`, BG.capsules],
      [`${BG.brand("lavazza")}?sort=price-asc`, BG.brand("lavazza")],
      [`${BG.search}?q=${encodeURIComponent("лаваца")}`, BG.search],
      [`${BG.wizard}?brew=capsule`, BG.wizard],
      [`${BG.wizardResult}?brew=capsule&system=dolce-gusto`, BG.wizard],
    ];
    for (const [view, clean] of views) {
      await page.goto(view);
      const canonical = await canonicalOf(page);
      expect(new URL(canonical!).pathname, view).toBe(clean);
      expect(await meta(page, 'property="og:url"'), view).toBe(canonical);
      expect(await meta(page, 'property="og:title"'), view).not.toMatch(DEFAULT_TITLE);
    }
  });

  /*
   * The 404 is one route for every dead URL and has no layout above it. It
   * must not claim an address, and the card Next attaches to it must be on the
   * site: with no `metadataBase` Next resolves it against `localhost` and the
   * port the server happens to listen on.
   */
  test("the 404 names no address, and its share image is on the site", async ({
    page,
    request,
  }) => {
    await page.goto(BG.home);
    const site = new URL((await canonicalOf(page))!).origin;

    for (const path of ["/nope", "/bg/no-such-product-or-category", "/bg/marki/no-such-brand"]) {
      const html = await (await raw(request, path)).text();
      const head = html.slice(0, html.indexOf("</head>"));
      expect(head, path).not.toContain('property="og:url"');
      expect(head, path).not.toContain('rel="canonical"');

      const images = [
        ...head.matchAll(/<meta (?:property|name)="(?:og|twitter):image" content="([^"]+)"/g),
      ];
      expect(images.length, path).toBeGreaterThan(0);
      for (const [, image] of images) expect(new URL(image!).origin, path).toBe(site);
    }
  });

  test("search and a filtered listing are noindex, with the canonical on the clean page", async ({
    page,
  }) => {
    await page.goto(`${BG.search}?q=${encodeURIComponent("лаваца")}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(
      new URL((await page.locator('link[rel="canonical"]').getAttribute("href"))!).pathname,
    ).toBe(BG.search);

    await page.goto(`${BG.capsules}?sort=price-asc`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(
      new URL((await page.locator('link[rel="canonical"]').getAttribute("href"))!).pathname,
    ).toBe(BG.capsules);
  });

  test("the consumables page is noindex and out of the sitemap while it lists nothing", async ({
    page,
    request,
  }) => {
    await page.goto(BG.consumables);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain(`${BG.consumables}<`);
  });
});

test.describe("robots.txt and llms.txt", () => {
  test("robots.txt keeps search and answered wizard states out, under /bg", async ({ request }) => {
    const text = await (await request.get("/robots.txt")).text();
    // Only production opens the site to crawlers; a local server closes it.
    if (/Disallow: \/\s*$/m.test(text) && !text.includes("Allow:")) return;
    expect(text).toContain(`Disallow: ${BG.search}`);
    expect(text).toContain(`Disallow: ${BG.wizardResult}`);
    expect(text).toContain("Disallow: /admin");
    expect(text).not.toContain("Disallow: /search");
  });

  test("the sitemap lists /bg URLs only, each with its alternates", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]!));
    expect(locs.length).toBeGreaterThan(100);
    for (const url of locs) expect(url.pathname).toMatch(/^\/bg(\/|$)/);
    expect(xml).toContain(`${BG.capsules}</loc>`);
    expect(xml).toContain(`${BG.machineBrand("krups")}</loc>`);
    expect(xml).not.toContain(`${BG.search}<`);
    expect(xml.match(/hreflang="x-default"/g)?.length).toBe(locs.length);
  });
});
