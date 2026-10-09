import { expect, test, type Page } from "@playwright/test";
import { BG } from "./support/paths";

/**
 * What a search result and a crawler get from the listing, brand and index
 * pages: the title and heading the market study gives each page, a description
 * that quotes a price per cup and says ordering is a phone call, breadcrumbs
 * that follow the format, and links that go where the linking plan says.
 *
 * Titles and headings are written out, as the URLs in `support/paths.ts` are:
 * a spec that computed them with the code under test would pass whatever that
 * code said. Figures are matched by shape, never by value — the catalog's
 * prices are its own.
 */

/** „от 0,19 € до 0,42 € на чаша“, or one figure; either end may carry „≈“. */
const PER_CUP = /(от (≈ )?\d+,\d{2}\s€ до (≈ )?\d+,\d{2}\s€|(≈ )?\d+,\d{2}\s€) на чаша/u;
const CALLBACK = "Оставяте телефон и ви се обаждаме, за да потвърдим.";
const SHOP = "Buy a Coffee";

const LISTINGS: ReadonlyArray<{
  readonly path: string;
  readonly title: string;
  readonly h1: string;
  readonly trail: readonly string[];
}> = [
  {
    path: BG.capsules,
    title: "Кафе капсули за Nespresso, Dolce Gusto, Lavazza и Caffitaly",
    h1: "Кафе капсули",
    trail: ["Начало", "Кафе капсули"],
  },
  {
    path: "/bg/dolce-gusto-kapsuli",
    title: "Капсули за Dolce Gusto (Долче Густо) — цена на чаша",
    h1: "Капсули за Dolce Gusto",
    trail: ["Начало", "Кафе капсули", "Капсули за Dolce Gusto"],
  },
  {
    path: BG.nespresso,
    title: "Капсули за Nespresso (Неспресо) — цена на чаша",
    h1: "Капсули, съвместими с Nespresso",
    trail: ["Начало", "Кафе капсули", "Капсули за Nespresso"],
  },
  {
    path: "/bg/lavazza-blue-kapsuli",
    title: "Капсули Lavazza Blue (Лаваца Блу) — 100 бр., цена на чаша",
    h1: "Капсули за Lavazza Blue",
    trail: ["Начало", "Кафе капсули", "Капсули за Lavazza Blue"],
  },
  {
    path: "/bg/lavazza-a-modo-mio-kapsuli",
    title: "Капсули Lavazza A Modo Mio (Лаваца А Модо Мио)",
    h1: "Капсули за Lavazza A Modo Mio",
    trail: ["Начало", "Кафе капсули", "Капсули за Lavazza A Modo Mio"],
  },
  {
    path: "/bg/caffitaly-kapsuli",
    title: "Капсули Caffitaly (Кафитали) — цена на чаша",
    h1: "Капсули Caffitaly",
    trail: ["Начало", "Кафе капсули", "Капсули Caffitaly"],
  },
  {
    path: "/bg/kafe-na-zarna",
    title: "Кафе на зърна — цена за кг и на чаша",
    h1: "Кафе на зърна",
    trail: ["Начало", "Кафе на зърна"],
  },
  {
    path: "/bg/kafe-dozi",
    title: "Кафе дози ESE (хартиени дози 44 мм)",
    h1: "Кафе дози ESE",
    trail: ["Начало", "Кафе дози ESE"],
  },
  {
    path: BG.brands,
    title: "Марки кафе — италиански и други",
    h1: "Марки кафе",
    trail: ["Начало", "Марки кафе"],
  },
  {
    path: BG.brand("lavazza"),
    title: "Кафе Lavazza (Лаваца): дози, зърна и капсули",
    h1: "Lavazza",
    trail: ["Начало", "Марки кафе", "Lavazza"],
  },
  {
    path: BG.brand("bianchi"),
    title: "Кафе Bianchi (Бианчи): капсули и дози",
    h1: "Bianchi",
    trail: ["Начало", "Марки кафе", "Bianchi"],
  },
  {
    path: BG.vending,
    title: "Кафе за вендинг машини и автомати — смеси на зърна",
    h1: "Кафе за вендинг машини",
    trail: ["Начало", "Кафе за вендинг машини"],
  },
  {
    path: BG.categories,
    title: "Категории кафе: зърна, капсули по система и дози",
    h1: "Категории кафе",
    trail: ["Начало", "Категории кафе"],
  },
];

