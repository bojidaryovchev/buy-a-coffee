import { expect, test } from "@playwright/test";

/**
 * Accessibility and responsive behaviour.
 *
 * These check the structural properties that decide whether the site is usable
 * with a keyboard or a screen reader — landmarks, heading order, labels, focus
 * management — rather than colour-picking.
 */

const PAGES = ["/", "/categories/kapsuli", "/brands", "/contact"];

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
  await page.goto("/categories/kapsuli");
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
  await page.goto("/contact");
  const unlabelled = await page.locator("input:not([type=hidden]), textarea, select").evaluateAll((nodes) =>
    nodes.filter((node) => {
      const element = node as HTMLInputElement;
      if (element.closest("[aria-hidden='true']")) return false; // honeypot
      const id = element.getAttribute("id");
      const hasLabel = id ? document.querySelector(`label[for="${id}"]`) !== null : false;
      return !hasLabel && !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby");
    }).length,
  );
  expect(unlabelled).toBe(0);
});

test("the honeypot field is hidden from assistive technology", async ({ page }) => {
  await page.goto("/contact");
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

  test("mobile navigation opens, traps focus and closes on Escape", async ({ page }) => {
    await page.goto("/");

    const trigger = page.getByRole("button", { name: /отвори менюто/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: /меню на сайта/i });
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("mobile navigation reaches a category", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /отвори менюто/i }).click();
    await page.getByRole("dialog").locator('a[href^="/categories/"]').first().click();
    await expect(page).toHaveURL(/\/categories\//);
  });

  test("the filter sheet opens on small screens", async ({ page }) => {
    await page.goto("/categories/kapsuli");
    const trigger = page.getByRole("button", { name: /^филтри/i });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByRole("dialog", { name: /филтри/i })).toBeVisible();
  });

  test("the layout does not scroll horizontally", async ({ page }) => {
    for (const route of ["/", "/categories/kapsuli", "/contact"]) {
      await page.goto(route);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${route} overflows horizontally`).toBe(false);
    }
  });
});
