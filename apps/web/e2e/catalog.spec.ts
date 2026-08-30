import { expect, test } from "@playwright/test";

/**
 * Catalog browsing.
 *
 * These run against the synchronised database, so they assert behaviour rather
 * than fixed counts — the catalog is live and its size changes.
 */

test("home page loads and shows catalog-driven sections", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The hero states the real catalog size, which proves the page is data-driven.
  await expect(page.getByText(/\d+ марки · \d+ продукта/)).toBeVisible();
  await expect(page.getByRole("link", { name: /разгледайте асортимента/i })).toBeVisible();
});

test("category navigation reaches a listing with products", async ({ page }) => {
  await page.goto("/categories");
  await expect(page.getByRole("heading", { name: /разгледайте по вид/i })).toBeVisible();

  // Scope to <main>: the header's category rail is hidden on small screens,
  // so the first match in DOM order is not the one a visitor can click.
  const firstCategory = page.locator('main a[href^="/categories/"]').first();
  await firstCategory.click();

  await expect(page).toHaveURL(/\/categories\//);
  await expect(page.locator('main a[href^="/products/"]').first()).toBeVisible();
});

test("a category lists synchronised products with prices", async ({ page }) => {
  await page.goto("/categories/kapsuli");

  const productLinks = page.locator('a[href^="/products/"]');
  await expect(productLinks.first()).toBeVisible();
  expect(await productLinks.count()).toBeGreaterThan(0);

  // Prices come from the catalog and are formatted, never raw decimals.
  await expect(page.getByText(/\d+[.,]\d{2}\s*€|€\s*\d+[.,]\d{2}/).first()).toBeVisible();
});

test("filtering by brand changes the result set and the URL", async ({ page }) => {
  await page.goto("/categories/kapsuli");

  const countText = page.locator("p", { hasText: /продукт/ }).first();
  const before = await countText.innerText();

  // The desktop sidebar is hidden on mobile, so drive the filter through the URL,
  // which is the contract these filters are built on.
  await page.goto("/categories/kapsuli?brand=lavazza");
  await expect(page).toHaveURL(/brand=lavazza/);

  const after = await countText.innerText();
  expect(after).not.toBe(before);

  // The active filter is shown and removable.
  await expect(page.getByRole("link", { name: /премахни филтъра/i }).first()).toBeVisible();
});

test("filters are shareable: a filtered URL renders server-side", async ({ page }) => {
  const response = await page.goto("/categories/kapsuli?brand=lavazza&strength=strong");
  expect(response?.status()).toBe(200);
  // The products must be in the initial HTML, not fetched by client script.
  const html = await response!.text();
  expect(html).toContain('href="/products/');
});

test("clearing filters returns to the unfiltered listing", async ({ page }) => {
  await page.goto("/categories/kapsuli?brand=lavazza");
  // The chip-row control is visible at every breakpoint; the sidebar's is not.
  await page.getByRole("link", { name: "Изчисти всички", exact: true }).click();
  await expect(page).not.toHaveURL(/brand=/);
});

test("pagination links work and are crawlable", async ({ page }) => {
  await page.goto("/categories/kapsuli");
  const next = page.getByRole("link", { name: "Напред" });

  if (await next.count()) {
    await next.click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('a[href^="/products/"]').first()).toBeVisible();
  }
});

test("sorting by price changes the order", async ({ page }) => {
  await page.goto("/categories/kapsuli?sort=price-asc");
  const first = await page.locator('a[href^="/products/"]').first().getAttribute("href");

  await page.goto("/categories/kapsuli?sort=price-desc");
  const other = await page.locator('a[href^="/products/"]').first().getAttribute("href");

  expect(first).not.toBe(other);
});

test("an impossible filter combination shows a helpful empty state", async ({ page }) => {
  await page.goto("/categories/kapsuli?brand=does-not-exist");
  await expect(page.getByText(/няма продукти по тези филтри/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /изчисти филтрите/i })).toBeVisible();
});

test("brand index and brand pages work", async ({ page }) => {
  await page.goto("/brands");
  await expect(page.getByRole("heading", { name: /марките, които предлагаме/i })).toBeVisible();

  await page.locator('a[href^="/brands/"]').first().click();
  await expect(page).toHaveURL(/\/brands\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("promotions route renders even with no active offers", async ({ page }) => {
  // The capability exists on the reference site with an empty list; a 404 here
  // would be a broken link rather than an honest empty state.
  const response = await page.goto("/promotions");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /актуални промоции/i })).toBeVisible();
});

test("malformed filter parameters do not break the page", async ({ page }) => {
  const response = await page.goto(
    "/categories/kapsuli?page=abc&pageSize=99999&sort=<script>&brand=,,,,",
  );
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
