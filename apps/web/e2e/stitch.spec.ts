import { expect, test } from "@playwright/test";
import { BG } from "./support/paths";

/**
 * The seams between the journal, the landing listings and the titled listing
 * pages, which were built apart and have to read as one site.
 *
 * Each of those has a spec of its own. What is asserted here is what only
 * holds once they are together: one title format on every kind of page, one
 * name for each listing wherever it is linked, an article that links the
 * listing it explains, and nothing in the page's content or in the sitemap
 * that points a crawler somewhere it is told not to go.
 *
 * Titles, anchors and URLs are written out, as in `titles.spec.ts`: a spec
 * that computed them with the code under test would pass whatever it said.
 */

const SHOP = "Buy a Coffee";

test.describe("one title format", () => {
  /* One page of every kind: a template title and an absolute one end alike. */
  const TITLES: ReadonlyArray<readonly [path: string, title: string]> = [
    [BG.beans, "Кафе на зърна — цена за кг и на чаша"],
    [BG.lavazzaCapsules, "Капсули Lavazza (Лаваца): Blue, A Modo Mio и за Nespresso"],
    [BG.decaf, "Безкофеиново кафе — капсули, дози и зърна"],
    [BG.journal, "Блог"],
    ["/bg/blog/vidove-kapsuli-za-kafe", "Видове капсули за кафе: коя пасва на вашата машина"],
    [BG.wizard, "Кое кафе е за вас"],
    [BG.machines, "Кои капсули пасват на моята машина"],
    [BG.machineBrand("krups"), "Капсули и кафе за кафемашини Krups — кой модел какво приема"],
    [BG.delivery, "Доставка и плащане"],
  ];

  for (const [path, title] of TITLES) {
    test(`${path} ends with the bar and the shop's name`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(`${title} | ${SHOP}`);
    });
  }

  test("no storefront page still ends with a dash before the name", async ({ page }) => {
    for (const path of [
      BG.contact,
      BG.privacy,
      BG.terms,
      BG.cookies,
      BG.cheapestPerCup,
      BG.lavazzaBeans,
      BG.machineBrand("tchibo"),
      BG.consumables,
      "/bg/blog/kolko-struva-edna-chasha-kafe",
    ]) {
      await page.goto(path);
      const title = await page.title();
      expect(title.endsWith(` | ${SHOP}`), `${path}: ${title}`).toBe(true);
      expect(title, path).not.toContain(`— ${SHOP}`);
    }
  });

  test("the journal's share title ends the same way", async ({ page }) => {
    await page.goto(BG.journal);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      `Блог | ${SHOP}`,
    );
  });
});

test.describe("articles link the listings they explain", () => {
  /* `docs/seo.md` §13.4. The reference catalog fills all four landings. */
  const LINKS: ReadonlyArray<readonly [article: string, landing: string, anchor: string]> = [
    ["/bg/blog/vidove-kapsuli-za-kafe", BG.lavazzaCapsules, "капсули Lavazza"],
    ["/bg/blog/kak-da-izberete-kafe-na-zarna", BG.decaf, "кафе без кофеин"],
    ["/bg/blog/kak-da-izberete-kafe-na-zarna", BG.cheapestPerCup, "Най-евтино на чаша"],
    ["/bg/blog/arabika-i-robusta", BG.decaf, "Безкофеиновото кафе"],
    ["/bg/blog/kafemashina-s-kapsuli-ili-na-zarna", BG.cheapestPerCup, "Най-евтино на чаша"],
    ["/bg/blog/kolko-struva-edna-chasha-kafe", BG.cheapestPerCup, "Най-евтино на чаша"],
  ];

  for (const [article, landing, anchor] of LINKS) {
    test(`${article} → ${landing}`, async ({ page }) => {
      await page.goto(article);
      const link = page.locator(`main article a[href="${landing}"]`);
      await expect(link).toHaveCount(1);
      await expect(link).toHaveText(anchor);
      expect((await page.request.get(landing)).status()).toBe(200);
    });
  }

  test("the beans listing links one article, the one about choosing beans", async ({ page }) => {
    await page.goto(BG.beans);
    const articles = page.locator('main a[href^="/bg/blog/"]');
    await expect(articles).toHaveCount(1);
    await expect(articles).toHaveAttribute("href", "/bg/blog/kak-da-izberete-kafe-na-zarna");
    await expect(articles).toHaveText("Как да изберете кафе на зърна");
  });

  test("the cheapest-per-cup page links its article by the article's title", async ({ page }) => {
    await page.goto(BG.cheapestPerCup);
    await expect(
      page.locator('main header a[href="/bg/blog/kolko-struva-edna-chasha-kafe"]'),
    ).toHaveText("Колко струва една чаша кафе всъщност");
  });
});

