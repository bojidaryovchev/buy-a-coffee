import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./support/hydration";
import { expectControlsLabelled } from "./support/structure";

/**
 * Accessibility and responsive behaviour.
 *
 * These check the structural properties that decide whether the site is usable
 * with a keyboard or a screen reader — landmarks, heading order, labels, focus
 * management — rather than colour-picking.
 */

const PAGES = ["/", "/bg/kafe-kapsuli", "/bg/marki", "/bg/kontakti"];

for (const route of PAGES) {
  test(`${route} has exactly one h1 and proper landmarks`, async ({ page }) => {
    await page.goto(route);

    // More than one h1 makes a page's structure ambiguous to a screen reader.
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator("footer").first()).toBeVisible();
  });

  test(`${route} has no heading level skips`, async ({ page }) => {
    await page.goto(route);
    const levels = await page
      .locator("h1, h2, h3, h4, h5, h6")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName[1])));

    let previous = levels[0] ?? 1;
    for (const level of levels) {
      // Jumping from h2 straight to h4 breaks document outline navigation.
      expect(level - previous).toBeLessThanOrEqual(1);
      previous = level;
    }
  });
}

test("every image has an alt attribute", async ({ page }) => {
  await page.goto("/bg/kafe-kapsuli");
  const missing = await page
    .locator("img")
    .evaluateAll((nodes) => nodes.filter((node) => !node.hasAttribute("alt")).length);
  expect(missing).toBe(0);
});

test("the skip link is the first focusable element", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
  expect(focused).toMatch(/към основното съдържание/i);
});

test("form controls have accessible names", async ({ page }) => {
  await page.goto("/bg/kontakti");
  await expectControlsLabelled(page);
});

test("the honeypot field is hidden from assistive technology", async ({ page }) => {
  await page.goto("/bg/kontakti");
  // Two forms on this page carry a honeypot: the contact form and the footer
  // newsletter. Both must be hidden; assert on the first.
  const honeypots = page.locator('input[name="website"]');
  expect(await honeypots.count()).toBeGreaterThan(0);
  const honeypot = honeypots.first();

  // It must be out of the tab order and out of the accessibility tree, or it
  // becomes a trap for real users rather than for bots.
  await expect(honeypot).toHaveAttribute("tabindex", "-1");
  const hiddenAncestor = await honeypot.evaluate(
    (node) => node.closest('[aria-hidden="true"]') !== null,
  );
  expect(hiddenAncestor).toBe(true);
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** The drawer trigger, once hydration has made it a button. */
  const menuButton = (page: Page) => page.getByRole("button", { name: "Меню", exact: true });
  const drawer = (page: Page) => page.getByRole("dialog", { name: "Меню на сайта" });

  test("mobile navigation opens, traps focus and closes on Escape", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);

    const trigger = menuButton(page);
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();

    const dialog = drawer(page);
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(trigger).toHaveAttribute("aria-controls", /.+/);

    // Focus goes to the close button, and Tab cannot leave the panel.
    await expect(dialog.getByRole("button", { name: "Затвори менюто" })).toBeFocused();
    const links = await dialog.locator("a[href], button").count();
    for (let step = 0; step <= links; step += 1) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((node) => node.contains(document.activeElement)),
        `focus after ${step + 1} Tab presses`,
      ).toBe(true);
    }
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // And back to the control that opened it.
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("the drawer closes from its close button and from the scrim", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);

    await menuButton(page).click();
    await drawer(page).getByRole("button", { name: "Затвори менюто" }).click();
    await expect(drawer(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();

    await menuButton(page).click();
    await expect(drawer(page)).toBeVisible();
    // The scrim is the strip to the right of the panel, which is 86% wide.
    const viewport = page.viewportSize()!;
    await page.mouse.click(viewport.width - 10, viewport.height / 2);
    await expect(drawer(page)).toBeHidden();
  });

  test("the drawer locks the page behind it while open", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await menuButton(page).click();
    await expect(drawer(page)).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(drawer(page)).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  });

  test("mobile navigation reaches a category, and closes on the way", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await menuButton(page).click();
    // A capsule system's shelf: categories live at the first level under `/bg`.
    await drawer(page).locator('li[data-system] a[href^="/bg/"]').first().click();
    await expect(page).toHaveURL(/\/bg\/[a-z0-9-]+$/);
    await expect(drawer(page)).toBeHidden();
  });

  test("without JavaScript the menu is a link to the categories page", async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/");

    // No drawer can open without a script, so the control must not claim to be a button.
    const link = page.getByRole("link", { name: "Меню", exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/bg/kategorii");
    await expect(page.getByRole("button", { name: "Меню", exact: true })).toHaveCount(0);

    await link.click();
    await expect(page).toHaveURL(/\/bg\/kategorii$/);
    // Each category card's heading is its link.
    await expect(page.locator('main h2 a[href^="/bg/"]').first()).toBeVisible();
    await context.close();
  });

  test("the filter sheet opens on small screens", async ({ page }) => {
    await page.goto("/bg/kafe-kapsuli");
    await waitForHydration(page);
    const trigger = page.getByRole("button", { name: /^филтри/i });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: /филтри/i });
    await expect(sheet).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the filter trigger says how many filters are active", async ({ page }) => {
    await page.goto("/bg/kafe-kapsuli?brand=lavazza&strength=strong");
    await waitForHydration(page);
    await expect(page.getByRole("button", { name: /^филтри\s*активни: 2$/i })).toBeVisible();
  });

  test("without JavaScript the filters open as a disclosure", async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto("/bg/kafe-kapsuli");

    // The toolbar's disclosure, not the rail's filter groups (also `<details>`,
    // and hidden at this width).
    const disclosure = page
      .locator("main details")
      .filter({ has: page.locator("> summary", { hasText: /^филтри/i }) });
    const summary = disclosure.locator("> summary");
    await expect(summary).toBeVisible();
    const brandLink = disclosure.locator('a[href*="brand="]').first();
    await expect(brandLink).toBeHidden();

    await summary.click();
    await expect(brandLink).toBeVisible();
    // Each filter is a plain link, so it works from here too.
    await brandLink.click();
    await expect(page).toHaveURL(/brand=/);
    await context.close();
  });

  test("the layout does not scroll horizontally", async ({ page }) => {
    for (const route of ["/", "/bg/kafe-kapsuli", "/bg/kontakti"]) {
      await page.goto(route);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${route} overflows horizontally`).toBe(false);
    }
  });
});