interface Breadcrumb {
  readonly name: string;
  readonly item: string;
}

/** The page's `BreadcrumbList`, as declared in its structured data. */
async function declaredTrail(page: Page): Promise<readonly Breadcrumb[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  for (const block of blocks) {
    const data = JSON.parse(block) as { "@type"?: string; itemListElement?: Breadcrumb[] };
    if (data["@type"] === "BreadcrumbList") return data.itemListElement ?? [];
  }
  return [];
}

for (const listing of LISTINGS) {
  test.describe(listing.path, () => {
    test("is titled and headed as its searchers type", async ({ page }) => {
      await page.goto(listing.path);
      await expect(page).toHaveTitle(`${listing.title} | ${SHOP}`);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText(listing.h1);
    });

    test("describes itself with a price per cup and the callback", async ({ page }) => {
      await page.goto(listing.path);
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description).toMatch(PER_CUP);
      expect(description?.endsWith(CALLBACK), description ?? "").toBe(true);
      expect(description?.length ?? 0).toBeLessThanOrEqual(160);
      expect(description).not.toMatch(/!|оригинал/iu);
    });

    test("shows and declares the same breadcrumb trail", async ({ page }) => {
      await page.goto(listing.path);
      const steps = page.getByRole("navigation", { name: "Навигационен път" }).locator("li");
      // Each step but the last is followed by a decorative separator.
      const shown = (await steps.allInnerTexts()).map((text) =>
        text.replace(/\s*\/\s*$/, "").trim(),
      );
      expect(shown).toEqual(listing.trail);

      const declared = await declaredTrail(page);
      expect(declared.map((step) => step.name)).toEqual(listing.trail);
      // The last step is the page itself, at its clean URL.
      expect(new URL(declared.at(-1)?.item ?? "").pathname).toBe(listing.path);
    });
  });
}

test("the home page carries the shop's query in its title, and prices in its description", async ({
  page,
}) => {
  await page.goto(BG.home);
  await expect(page).toHaveTitle(`Онлайн магазин за кафе: капсули, зърна и дози | ${SHOP}`);
  await expect(page.locator("h1")).toHaveCount(1);
  const description = await page.locator('meta[name="description"]').getAttribute("content");
  expect(description).toMatch(PER_CUP);
  expect(description?.endsWith(CALLBACK)).toBe(true);
});

test("promotions are titled for „промоция“ and stay out of the index while nothing is reduced", async ({
  page,
}) => {
  await page.goto(BG.promotions);
  await expect(page).toHaveTitle(`Кафе на промоция — намалени капсули, зърна и дози | ${SHOP}`);
  await expect(page.locator("h1")).toHaveText("Кафе на промоция");

  const reduced = await page.locator("main article").count();
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  const description = await page.locator('meta[name="description"]').getAttribute("content");
  if (reduced === 0) {
    expect(robots).toMatch(/noindex/);
    expect(description).not.toMatch(/на чаша/);
  } else {
    expect(robots ?? "").not.toMatch(/noindex/);
    expect(description).toMatch(PER_CUP);
  }
  expect(description?.endsWith(CALLBACK)).toBe(true);
});

