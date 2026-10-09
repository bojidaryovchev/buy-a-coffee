import { expect, test, type APIRequestContext } from "@playwright/test";
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

  test("no language switcher is drawn while one locale ships", async ({ page }) => {
    await page.goto(BG.home);
    await expect(page.locator("a[hreflang]")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Език" })).toHaveCount(0);
  });
});

test.describe("the head of every page", () => {
  const pages = [
    BG.home,
    BG.capsules,
    BG.nespresso,
    BG.brand("lavazza"),
    BG.wizard,
    BG.machines,
    BG.delivery,
    BG.journal,
    BG.vending,
  ];

  for (const path of pages) {
    test(`${path}: lang, canonical, hreflang and JSON-LD all name /bg`, async ({ page }) => {
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
