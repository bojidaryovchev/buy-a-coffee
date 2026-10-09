import { expect, test, type Page } from "@playwright/test";
import { BG, PRODUCT_LINK } from "./support/paths";
import { findSourceUrls } from "./support/source-guard";
import {
  expectControlsLabelled,
  expectImagesHaveAlt,
  expectLandmarks,
  expectNoHeadingSkips,
  expectNoHorizontalScroll,
} from "./support/structure";

/**
 * The four landing listings, the Tchibo machine page, and the links to them.
 *
 * Asserted by shape and by link target, not by wording or by count: what each
 * page lists moves with the catalog, and which products a landing selects is
 * tested where it is decided (`test/landings.test.ts`, `landings.db.test.ts`).
 * What only a browser can show is that each page is really served at its
 * Bulgarian URL, is a sound document, lists products that open, describes
 * itself with a price per cup, and is reachable from the pages that owe it a
 * link.
 */

const LANDINGS = [
  { name: "Lavazza capsules", path: BG.lavazzaCapsules, h1: "Капсули Lavazza", grouped: true },
  { name: "Lavazza beans", path: BG.lavazzaBeans, h1: "Кафе на зърна Lavazza", grouped: false },
  { name: "decaf", path: BG.decaf, h1: "Безкофеиново кафе", grouped: true },
  { name: "cheapest per cup", path: BG.cheapestPerCup, h1: "Най-евтино на чаша", grouped: true },
] as const;

async function itemList(page: Page): Promise<{ numberOfItems: number; urls: string[] }> {
  const raw = await page.locator("script#ld-itemlist").textContent();
  const data = JSON.parse(raw ?? "{}") as {
    numberOfItems?: number;
    itemListElement?: { url: string }[];
  };
  return {
    numberOfItems: data.numberOfItems ?? 0,
    urls: (data.itemListElement ?? []).map((entry) => entry.url),
  };
}

for (const landing of LANDINGS) {
  test.describe(`${landing.name} (${landing.path})`, () => {
    test("responds, with its heading and the page landmarks", async ({ page }) => {
      const response = await page.goto(landing.path);
      expect(response?.status()).toBe(200);
      await expectLandmarks(page);
      await expect(page.locator("h1")).toHaveText(landing.h1);
    });

    test("is a sound document: headings in order, images described, controls named", async ({
      page,
    }) => {
      await page.goto(landing.path);
      await expectNoHeadingSkips(page);
      await expectImagesHaveAlt(page);
      await expectControlsLabelled(page);
    });

    test("describes itself with a price per cup and the callback, and is indexable", async ({
      page,
    }) => {
      await page.goto(landing.path);
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description).toMatch(/\d,\d\d\s€(?: до (?:≈ )?\d+,\d\d\s€)? на чаша/);
      expect(description).toMatch(/телефон/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        new RegExp(`${landing.path}$`),
      );
      const robots = page.locator('meta[name="robots"]');
      if ((await robots.count()) > 0) {
        expect(await robots.first().getAttribute("content")).not.toMatch(/noindex/);
      }
    });

    test("lists products as cards, each a link to a product that opens", async ({ page }) => {
      await page.goto(landing.path);
      const cards = page.locator(`main ${PRODUCT_LINK}`);
      const count = await cards.count();
      expect(count).toBeGreaterThan(0);

      const first = await cards.first().getAttribute("href");
      expect((await page.request.get(first as string)).status()).toBe(200);

      // The structured list is exactly the cards on the page, in their order.
      const list = await itemList(page);
      expect(list.numberOfItems).toBe(count);
      const hrefs = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("href")),
      );
      expect(list.urls.map((url) => new URL(url).pathname)).toEqual(hrefs);
    });

    test("prints a price per cup on its cards", async ({ page }) => {
      await page.goto(landing.path);
      await expect(page.locator("main article").first()).toContainText("на чаша");
    });

    if (landing.grouped) {
      test("groups its products by system, each group an anchor the page jumps to", async ({
        page,
      }) => {
        await page.goto(landing.path);
        const sections = page.locator("main section[id][aria-labelledby]");
        const ids = await sections.evaluateAll((nodes) => nodes.map((node) => node.id));
        expect(ids.length).toBeGreaterThan(0);

        for (const id of ids) {
          const section = page.locator(`main section[id="${id}"]`);
          await expect(section.locator("h2")).toHaveCount(1);
          expect(await section.locator(PRODUCT_LINK).count()).toBeGreaterThan(0);
          // Every card in a group carries that group's system.
          const systems = await section
            .locator("article [data-system]")
            .evaluateAll((nodes) => [
              ...new Set(nodes.map((node) => node.getAttribute("data-system"))),
            ]);
          expect(systems).toEqual([id]);
          if (ids.length > 1) {
            await expect(page.locator(`main a[href="#${id}"]`)).toHaveCount(1);
          }
        }
      });
    }

    test("offers the phone, and loads nothing from the source domain", async ({ page }) => {
      const requested: string[] = [];
      page.on("request", (request) => requested.push(request.url()));
      await page.goto(landing.path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator('main a[href^="tel:"]').first()).toBeAttached();
      expect(findSourceUrls(requested)).toEqual([]);
    });

    test.describe("on a phone", () => {
      test.use({ viewport: { width: 390, height: 844 } });

      test("does not scroll horizontally", async ({ page }) => {
        await page.goto(landing.path);
        await expectNoHorizontalScroll(page, landing.path);
      });
    });
  });
}

