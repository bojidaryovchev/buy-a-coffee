import { expect, test, type Page } from "@playwright/test";
import { PRODUCT_LINK } from "./support/paths";
import { findSourceUrls } from "./support/source-guard";
import {
  expectControlsLabelled,
  expectImagesHaveAlt,
  expectLandmarks,
  expectNoHeadingSkips,
  expectNoHorizontalScroll,
} from "./support/structure";

/**
 * The pages that are not the catalog: delivery, the two business sections, the
 * journal, and the admin gate.
 *
 * Structural on purpose. These pages are mostly prose, and the prose is what a
 * redesign or a copy edit changes; what must survive either is that the page
 * exists, has one heading hierarchy, labels its controls and fits a phone.
 * Anything that reads data (the vending blends, the journal's article list) is
 * asserted by count and by link target, never by wording.
 */

const SECTIONS = [
  "/bg/dostavka-i-plashtane",
  "/bg/kafe-za-vending-mashini",
  "/bg/konsumativi",
  "/bg/blog",
] as const;

for (const route of SECTIONS) {
  test.describe(route, () => {
    test("responds, with one h1 and the page landmarks", async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expectLandmarks(page);
    });

    test("has no heading level skips", async ({ page }) => {
      await page.goto(route);
      await expectNoHeadingSkips(page);
    });

    test("images have alternative text and controls have names", async ({ page }) => {
      await page.goto(route);
      await expectImagesHaveAlt(page);
      await expectControlsLabelled(page);
    });

    test("describes itself, and can be indexed unless it lists nothing", async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\S/);
      // A page with no robots meta at all is indexable; only an explicit noindex is wrong.
      // The consumables page is the exception while it lists nothing: it is
      // `noindex` until the catalog files a product under it (see i18n.spec.ts).
      const robots = page.locator('meta[name="robots"]');
      if (route !== "/bg/konsumativi" && (await robots.count()) > 0) {
        expect(await robots.first().getAttribute("content")).not.toMatch(/noindex/);
      }
    });

    // The journal is reading, not an offer; it promises no phone line of its own.
    if (route !== "/bg/blog") {
      test("offers a way to ask by phone", async ({ page }) => {
        await page.goto(route);
        // Scoped to <main>: the header's phone link is hidden on small screens.
        await expect(page.locator('main a[href^="tel:"]').first()).toBeAttached();
      });
    }

    test("loads nothing from the source domain", async ({ page }) => {
      const requested: string[] = [];
      page.on("request", (request) => requested.push(request.url()));
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      expect(findSourceUrls(requested)).toEqual([]);
    });

    test.describe("on a phone", () => {
      test.use({ viewport: { width: 390, height: 844 } });

      test("does not scroll horizontally", async ({ page }) => {
        await page.goto(route);
        await expectNoHorizontalScroll(page, route);
      });
    });
  });
}

