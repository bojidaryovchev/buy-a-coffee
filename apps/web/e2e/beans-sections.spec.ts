import { expect, test, type Page } from "@playwright/test";
import { BG } from "./support/paths";
import { expectNoHorizontalScroll } from "./support/structure";

/**
 * The beans listing's two sections by use (research `09`, T2.2), as a visitor
 * and a crawler get them, on a desktop and on a phone.
 *
 * The headings and the page's head are written out, as `titles.spec.ts`
 * writes its titles: a spec that computed them with the code under test would
 * pass whatever that code said. Which products a section lists is the
 * catalog's business and is checked by shape — how many, in what order, and
 * that each opens — with the rule itself held row by row in
 * `beans-sections.db.test.ts`.
 */

const HEADINGS = ["Италианско кафе на зърна", "Кафе на зърна за автоматична кафемашина"] as const;

/** The T1.1 lead as it stood before the sections, with the one link it carries. */
const LEAD =
  "Кафе на зърна за автоматични кафемашини с вградена мелачка и за собствена мелачка у дома. Под всяка опаковка е цената на чаша, а на страницата на продукта и цената за 1 кг, така че сравнявате пакети с различен размер по едно и също мерило. Зърната се мелят точно преди кафето, затова тук избирате само вкус и опаковка. Не знаете системата? Намерете машината си";

const heading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 2, name, exact: true });

/** The section a heading labels. */
const section = (page: Page, name: string) => page.locator("section", { has: heading(page, name) });

/** The product links in a section's list. */
const productLinks = (page: Page, name: string) =>
  section(page, name).locator('ul a[href^="/bg/"]');

const [ITALIAN, AUTOMATIC] = HEADINGS;

test.describe("the beans listing's sections by use", () => {
  test("stand on the first page, both headings visible", async ({ page }) => {
    await page.goto(BG.beans);
    for (const name of HEADINGS) {
      await expect(heading(page, name)).toHaveCount(1);
      await heading(page, name).scrollIntoViewIfNeeded();
      await expect(heading(page, name)).toBeVisible();
    }
    await expectNoHorizontalScroll(page, BG.beans);
  });

  test("list one pack per Italian brand, by brand name, each opening its product", async ({
    page,
    request,
  }) => {
    await page.goto(BG.beans);
    const links = productLinks(page, ITALIAN);
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(12);
    await links.first().scrollIntoViewIfNeeded();
    await expect(links.first()).toBeVisible();

    for (const href of await links.evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute("href") ?? ""),
    )) {
      // Straight to the product: no redirect, no 404.
      const response = await request.get(href, { maxRedirects: 0 });
      expect(response.status(), href).toBe(200);
      expect(await response.text(), href).toContain('"@type":"Product"');
    }

    // Each row names the price its pack was chosen by.
    const rows = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.closest("li")?.textContent ?? ""),
    );
    for (const row of rows) expect(row).toMatch(/\d+,\d{2}\s€ \/ кг/u);

    // In the order of the brands' names, each brand once. The name is the
    // link's first word or two; the brands are compared by the first word.
    const firstWords = (await links.allTextContents()).map((text) => text.split(" ")[0]!);
    expect(new Set(firstWords).size).toBe(firstWords.length);
    expect(firstWords).toEqual(
      [...firstWords].sort((a, b) => a.localeCompare(b, "bg", { sensitivity: "base" })),
    );
    // Held as unconfirmed in brand-facts.ts until its company is known (20 October 2026).
    expect(firstWords).not.toContain("Vandino");
  });

  test("list no products for the automatic machine, and send vending to its page", async ({
    page,
  }) => {
    await page.goto(BG.beans);
    await expect(productLinks(page, AUTOMATIC)).toHaveCount(0);
    const links = section(page, AUTOMATIC).locator("a");
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute("href", BG.vending);
    await expect(links).toHaveText("кафе за вендинг машини");
    await expect(section(page, AUTOMATIC)).toContainText(
      "всяко кафе на зърна от тази страница става за нея",
    );
  });

  test("come after the products and before the introduction", async ({ page }) => {
    await page.goto(BG.beans);
    const order = await page.evaluate(
      (names) => {
        const headings = Array.from(document.querySelectorAll("main h2")).map((h) =>
          (h.textContent ?? "").trim(),
        );
        return [...names, "За кого е кафето на зърна"].map((name) => headings.indexOf(name));
      },
      HEADINGS as unknown as string[],
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    // Below the last product card.
    const lastCard = page.locator("main ul > li > article").last();
    const cardBottom = (await lastCard.boundingBox())!.y;
    const sectionTop = (await heading(page, HEADINGS[0]).boundingBox())!.y;
    expect(sectionTop).toBeGreaterThan(cardBottom);
  });

  for (const path of [
    `${BG.beans}?page=2`,
    `${BG.beans}?brand=lavazza`,
    `${BG.beans}?sort=price-asc`,
    `${BG.beans}?strength=strong`,
  ]) {
    test(`are absent from ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      for (const name of HEADINGS) await expect(heading(page, name)).toHaveCount(0);
    });
  }

  test("leave the page's title, canonical, heading, lead and robots as they were", async ({
    page,
  }) => {
    await page.goto(BG.beans);
    await expect(page).toHaveTitle("Кафе на зърна — цена за кг и на чаша | Buy a Coffee");

    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(new URL(canonical!).pathname).toBe("/bg/kafe-na-zarna");
    expect(new URL(canonical!).search).toBe("");

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("Кафе на зърна");

    const lead = page.locator("main header p", { hasText: "Кафе на зърна за автоматични" });
    await expect(lead).toHaveCount(1);
    expect((await lead.textContent())?.replace(/\s+/g, " ").trim()).toBe(LEAD);

    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /^Кафе на зърна с цена за килограм до всяка опаковка — /u,
    );
  });
});
