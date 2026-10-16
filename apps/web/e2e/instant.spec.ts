import { expect, test } from "@playwright/test";
import { BG, INSTANT_COFFEE, PRODUCT_LINK } from "./support/paths";
import { expectNoHeadingSkips } from "./support/structure";

/**
 * Instant coffee: a kind of its own, recognised by name, with no brewing system.
 *
 * Written against the `seed:reference` catalog, which holds five tins filed
 * under the source's vending section. Every figure checked here is what the
 * snapshot's price over a cup at 2 g gives: 6,15 € for 200 g is about 0,06 €.
 */

const BIANCHI = INSTANT_COFFEE[0];

test.describe("an instant coffee's page", () => {
  test("is named for what it is, with the line under the heading", async ({ page }) => {
    await page.goto(BIANCHI);
    await expect(page).toHaveTitle("Bianchi — разтворимо кафе, 200 г | Buy a Coffee");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bianchi");
    await expect(page.locator("main").getByText("Разтворимо кафе, 200 г").first()).toBeVisible();
  });

  test("claims no system and no machine, and puts nothing in their place", async ({ page }) => {
    await page.goto(BIANCHI);
    const main = page.locator("main");
    // No system badge: not by the heading, not in the facts, not on the
    // instant coffees suggested beside it.
    await expect(main.locator("[data-system]")).toHaveCount(0);
    await expect(main.getByText(/Става за /u)).toHaveCount(0);
    await expect(main.getByRole("heading", { name: "Става за тези машини" })).toHaveCount(0);
    await expect(main.getByText("Проверете вашата машина")).toHaveCount(0);
    await expectNoHeadingSkips(page);
  });

  test("prices a cup at 2 g, marked as the estimate it is", async ({ page }) => {
    await page.goto(BIANCHI);
    const main = page.locator("main");
    await expect(main.getByText(/≈\s*0,06\s*€\s*на чаша/u).first()).toBeVisible();
    await expect(main.getByText("Изчислено при 2 г разтворимо кафе на чаша.")).toBeVisible();
  });

  test("leads back to the vending page, which is where its shelf is", async ({ page }) => {
    await page.goto(BIANCHI);
    const breadcrumb = page.getByRole("navigation", { name: /навигационен път/i });
    const step = breadcrumb.getByRole("link", { name: "Кафе за вендинг машини" });
    await expect(step).toHaveAttribute("href", BG.vending);
  });

  test("suggests other instant coffee beside it, never a capsule", async ({ page }) => {
    await page.goto(BIANCHI);
    const related = page.locator("main section", {
      has: page.getByRole("heading", { name: "Може да ви хареса и" }),
    });
    const links = await related
      .locator(PRODUCT_LINK)
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) expect(INSTANT_COFFEE).toContain(href);
  });
});

test.describe("instant coffee in the shop", () => {
  test("the vending page lists all five under a heading that says what they are", async ({
    page,
  }) => {
    await page.goto(BG.vending);
    await expect(page.getByRole("heading", { name: "Разтворимо кафе", level: 2 })).toBeVisible();
    await expect(
      page.getByText(
        "Опаковките са от 200 г и 500 г. Цената на чаша е приблизителна и е отбелязана с „≈“: смятаме по 2 г разтворимо кафе на чаша.",
      ),
    ).toBeVisible();
    for (const path of INSTANT_COFFEE) {
      await expect(page.locator(`main a[href="${path}"]`).first()).toBeAttached();
    }
  });

  for (const query of ["разтворимо кафе", "инстантно кафе"]) {
    test(`a search for „${query}“ finds all five`, async ({ page }) => {
      await page.goto(`${BG.search}?q=${encodeURIComponent(query)}`);
      for (const path of INSTANT_COFFEE) {
        await expect(page.locator(`main a[href="${path}"]`).first()).toBeAttached();
      }
    });
  }

  test("the cheapest-per-cup page compares within a system and lists none", async ({ page }) => {
    await page.goto(BG.cheapestPerCup);
    for (const path of INSTANT_COFFEE) {
      await expect(page.locator(`main a[href="${path}"]`)).toHaveCount(0);
    }
  });

  test("the system filter counts none of them", async ({ page }) => {
    await page.goto(`${BG.search}?q=${encodeURIComponent("разтворимо кафе")}&system=beans`);
    for (const path of INSTANT_COFFEE) {
      await expect(page.locator(`main a[href="${path}"]`)).toHaveCount(0);
    }
  });
});