test.describe("links between listings", () => {
  const SYSTEM_LISTINGS = [
    "/bg/dolce-gusto-kapsuli",
    BG.nespresso,
    "/bg/lavazza-blue-kapsuli",
    "/bg/lavazza-a-modo-mio-kapsuli",
    "/bg/caffitaly-kapsuli",
    "/bg/kafe-na-zarna",
    "/bg/kafe-dozi",
  ];

  for (const path of SYSTEM_LISTINGS) {
    test(`${path} links back to the machine finder exactly once`, async ({ page }) => {
      await page.goto(path);
      const finder = page.locator(`main a[href="${BG.machines}"]`);
      await expect(finder).toHaveCount(1);
      await expect(finder).toHaveText("Не знаете системата? Намерете машината си");
    });
  }

  test("the capsule listing names each system's page as that page is headed", async ({ page }) => {
    await page.goto(BG.capsules);
    const chips = page.getByRole("navigation", { name: "Подкатегории на Кафе капсули" });
    await expect(chips.locator('a[href="/bg/dolce-gusto-kapsuli"]')).toContainText(
      "Капсули за Dolce Gusto",
    );
    await expect(chips.locator(`a[href="${BG.nespresso}"]`)).toContainText("Капсули за Nespresso");
  });

  test("the capsule listing links to one article, the one about capsule types", async ({
    page,
  }) => {
    await page.goto(BG.capsules);
    const articles = page.locator('main a[href^="/bg/blog/"]');
    await expect(articles).toHaveCount(1);
    const response = await page.request.get((await articles.getAttribute("href")) as string);
    expect(response.status()).toBe(200);
    // And once, to the machine finder, from the sentence that mentions it.
    await expect(page.locator(`main a[href="${BG.machines}"]`)).toHaveCount(1);
  });

  test("the two Lavazza systems say what the other is, and link to it", async ({ page }) => {
    await page.goto("/bg/lavazza-blue-kapsuli");
    await expect(
      page.locator('main a[href="/bg/lavazza-a-modo-mio-kapsuli"]', {
        hasText: "капсули A Modo Mio",
      }),
    ).toHaveCount(1);
    await page.goto("/bg/lavazza-a-modo-mio-kapsuli");
    await expect(
      page.locator('main a[href="/bg/lavazza-blue-kapsuli"]', {
        hasText: "капсулите за Lavazza Blue",
      }),
    ).toHaveCount(1);
  });

  test("the Caffitaly listing points Cafissimo owners at their machine's page", async ({
    page,
  }) => {
    await page.goto("/bg/caffitaly-kapsuli");
    const link = page.locator(`main a[href="${BG.machineBrand("tchibo")}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText("машините Tchibo Cafissimo");
  });

  test("a brand page links up to the listing of each system it is stocked in", async ({ page }) => {
    await page.goto(BG.brand("bianchi"));
    const shelves = page.getByRole("navigation", { name: /Bianchi и останалите марки/ });
    await expect(shelves.locator('a[href="/bg/dolce-gusto-kapsuli"]')).toHaveText(
      "Капсули за Dolce Gusto",
    );
    await expect(shelves.locator(`a[href="${BG.nespresso}"]`)).toHaveText("Капсули за Nespresso");
    await expect(shelves.locator('a[href="/bg/kafe-dozi"]')).toHaveText("Кафе дози ESE");
    // Up, not round in circles: the system's listing does not link back.
    await page.goto("/bg/dolce-gusto-kapsuli");
    await expect(page.locator(`main a[href="${BG.brand("bianchi")}"]`)).toHaveCount(0);
  });

  /*
   * `docs/seo.md` §13.6. Filter options, sort and pagination are controls and
   * live in the filter panel, the chip row and the pagination nav; everything
   * else in <main> is content, and content never points at a URL that
   * robots.txt keeps crawlers out of.
   */
  for (const path of [
    BG.home,
    BG.capsules,
    "/bg/dolce-gusto-kapsuli",
    BG.brands,
    BG.brand("lavazza"),
    BG.categories,
    BG.promotions,
    BG.vending,
  ]) {
    test(`${path}: no content link leads to a filtered, sorted or answered URL`, async ({
      page,
    }) => {
      await page.goto(path);
      const hrefs = await page
        .locator("main a[href]")
        .evaluateAll((links) =>
          links
            .filter(
              (link) =>
                !link.closest(
                  'aside, details, dialog, nav[aria-label="Страниране"], ul[aria-label="Активни филтри"]',
                ),
            )
            .map((link) => link.getAttribute("href") ?? ""),
        );
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href, href).not.toMatch(/\?/);
        expect(href, href).not.toMatch(/^\/bg\/(tarsene|izbor-na-kafe\/rezultat)/);
      }
    });
  }
});
