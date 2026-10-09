import { expect, test, type APIRequestContext } from "@playwright/test";
import { SEEDED_FORMER_SLUGS } from "../scripts/reference-former-slugs";

/**
 * A product's and a brand's identity on this site, as a crawler and a customer
 * meet it: the shop's own names on the page, brand-first product URLs, and a
 * 308 from every address either of them used to have.
 *
 * The redirects are asked for as plain HTTP requests, without following, so
 * they are checked where a search engine sees them: the status and the
 * `Location` header. They go through the whole stack, proxy included. The
 * proxy rewrites a slug the catalog does not know to the 404 before any page
 * runs, so an old slug that is missing from what it knows fails here.
 *
 * The old addresses asked for here are ones the seed gives these products on
 * purpose (`scripts/reference-former-slugs.ts`), so the redirects have
 * something to redirect whether the committed snapshot was exported before
 * products moved to the shop's own slugs or after.
 */

/** One Dolce Gusto capsule, by the slug the supplier's wording gave it and by ours. */
const CAPSULE = {
  ...SEEDED_FORMER_SLUGS.capsule,
  title: "Borbone Crema Classica",
  detail: "Капсули за Dolce Gusto, 16 бр.",
  name: "Borbone Crema Classica — капсули за Dolce Gusto, 16 бр.",
};

/** One bag of beans, and the two bags the supplier gives one name. */
const BEANS = SEEDED_FORMER_SLUGS.beans;
const CREMA_E_AROMA = [
  { ...SEEDED_FORMER_SLUGS.cremaEAroma, title: "Lavazza Crema e Aroma" },
  { ...SEEDED_FORMER_SLUGS.cremaEAromaExpert, title: "Lavazza Crema e Aroma Expert" },
];

/** A GET that does not follow redirects. */
const raw = (request: APIRequestContext, path: string) => request.get(path, { maxRedirects: 0 });

const locationOf = (response: Awaited<ReturnType<APIRequestContext["get"]>>) => {
  const value = response.headers()["location"];
  if (!value) return null;
  const url = new URL(value, "http://x");
  return url.pathname + url.search;
};

async function permanent(request: APIRequestContext, from: string, to: string) {
  const response = await raw(request, from);
  expect(response.status(), from).toBe(308);
  expect(locationOf(response), from).toBe(to);
}

test.describe("product URLs", () => {
  test("a product is served at its brand-first slug", async ({ request }) => {
    for (const slug of [CAPSULE.slug, BEANS.slug, ...CREMA_E_AROMA.map((bag) => bag.slug)]) {
      const response = await raw(request, `/bg/${slug}`);
      expect(response.status(), slug).toBe(200);
    }
  });

  test("the slug it had before answers 308 to it, in one hop", async ({ request }) => {
    await permanent(request, `/bg/${CAPSULE.former}`, `/bg/${CAPSULE.slug}`);
    await permanent(request, `/bg/${BEANS.former}`, `/bg/${BEANS.slug}`);
    for (const bag of CREMA_E_AROMA) {
      await permanent(request, `/bg/${bag.former}`, `/bg/${bag.slug}`);
    }
  });

  test("the pre-locale /products/<old slug> ends at it, in two hops", async ({ request }) => {
    await permanent(request, `/products/${CAPSULE.former}`, `/bg/${CAPSULE.former}`);
    await permanent(request, `/bg/${CAPSULE.former}`, `/bg/${CAPSULE.slug}`);

    const followed = await request.get(`/products/${CAPSULE.former}`);
    expect(followed.status()).toBe(200);
    expect(new URL(followed.url()).pathname).toBe(`/bg/${CAPSULE.slug}`);
    // And the address the sync would give a product today needs one hop.
    await permanent(request, `/products/${CAPSULE.slug}`, `/bg/${CAPSULE.slug}`);
  });

  test("a slug no product has or had is still a 404", async ({ request }) => {
    const response = await raw(request, "/bg/kapsuli-dg-no-such-product-16-br");
    expect(response.status()).toBe(404);
  });

  test("the sitemap lists the new address and not the old one", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain(`/bg/${CAPSULE.slug}<`);
    expect(xml).not.toContain(CAPSULE.former);
    expect(xml).toContain("/bg/marki/lollo-caffe<");
    expect(xml).not.toContain("/bg/marki/lollocafe<");
  });
});