test.describe("one name for each listing", () => {
  const SHELVES: ReadonlyArray<readonly [path: string, name: string]> = [
    [BG.nespresso, "Капсули за Nespresso"],
    [BG.dolceGusto, "Капсули за Dolce Gusto"],
    [BG.lavazzaAModoMio, "Капсули за Lavazza A Modo Mio"],
    [BG.caffitaly, "Капсули Caffitaly"],
    [BG.lavazzaBlue, "Капсули за Lavazza Blue"],
    [BG.pods, "Кафе дози ESE"],
    [BG.beans, "Кафе на зърна"],
  ];

  test("the footer calls each shelf what the shelf calls itself", async ({ page }) => {
    await page.goto(BG.contact);
    for (const [path, name] of SHELVES) {
      await expect(page.locator(`footer a[href="${path}"]`), path).toHaveText(name);
    }
    // A compatible capsule is never „Капсули Nespresso“, as if the owner's own.
    await expect(page.locator("footer")).not.toContainText(/Капсули (Nespresso|Dolce Gusto)/);
  });

  test("a machine page sends each system to its shelf once, by the shelf's name", async ({
    page,
  }) => {
    await page.goto(BG.machineBrand("krups"));
    for (const [path, name] of [SHELVES[0], SHELVES[1], SHELVES[6]] as const) {
      const link = page.locator(`main a[href="${path}"]`);
      await expect(link, path).toHaveCount(1);
      await expect(link, path).toHaveText(name);
    }
    await expect(page.locator("main")).not.toContainText("Вижте всички");
  });

  test("a landing's link to a whole shelf uses that shelf's name", async ({ page }) => {
    await page.goto(BG.cheapestPerCup);
    await expect(page.locator(`main section a[href="${BG.nespresso}"]`)).toHaveText(
      "Всички капсули за Nespresso",
    );
    await expect(page.locator(`main section a[href="${BG.caffitaly}"]`)).toHaveText(
      "Всички капсули Caffitaly",
    );
  });

  test("consumables links the vending page by its head term", async ({ page }) => {
    await page.goto(BG.consumables);
    const link = page.locator(`main a[href="${BG.vending}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText("кафе за вендинг машини");
  });
});

test.describe("nothing doubled in a page's header", () => {
  for (const path of [
    BG.brand("lavazza"),
    BG.brand("caffitaly"),
    BG.nespresso,
    BG.lavazzaBlue,
    BG.lavazzaAModoMio,
    BG.caffitaly,
    BG.beans,
    BG.pods,
    BG.capsules,
    BG.lavazzaCapsules,
    BG.lavazzaBeans,
    BG.decaf,
    BG.cheapestPerCup,
    BG.machineBrand("tchibo"),
  ]) {
    test(`${path} links each destination once`, async ({ page }) => {
      await page.goto(path);
      const hrefs = await page.locator("main header a[href]").evaluateAll((links) =>
        links
          // A jump to a group on this page is not a destination.
          .map((link) => (link.getAttribute("href") ?? "").split("#")[0] ?? "")
          .filter((href) => href.startsWith("/")),
      );
      expect(hrefs.length, path).toBeGreaterThan(0);
      const twice = hrefs.filter((href, index) => hrefs.indexOf(href) !== index);
      expect(twice, `${path} links ${twice.join(", ")} more than once`).toEqual([]);
    });
  }
});

test.describe("nothing crawlable points where crawlers are told not to go", () => {
  /* `docs/seo.md` §13.6: no content link to an answered wizard state. */
  for (const brand of ["krups", "tchibo", "lavazza", "delonghi", "vending"]) {
    test(`machine page ${brand} has no link with a query string`, async ({ page }) => {
      await page.goto(BG.machineBrand(brand));
      const hrefs = await page
        .locator("main a[href]")
        .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href, href).not.toMatch(/\?/);
        expect(href, href).not.toMatch(/^\/bg\/izbor-na-kafe\/rezultat/);
      }
    });
  }

  test("the sitemap lists promotions only while the page asks to be indexed", async ({
    page,
    request,
  }) => {
    await page.goto(BG.promotions);
    const robots = page.locator('meta[name="robots"]');
    const noindex =
      (await robots.count()) > 0 && /noindex/.test((await robots.getAttribute("content")) ?? "");
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml.includes(`${BG.promotions}</loc>`)).toBe(!noindex);
  });
});
