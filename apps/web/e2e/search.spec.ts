import { expect, test } from "@playwright/test";

/** Search behaviour against our own PostgreSQL catalog. */

test("search page loads with no query", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Търсене", exact: true })).toBeVisible();
  await expect(page.getByText(/какво търсите/i)).toBeVisible();
});

test("searching a known brand returns matching products", async ({ page }) => {
  await page.goto("/search?q=lavazza");

  await expect(page.getByText(/резултата? за/i)).toBeVisible();
  const links = page.locator('a[href^="/products/"]');
  await expect(links.first()).toBeVisible();
  expect(await links.count()).toBeGreaterThan(0);
});

test("search works from the header field", async ({ page }) => {
  await page.goto("/");
  const field = page.getByRole("searchbox").first();
  await field.fill("lavazza");
  await field.press("Enter");

  await expect(page).toHaveURL(/\/search\?q=lavazza/);
  await expect(page.locator('a[href^="/products/"]').first()).toBeVisible();
});

test("search matches Cyrillic product names", async ({ page }) => {
  // The catalog is Bulgarian; Latin-only search would find almost nothing.
  await page.goto("/search?q=" + encodeURIComponent("Капсули"));
  await expect(page.locator('a[href^="/products/"]').first()).toBeVisible();
});

test("a nonsense query shows a helpful no-results state", async ({ page }) => {
  await page.goto("/search?q=zzzzqqqqxxxx");
  await expect(page.getByText(/няма съвпадения за/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /разгледай категориите/i })).toBeVisible();
});

test("search results are not indexable", async ({ page }) => {
  // Unbounded user-generated URLs must not be crawled.
  await page.goto("/search?q=lavazza");
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  expect(robots).toContain("noindex");
});

test("an over-long query is handled safely", async ({ page }) => {
  const response = await page.goto("/search?q=" + "a".repeat(2000));
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a query containing SQL syntax is treated as text", async ({ page }) => {
  const response = await page.goto("/search?q=" + encodeURIComponent("'; drop table products; --"));
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Prove the catalog is intact afterwards.
  await page.goto("/categories/kapsuli");
  await expect(page.locator('a[href^="/products/"]').first()).toBeVisible();
});
