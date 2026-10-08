import { expect, type Page } from "@playwright/test";

/**
 * Structural assertions shared by specs that check a page's shape rather than
 * its words: one `h1`, ordered headings, landmarks, alternative text, labelled
 * controls, no sideways scrolling.
 *
 * They deliberately read nothing a designer or a copywriter would change — no
 * class names, no text — so a redesign that keeps the document sound keeps
 * these green.
 */

/** One `h1`, one `main`, a header and a footer. */
export async function expectLandmarks(page: Page): Promise<void> {
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).not.toBeEmpty();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("header").first()).toBeVisible();
  await expect(page.locator("footer").first()).toBeVisible();
}

/** Heading levels in document order never jump down by more than one. */
export async function expectNoHeadingSkips(page: Page): Promise<void> {
  const levels = await page
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName[1])));

  expect(levels[0], "the first heading is the h1").toBe(1);
  let previous = levels[0] ?? 1;
  for (const level of levels) {
    expect(level - previous, `heading h${level} follows h${previous}`).toBeLessThanOrEqual(1);
    previous = level;
  }
}

export async function expectImagesHaveAlt(page: Page): Promise<void> {
  const missing = await page
    .locator("img")
    .evaluateAll((nodes) => nodes.filter((node) => !node.hasAttribute("alt")).length);
  expect(missing, "images without an alt attribute").toBe(0);
}

/** Every visible form control has a label, an aria-label or an aria-labelledby. */
export async function expectControlsLabelled(page: Page): Promise<void> {
  const unlabelled = await page
    .locator("input:not([type=hidden]), textarea, select")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const element = node as HTMLInputElement;
          if (element.closest("[aria-hidden='true']")) return false; // honeypot
          const id = element.getAttribute("id");
          const hasLabel = id ? document.querySelector(`label[for="${id}"]`) !== null : false;
          return (
            !hasLabel &&
            !element.getAttribute("aria-label") &&
            !element.getAttribute("aria-labelledby") &&
            element.closest("label") === null
          );
        })
        .map((node) => node.getAttribute("name") ?? node.tagName),
    );
  expect(unlabelled, "controls without an accessible name").toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page, route: string): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows, `${route} overflows horizontally`).toBe(false);
}
