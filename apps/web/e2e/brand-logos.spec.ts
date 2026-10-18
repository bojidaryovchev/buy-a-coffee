import { expect, test } from "@playwright/test";
import { BG } from "./support/paths";

/**
 * A brand's logo where the brand is shown as a brand (DESIGN.md, "Brand
 * logo"): the card's brand line, pages, suggestions. Not in the filters, which
 * name brands in text like every other filter group. And never
 * beside a brewing system's name, where our own capsule icon stays: most
 * capsules are third-party, and a system owner's logo there would claim an
 * endorsement. Caffitaly is both a system and a brand, which is why it is the
 * system checked here.
 */

const LOGO = "img[src^='/brand-logos/']";

test("a card draws its brand's logo, named by its alt, or the name where there is none", async ({
  page,
}) => {
  await page.goto(BG.capsules);
  const cards = page.locator("main ul > li > article");
  expect(await cards.count()).toBeGreaterThan(5);

  const lines = await cards.evaluateAll((articles) =>
    articles.map((article) => {
      const logo = article.querySelector<HTMLImageElement>("[data-brand-logo] img");
      const text = article.querySelector("[data-brand-logo='text']");
      return { alt: logo?.alt ?? null, text: text?.textContent ?? null };
    }),
  );
  for (const line of lines) expect(line.alt ?? line.text, JSON.stringify(line)).toBeTruthy();

  const first = cards.first().locator(LOGO);
  await expect(first).toBeVisible();
  // Drawn at its fitted size, not at the file's.
  const box = await first.boundingBox();
  expect(box?.height).toBeLessThanOrEqual(40);
  expect(box?.height).toBeGreaterThanOrEqual(12);
});

test("the brand filter and its chip name brands in text; a system keeps its icon", async ({
  page,
}) => {
  // Caffitaly the brand makes Caffitaly capsules, so the listing is not empty.
  await page.goto(`${BG.capsules}?brand=lavazza,caffitaly&system=caffitaly`);

  // The rail on desktop, the disclosure's copy on a phone: the markup is the same.
  const group = (title: string) =>
    page
      .locator("main details")
      .filter({ has: page.locator("> summary", { hasText: new RegExp(`^${title}$`) }) })
      .first()
      .locator("a[aria-pressed]");
  const brands = group("Марка");
  expect(await brands.count()).toBeGreaterThan(0);
  for (const option of await brands.all()) {
    await expect(option.locator("[data-brand-logo]")).toHaveCount(0);
  }
  const systems = page.locator("a[aria-pressed][data-system]");
  expect(await systems.count()).toBeGreaterThan(0);
  for (const option of await systems.all()) {
    await expect(option.locator("[data-brand-logo]")).toHaveCount(0);
    await expect(option.locator("svg[data-system-icon]")).toHaveCount(1);
  }

  const chips = page.getByRole("list", { name: "Активни филтри" });
  const brandChip = chips.getByRole("link", { name: /^Lavazza/ });
  await expect(brandChip).toBeVisible();
  await expect(brandChip.locator("[data-brand-logo]")).toHaveCount(0);
  // Caffitaly twice: neither the brand's chip nor the system's draws a logo.
  await expect(chips.locator(LOGO)).toHaveCount(0);
  const systemChip = chips.locator("a[data-system='caffitaly']");
  await expect(systemChip).toBeVisible();
  await expect(systemChip.locator("[data-brand-logo]")).toHaveCount(0);
  await expect(systemChip.locator("svg[data-system-icon='caffitaly']")).toBeVisible();
});