test.describe("cheapest per cup", () => {
  test("shows at most three products in each system", async ({ page }) => {
    await page.goto(BG.cheapestPerCup);
    const sections = page.locator("main section[id][aria-labelledby]");
    for (const section of await sections.all()) {
      const count = await section.locator(PRODUCT_LINK).count();
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  test("links the article that explains the price per cup", async ({ page }) => {
    await page.goto(BG.cheapestPerCup);
    const article = page.locator(`main header a[href^="${BG.journal}/"]`);
    await expect(article).toHaveCount(1);
    const response = await page.request.get((await article.getAttribute("href")) as string);
    expect(response.status()).toBe(200);
  });
});

test.describe("the Tchibo machine page", () => {
  const path = BG.machineBrand("tchibo");

  test("is titled for Cafissimo and lists capsules above the models", async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveText("Капсули за Tchibo Cafissimo");
    await expect(page).toHaveTitle(/^Капсули за Tchibo Cafissimo \(Чибо Кафисимо\)/);
    await expectNoHeadingSkips(page);

    const cards = page.locator(`main ${PRODUCT_LINK}`);
    expect(await cards.count()).toBeGreaterThan(0);
    // Everything listed is the Caffitaly format, which is what a Cafissimo takes.
    const systems = await page
      .locator("main article [data-system]")
      .evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute("data-system")))]);
    expect(systems).toEqual(["caffitaly"]);

    const listBeforeModels = await page.evaluate(() => {
      const list = document.querySelector("#fits-heading");
      const model = document.querySelector("#tchibo-cafissimo-classic");
      if (!list || !model) return false;
      return Boolean(list.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(listBeforeModels).toBe(true);
  });

  test("and the Caffitaly shelf link to each other", async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(`main header a[href="${BG.caffitaly}"]`)).toHaveCount(1);
    await page.goto(BG.caffitaly);
    await expect(page.locator(`main header a[href="${path}"]`)).toHaveCount(1);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("does not scroll horizontally", async ({ page }) => {
      await page.goto(path);
      await expectNoHorizontalScroll(page, path);
    });
  });
});

test("another machine brand keeps the generic heading and lists no products", async ({ page }) => {
  await page.goto(BG.machineBrand("krups"));
  await expect(page.locator("h1")).toHaveText("Кафемашини Krups: какво им пасва");
  await expect(page).toHaveTitle(/^Капсули и кафе за кафемашини Krups — кой модел какво приема/);
  await expect(page.locator(`main ${PRODUCT_LINK}`)).toHaveCount(0);
});

test.describe("the links to the new pages", () => {
  test("every system's shelf links decaf and cheapest per cup", async ({ page }) => {
    for (const shelf of [BG.nespresso, BG.dolceGusto, BG.lavazzaBlue, BG.beans, BG.pods]) {
      await page.goto(shelf);
      const header = page.locator("main header");
      await expect(header.locator(`a[href^="${BG.decaf}"]`), shelf).toHaveCount(1);
      await expect(header.locator(`a[href^="${BG.cheapestPerCup}"]`), shelf).toHaveCount(1);
    }
  });

  test("a system's decaf link lands on that system's group", async ({ page }) => {
    await page.goto(BG.nespresso);
    const link = page.locator(`main header a[href^="${BG.decaf}#"]`);
    await expect(link).toHaveCount(1);
    const target = (await link.getAttribute("href")) as string;
    await page.goto(target);
    await expect(page.locator(`section[id="${target.split("#")[1]}"]`)).toBeVisible();
  });

  test("the Lavazza pages link to each other", async ({ page }) => {
    const pages = [BG.brand("lavazza"), BG.lavazzaCapsules, BG.lavazzaBlue, BG.lavazzaAModoMio];
    for (const from of pages) {
      await page.goto(from);
      for (const to of pages.filter((other) => other !== from)) {
        await expect(page.locator(`main header a[href="${to}"]`), `${from} → ${to}`).toHaveCount(1);
      }
    }
  });

  test("the footer links decaf and cheapest per cup from every page", async ({ page }) => {
    for (const from of [BG.home, BG.contact, BG.lavazzaCapsules]) {
      await page.goto(from);
      await expect(page.locator(`footer a[href="${BG.decaf}"]`)).toHaveCount(1);
      await expect(page.locator(`footer a[href="${BG.cheapestPerCup}"]`)).toHaveCount(1);
    }
  });

  test("the sitemap lists all four, and not the empty consumables page", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const landing of LANDINGS) expect(xml).toContain(`${landing.path}</loc>`);
    expect(xml).toContain(`${BG.machineBrand("tchibo")}</loc>`);
    expect(xml).not.toContain(`${BG.consumables}</loc>`);
  });
});