test.describe("the two business sections", () => {
  for (const route of ["/bg/kafe-za-vending-mashini", "/bg/konsumativi"]) {
    test(`${route} has an enquiry form that posts to our own server`, async ({ page }) => {
      await page.goto(route);
      const forms = page.locator("main form");
      expect(await forms.count()).toBeGreaterThan(0);
      for (const form of await forms.all()) {
        // A server action renders without an `action` URL; a plain form posts
        // to a path. Neither may point off-site.
        const action = await form.getAttribute("action");
        if (action) expect(action).not.toMatch(/^https?:\/\//i);
      }
    });
  }

  test("the vending section lists vending blends from the catalog, each a link to a product", async ({
    page,
  }) => {
    await page.goto("/bg/kafe-za-vending-mashini");
    const links = page.locator(`main ${PRODUCT_LINK}`);
    expect(await links.count()).toBeGreaterThan(0);

    const first = await links.first().getAttribute("href");
    const response = await page.request.get(first as string);
    expect(response.status()).toBe(200);
  });
});

/** The article paths the journal index links to. */
async function articleLinks(page: Page): Promise<string[]> {
  await page.goto("/bg/blog");
  const hrefs = await page
    .locator('main a[href^="/bg/blog/"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
  return [...new Set(hrefs)].filter((href) => /^\/bg\/blog\/[^/]+$/.test(href));
}

test.describe("/bg/blog", () => {
  test("the index links to its articles", async ({ page }) => {
    expect((await articleLinks(page)).length).toBeGreaterThan(0);
  });

  test("every article the index lists opens and is well formed", async ({ page }) => {
    const links = await articleLinks(page);
    expect(links.length).toBeGreaterThan(0);

    for (const href of links) {
      const response = await page.goto(href);
      expect(response?.status(), `${href} status`).toBe(200);
      await expectLandmarks(page);
      await expectNoHeadingSkips(page);
      await expectImagesHaveAlt(page);
    }
  });

  test("an article describes itself as an article, with a way back to the index", async ({
    page,
  }) => {
    const [first] = await articleLinks(page);
    await page.goto(first as string);

    const structured = (
      await page.locator('script[type="application/ld+json"]').allTextContents()
    ).join(" ");
    expect(structured).toContain('"Article"');
    expect(structured).toContain("BreadcrumbList");

    await expect(page.locator('a[href="/bg/blog"]').first()).toBeAttached();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`${first}$`),
    );
  });

  test("a table in an article has a caption", async ({ page }) => {
    for (const href of await articleLinks(page)) {
      await page.goto(href);
      const tables = await page.locator("main table").count();
      if (tables > 0) {
        expect(await page.locator("main table > caption").count(), `${href} captions`).toBe(tables);
      }
    }
  });

  test("the section is called „Блог“, in its heading and in the frame", async ({ page }) => {
    await page.goto("/bg/blog");
    await expect(page.locator("h1")).toHaveText("Блог");
    await expect(page).toHaveTitle(/^Блог/);
    // The footer names the section on every page, at every width.
    await expect(page.locator('footer a[href="/bg/blog"]')).toHaveText("Блог");
    await expect(page.locator("body")).not.toContainText(/дневник/i);
  });

  test("the articles with measured demand are published at the slug of their query", async ({
    page,
  }) => {
    const expected: ReadonlyArray<readonly [string, string]> = [
      ["/bg/blog/vidove-kapsuli-za-kafe", "Видове капсули за кафе: коя пасва на вашата машина"],
      ["/bg/blog/kak-da-izberete-kafe-na-zarna", "Как да изберете кафе на зърна"],
      ["/bg/blog/arabika-i-robusta", "Арабика и робуста: каква е разликата"],
      [
        "/bg/blog/kafemashina-s-kapsuli-ili-na-zarna",
        "Кафемашина с капсули или на зърна: какво ще купувате после",
      ],
    ];
    const listed = await articleLinks(page);
    for (const [path, title] of expected) {
      expect(listed, path).toContain(path);
      await page.goto(path);
      await expect(page.locator("h1")).toHaveText(title);
      await expect(page).toHaveTitle(new RegExp(`^${title}`));
    }
  });

  test("an article's previous address answers 308 to its current one, in one hop", async ({
    request,
  }) => {
    // Literal on purpose: these are the addresses the journal launched at, and
    // a retitled article must never turn one of them into a 404.
    const moved: ReadonlyArray<readonly [string, string]> = [
      ["/bg/blog/koya-kapsula-pasva-na-koya-mashina", "/bg/blog/vidove-kapsuli-za-kafe"],
      ["/bg/blog/zarna-kapsuli-ili-dozi", "/bg/blog/kafemashina-s-kapsuli-ili-na-zarna"],
    ];
    for (const [from, to] of moved) {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(308);
      const location = response.headers()["location"] ?? "";
      expect(new URL(location, "http://shop.test").pathname, from).toBe(to);

      const landed = await request.get(to, { maxRedirects: 0 });
      expect(landed.status(), to).toBe(200);
    }
  });

  test("an unknown article is a real 404", async ({ page }) => {
    const response = await page.goto("/bg/blog/this-article-does-not-exist");
    expect(response?.status()).toBe(404);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("articles do not scroll horizontally", async ({ page }) => {
      for (const href of await articleLinks(page)) {
        await page.goto(href);
        await expectNoHorizontalScroll(page, href);
      }
    });
  });
});

test.describe("/admin", () => {
  test("a signed-out visit to a panel page is redirected to the login page", async ({
    request,
  }) => {
    const response = await request.get("/admin/sinhron", { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(new URL(response.headers()["location"] ?? "", "http://x").pathname).toBe("/admin/vhod");
  });

  test("following the redirect lands on a labelled login form that is kept out of search", async ({
    page,
  }) => {
    await page.goto("/admin/sinhron");
    await expect(page).toHaveURL(/\/admin\/vhod$/);

    await expect(page.locator("h1")).toHaveCount(1);
    await expectControlsLabelled(page);
    await expect(page.locator('input[type="password"]')).toHaveCount(1);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("the login page itself does not redirect, so there is no loop", async ({ request }) => {
    const response = await request.get("/admin/vhod", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
  });
});