test.describe("brand URLs", () => {
  test("a brand is served at the slug it writes itself with", async ({ request }) => {
    for (const slug of ["lollo-caffe", "3-bourbons", "lavazza", "rema-caffe"]) {
      const response = await raw(request, `/bg/marki/${slug}`);
      expect(response.status(), slug).toBe(200);
    }
  });

  test("its stored slug answers 308 to that, filters included", async ({ request }) => {
    await permanent(request, "/bg/marki/lollocafe", "/bg/marki/lollo-caffe");
    await permanent(request, "/bg/marki/3bourbons", "/bg/marki/3-bourbons");
    await permanent(
      request,
      "/bg/marki/lollocafe?sort=price-asc",
      "/bg/marki/lollo-caffe?sort=price-asc",
    );
  });

  test("the pre-locale /brands/<stored slug> ends at it", async ({ request }) => {
    const followed = await request.get("/brands/lollocafe");
    expect(followed.status()).toBe(200);
    expect(new URL(followed.url()).pathname).toBe("/bg/marki/lollo-caffe");
  });

  test("a brand nobody sells is still a 404", async ({ request }) => {
    expect((await raw(request, "/bg/marki/no-such-brand")).status()).toBe(404);
  });

  test("the brands index and the product page link to the published slug", async ({ page }) => {
    await page.goto("/bg/marki");
    await expect(page.locator('main a[href="/bg/marki/lollo-caffe"]')).toHaveCount(1);
    await expect(page.locator('main a[href="/bg/marki/lollocafe"]')).toHaveCount(0);

    await page.goto("/bg/lollo-caffe-oro-kapsuli-dolce-gusto-16-br");
    await expect(page.locator('main a[href="/bg/marki/lollo-caffe"]').first()).toBeVisible();
    await expect(page.locator('a[href*="/marki/lollocafe"]')).toHaveCount(0);
  });

  test("the brand page names itself at the published slug", async ({ page }) => {
    await page.goto("/bg/marki/lollo-caffe");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lollo Caffè");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/bg\/marki\/lollo-caffe$/,
    );
  });
});

