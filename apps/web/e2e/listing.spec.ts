import { expect, test, type Page } from "@playwright/test";
import { BG } from "./support/paths";
import { waitForHydration } from "./support/hydration";

/**
 * What the redesigned listing added: the system filter, sorting by the price
 * of a cup, and chips that remove one filter at a time.
 *
 * Asserted against what the cards themselves show — the system badge, the
 * "на чаша" figure — rather than against fixed products, so the specs hold for
 * any catalog in which the capsule category spans more than one system.
 */

const LISTING = BG.capsules;

/** The product cards of the listing, in the order they are shown. */
const cards = (page: Page) => page.locator("main ul > li > article");

/** "0,31 € на чаша" → 0.31; null for a card that shows no per-cup figure. */
async function perCupFigures(page: Page): Promise<Array<number | null>> {
  return cards(page).evaluateAll((articles) =>
    articles.map((article) => {
      const line = Array.from(article.querySelectorAll("p")).find((p) =>
        /на чаша/.test(p.textContent ?? ""),
      );
      const match = line?.textContent?.match(/(\d+(?:[.,]\d+)?)\s*€/);
      return match ? Number(match[1]!.replace(",", ".")) : null;
    }),
  );
}

test.describe("system filter", () => {
  test("narrows the listing to one system, and every card shows that system", async ({ page }) => {
    await page.goto(LISTING);

    // The rail's options, read from the server's HTML (on a phone the rail
    // is hidden and the same links live in the filter sheet).
    const options = page.locator('main aside a[data-system][aria-pressed="false"]');
    expect(await options.count(), "the capsule category spans several systems").toBeGreaterThan(1);
    const system = (await options.first().getAttribute("data-system"))!;
    const href = (await options.first().getAttribute("href"))!;

    if (await options.first().isVisible()) {
      await options.first().click();
    } else {
      await page.goto(href);
    }
    await expect(page).toHaveURL(new RegExp(`system=${system}`));

    const shown = cards(page);
    await expect(shown.first()).toBeVisible();
    const badges = await shown.evaluateAll((articles) =>
      articles.map((article) =>
        article.querySelector("[data-system]")?.getAttribute("data-system"),
      ),
    );
    expect(badges.length).toBeGreaterThan(0);
    expect(new Set(badges)).toEqual(new Set([system]));

    // The option now reads as on, and a chip offers to take it off again.
    await expect(
      page.locator(`main aside a[data-system="${system}"][aria-pressed="true"]`),
    ).toHaveCount(1);
    await expect(
      page.getByRole("list", { name: "Активни филтри" }).locator(`a[data-system="${system}"]`),
    ).toBeVisible();
  });
});

test.describe("sort by price per cup", () => {
  test("the sort control applies it, and the cards' per-cup figures ascend", async ({ page }) => {
    await page.goto(LISTING);
    await waitForHydration(page);
    await page.getByLabel("Подреди:").selectOption("price-per-cup");
    await expect(page).toHaveURL(/sort=price-per-cup/);
    await expect(page.getByLabel("Подреди:")).toHaveValue("price-per-cup");

    const figures = await perCupFigures(page);
    const known = figures.filter((value): value is number => value !== null);
    expect(known.length, "cards with a per-cup figure").toBeGreaterThan(1);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    // A product with no figure cannot be compared, so it comes after all that have one.
    const firstUnknown = figures.indexOf(null);
    if (firstUnknown !== -1) {
      expect(figures.slice(firstUnknown).every((value) => value === null)).toBe(true);
    }
  });

  test("the order continues across pages", async ({ page }) => {
    await page.goto(`${LISTING}?sort=price-per-cup`);
    const first = (await perCupFigures(page)).filter((value) => value !== null);
    await page.goto(`${LISTING}?sort=price-per-cup&page=2`);
    const second = (await perCupFigures(page)).filter((value) => value !== null);

    expect(second.length).toBeGreaterThan(0);
    expect(second[0]!).toBeGreaterThanOrEqual(first[first.length - 1]!);
  });

  test("works without JavaScript through the form's own submit button", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${LISTING}?brand=lavazza`);

    await page.getByLabel("Подреди:").selectOption("price-per-cup");
    await page.getByRole("button", { name: "Приложи" }).click();
    // The sort is applied and the filter already in place is kept.
    await expect(page).toHaveURL(/sort=price-per-cup/);
    await expect(page).toHaveURL(/brand=lavazza/);
    await context.close();
  });
});

test.describe("active-filter chips", () => {
  test("each chip removes exactly its own filter", async ({ page }) => {
    await page.goto(`${LISTING}?brand=lavazza&strength=strong&decaf=no`);

    const chips = page.getByRole("list", { name: "Активни филтри" });
    const removers = chips.getByRole("link", { name: /премахни филтъра/ });
    await expect(removers).toHaveCount(3);

    // The brand chip is the one whose target no longer names the brand.
    const targets = await removers.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    );
    const brandChip = targets.findIndex((href) => !href.includes("brand="));
    expect(brandChip).not.toBe(-1);
    const otherLabels = (await removers.allInnerTexts()).filter((_, index) => index !== brandChip);

    await removers.nth(brandChip).click();

    await expect(page).not.toHaveURL(/brand=/);
    await expect(page).toHaveURL(/strength=strong/);
    await expect(page).toHaveURL(/decaf=no/);
    await expect(removers).toHaveCount(2);
    expect(await removers.allInnerTexts()).toEqual(otherLabels);
  });

  test("removing a chip keeps the sort order", async ({ page }) => {
    await page.goto(`${LISTING}?brand=lavazza&sort=price-asc`);
    await page
      .getByRole("list", { name: "Активни филтри" })
      .getByRole("link", { name: /премахни филтъра/ })
      .click();
    await expect(page).not.toHaveURL(/brand=/);
    await expect(page).toHaveURL(/sort=price-asc/);
  });

  test("no chips are shown when nothing is filtered", async ({ page }) => {
    await page.goto(LISTING);
    await expect(page.getByRole("list", { name: "Активни филтри" })).toHaveCount(0);
  });
});
