import { expect, test, type Page } from "@playwright/test";
import { asDistinctVisitor } from "./support/hydration";
import { BG } from "./support/paths";

/**
 * The foot of every page: the newsletter band and the footer.
 *
 * The signup used to be the footer's fifth column, where its field was a stub
 * that showed „name@“; it is now a band of its own above the footer, which a
 * page can switch off. The footer's link groups are disclosures on a phone and
 * columns from a tablet up. What a phone, a tablet and a desktop see is
 * checked at their widths; the desktop and mobile projects add their own.
 */

const band = (page: Page) => page.locator("aside[data-newsletter-band]");
const field = (page: Page) => band(page).getByRole("textbox", { name: "Имейл адрес" });

test.describe("the newsletter band", () => {
  test("sits directly above the footer, with a field wide enough for an address", async ({
    page,
  }) => {
    await page.goto(BG.delivery);
    await expect(band(page)).toBeVisible();
    await expect(band(page).getByRole("heading", { level: 2 })).toHaveText(
      "Новите кафета по имейл",
    );
    await expect(band(page).getByRole("button", { name: "Абонирай ме" })).toBeVisible();
    await expect(
      band(page).getByRole("link", { name: "политиката за поверителност" }),
    ).toHaveAttribute("href", BG.privacy);

    // Its next sibling is the footer: nothing between the offer and the foot.
    const next = await band(page).evaluate((node) => node.nextElementSibling?.tagName);
    expect(next).toBe("FOOTER");

    // „ivan.petrov@example.com“ is about 200 px at 16 px; the field shows it whole.
    const box = await field(page).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(240);
  });

  for (const [name, path] of [
    ["the unsubscribe page", BG.unsubscribe],
    ["the contact page", BG.contact],
    ["the Vending Zone", BG.vending],
  ] as const) {
    test(`is not shown on ${name}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("footer").first()).toBeVisible();
      await expect(band(page)).toBeHidden();
    });
  }

  test("meets the home page's last band edge to edge", async ({ page }) => {
    await page.goto(BG.home);
    const vending = page.locator("main section[data-ends-on-band]");
    const vendingBox = await vending.boundingBox();
    const bandBox = await band(page).boundingBox();
    // The band's top hairline starts where the pine band ends.
    expect(Math.abs(bandBox!.y - (vendingBox!.y + vendingBox!.height))).toBeLessThanOrEqual(1);
  });

  test("subscribes without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await asDistinctVisitor(page);
    await page.goto(BG.delivery);

    const address = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    await field(page).fill(address);
    // Enter in the field, as a visitor submits: a plain POST, answered with
    // the page and the server's message where the form was.
    await field(page).press("Enter");
    await expect(band(page).getByRole("status")).toContainText("Благодарим ви");
    await context.close();
  });
});

test.describe("the footer on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("folds each group of links into a disclosure that opens without JavaScript", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(BG.delivery);

    const footer = page.locator("footer");
    const shop = footer.getByRole("navigation", { name: "Магазин" });
    const nespresso = shop.locator(`a[href="${BG.nespresso}"]`);
    await expect(nespresso).toBeHidden();

    await shop.locator("summary").click();
    await expect(nespresso).toBeVisible();
    // A link is a row a finger can hit.
    expect((await nespresso.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await shop.locator("summary").click();
    await expect(nespresso).toBeHidden();
    await context.close();
  });
});

test.describe("the footer on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("shows every group as a column, with no disclosure to open", async ({ page }) => {
    await page.goto(BG.delivery);
    const footer = page.locator("footer");
    for (const name of ["Магазин", "Помощ", "Правна информация"]) {
      const group = footer.getByRole("navigation", { name });
      await expect(group.getByRole("heading", { level: 2, name })).toBeVisible();
      await expect(group.locator("summary")).toBeHidden();
      await expect(group.locator("a").first()).toBeVisible();
    }
  });

  test("lets no link wrap", async ({ page }) => {
    await page.goto(BG.delivery);
    const wrapped = await page.locator("footer nav a").evaluateAll((links) =>
      links
        .filter((link) => {
          const range = document.createRange();
          range.selectNodeContents(link);
          const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
          return tops.size > 1;
        })
        .map((link) => link.textContent),
    );
    expect(wrapped).toEqual([]);
  });
});