test.describe("the product page", () => {
  test("is headed by brand and line, with the format and the size beneath", async ({ page }) => {
    await page.goto(`/bg/${CAPSULE.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAPSULE.title);
    await expect(page.locator("h1 + p")).toHaveText(CAPSULE.detail);
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("is titled <Brand> <Line> — <format>, <qty> | <shop>", async ({ page }) => {
    await page.goto(`/bg/${CAPSULE.slug}`);
    await expect(page).toHaveTitle(new RegExp(`^${CAPSULE.name} \\| \\S`));
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      CAPSULE.name,
    );
  });

  test("describes itself by price, price per cup and the callback", async ({ page }) => {
    await page.goto(`/bg/${CAPSULE.slug}`);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toMatch(
      /^Borbone Crema Classica: капсули за Dolce Gusto, 16 бр\. Цена \d+,\d{2}\s€, \d+,\d{2}\s€ на чаша\. Оставете номер и ще ви се обадим, за да потвърдим поръчката\.$/u,
    );
    // The figures are the ones the page prints.
    const [, price, perCup] = description!.match(/Цена (\S+\s€), (\S+\s€ на чаша)/u)!;
    await expect(page.getByRole("main").getByText(price!, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("main").getByText(perCup!, { exact: true }).first()).toBeVisible();
  });

  test("leads back through the format and the system, not the brand", async ({ page }) => {
    await page.goto(`/bg/${CAPSULE.slug}`);
    const breadcrumb = page.getByRole("navigation", { name: /навигационен път/i });
    await expect(breadcrumb.getByRole("listitem")).toHaveText([
      /Начало/,
      /Кафе капсули/,
      /Капсули за Dolce Gusto/,
      new RegExp(CAPSULE.title),
    ]);
    await expect(breadcrumb.getByRole("link", { name: "Кафе капсули" })).toHaveAttribute(
      "href",
      "/bg/kafe-kapsuli",
    );
    await expect(breadcrumb.getByRole("link", { name: "Капсули за Dolce Gusto" })).toHaveAttribute(
      "href",
      "/bg/dolce-gusto-kapsuli",
    );
    await expect(breadcrumb.locator('a[href*="/marki/"]')).toHaveCount(0);
  });

  test("says the same in its structured data", async ({ page }) => {
    await page.goto(`/bg/${CAPSULE.slug}`);
    const blocks = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((nodes) => nodes.map((node) => JSON.parse(node.textContent ?? "{}")));
    const product = blocks.find((block) => block["@type"] === "Product");
    expect(product.name).toBe(CAPSULE.name);
    expect(new URL(product.url).pathname).toBe(`/bg/${CAPSULE.slug}`);
    expect(product.brand.name).toBe("Borbone");

    const crumbs = blocks.find((block) => block["@type"] === "BreadcrumbList");
    expect(
      crumbs.itemListElement.map((item: { name: string; item: string }) => [
        item.name,
        new URL(item.item).pathname,
      ]),
    ).toEqual([
      ["Начало", "/bg"],
      ["Кафе капсули", "/bg/kafe-kapsuli"],
      ["Капсули за Dolce Gusto", "/bg/dolce-gusto-kapsuli"],
      [CAPSULE.title, `/bg/${CAPSULE.slug}`],
    ]);
  });

  test("tells the two Crema e Aroma bags apart", async ({ page }) => {
    const titles: string[] = [];
    for (const bag of CREMA_E_AROMA) {
      await page.goto(`/bg/${bag.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(bag.title);
      titles.push(await page.title());
    }
    expect(new Set(titles).size).toBe(2);
  });

  test("does not call the system owner's own capsule a capsule 'for' its system", async ({
    page,
  }) => {
    await page.goto("/bg/lavazza-decaffeinato-kapsuli-lavazza-blue-100-br");
    await expect(page.locator("h1 + p")).toHaveText("Капсули Lavazza Blue, 100 бр.");
    await page.goto("/bg/lollo-caffe-oro-kapsuli-lavazza-blue-100-br");
    await expect(page.locator("h1 + p")).toHaveText("Капсули за Lavazza Blue, 100 бр.");
  });
});

test.describe("product names wherever a customer reads one", () => {
  /** The supplier's shorthand, which no page may print. */
  const SHORTHAND = /(?:^|\s)DG(?:\s|$)|Дозети|\d(?:бр|кг)\./u;

  test("a listing's cards are headed by brand and line", async ({ page }) => {
    await page.goto("/bg/dolce-gusto-kapsuli");
    const headings = await page.locator("main article h2, main article h3").allTextContents();
    expect(headings.length).toBeGreaterThan(5);
    for (const heading of headings) expect(heading).not.toMatch(SHORTHAND);
    expect(headings).toContain(CAPSULE.title);

    const alts = await page
      .locator("main article img")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("alt") ?? ""));
    for (const alt of alts.filter(Boolean)) expect(alt).not.toMatch(SHORTHAND);
  });

  test("so are the ESE pods, which the supplier calls something else", async ({ page }) => {
    await page.goto("/bg/kafe-dozi");
    const text = await page.getByRole("main").innerText();
    expect(text).not.toMatch(/Дозети/u);
  });

  test("the home page, the promotions and a brand's listing print none of the shorthand", async ({
    page,
  }) => {
    for (const path of ["/bg", "/bg/marki/bianchi", "/bg/kafe-na-zarna"]) {
      await page.goto(path);
      const text = await page.getByRole("main").innerText();
      expect(text, path).not.toMatch(SHORTHAND);
      const alts = await page
        .locator("main img")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("alt") ?? ""));
      for (const alt of alts) expect(alt, path).not.toMatch(SHORTHAND);
    }
  });

  test("search finds a product by our name and by the supplier's, and shows ours", async ({
    page,
  }) => {
    for (const term of ["Bianchi Adore Espresso Bar", "Дозети Adore Espresso Bar"]) {
      await page.goto(`/bg/tarsene?q=${encodeURIComponent(term)}`);
      await expect(
        page.getByRole("main").getByRole("link", { name: "Bianchi Adore Espresso Bar" }).first(),
      ).toBeVisible();
      // The page echoes the term that was typed; the results are what must be ours.
      for (const heading of await page
        .locator("main article h2, main article h3")
        .allTextContents()) {
        expect(heading).not.toMatch(SHORTHAND);
      }
    }
  });

  test("the typeahead answers with our names", async ({ request }) => {
    const response = await request.get("/api/search/suggest?q=borbone%20crema");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      products: Array<{ name: string; title: string; detail: string | null; slug: string }>;
    };
    expect(body.products.length).toBeGreaterThan(0);
    for (const product of body.products) {
      expect(product.title).toMatch(/^Borbone /);
      expect(product.name).not.toMatch(SHORTHAND);
      expect(product.slug).toMatch(/^borbone-/);
    }
  });
});
