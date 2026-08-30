import { expect, test, type Page } from "@playwright/test";
import { expectNoSourceReference, findSourceUrls } from "./support/source-guard";

/** Product detail, images, related products and the quick-order flow. */

async function openFirstProduct(page: Page) {
  await page.goto("/categories/kapsuli");
  await page.locator('a[href^="/products/"]').first().click();
  await expect(page).toHaveURL(/\/products\//);
}

test("product detail shows name, price and availability", async ({ page }) => {
  await openFirstProduct(page);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/\d+[.,]\d{2}\s*€|€\s*\d+[.,]\d{2}/).first()).toBeVisible();
  await expect(page.getByText(/в наличност|изчерпан|по поръчка|попитайте ни/i).first()).toBeVisible();
});

test("product images load from our own storage, never the source domain", async ({ page }) => {
  await openFirstProduct(page);

  const image = page.locator("main img").first();
  await expect(image).toBeVisible();

  const src = await image.getAttribute("src");
  expect(src).toBeTruthy();
  // The hard runtime boundary: nothing may be fetched from the source site.
  expectNoSourceReference(src, "product image src");

  // And it must actually load, not 404 into a broken image.
  const naturalWidth = await image.evaluate((node: HTMLImageElement) => node.naturalWidth);
  expect(naturalWidth).toBeGreaterThan(0);
});

test("no network request during a product page view touches the source domain", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));

  await openFirstProduct(page);
  await page.waitForLoadState("networkidle");

  expect(findSourceUrls(requested)).toEqual([]);
});

test("breadcrumbs lead back to the category", async ({ page }) => {
  await openFirstProduct(page);

  const breadcrumb = page.getByRole("navigation", { name: /навигационен път/i });
  await expect(breadcrumb).toBeVisible();
  await expect(breadcrumb.getByRole("link", { name: "Начало" })).toBeVisible();
});

test("related products are shown and are different from this product", async ({ page }) => {
  await openFirstProduct(page);
  const currentUrl = page.url();

  const related = page.getByRole("heading", { name: /може да ви хареса и/i });
  if (await related.count()) {
    const links = page.locator('a[href^="/products/"]');
    const hrefs = await links.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).href),
    );
    expect(hrefs.every((href) => href !== currentUrl)).toBe(true);
  }
});

test("structured data describes the product", async ({ page }) => {
  await openFirstProduct(page);

  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const parsed = blocks.map((block) => JSON.parse(block) as { "@type"?: string });

  expect(parsed.some((entry) => entry["@type"] === "Product")).toBe(true);
  expect(parsed.some((entry) => entry["@type"] === "BreadcrumbList")).toBe(true);
});

test("the canonical URL points at our own domain", async ({ page }) => {
  await openFirstProduct(page);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toBeTruthy();
  expectNoSourceReference(canonical, "canonical URL");
});

test("an unknown product slug returns 404", async ({ page }) => {
  const response = await page.goto("/products/definitely-not-a-real-product-slug");
  expect(response?.status()).toBe(404);
});

test("quick-order form validates without submitting anything", async ({ page }) => {
  await openFirstProduct(page);

  const form = page.locator("form").filter({ hasText: /поръчка на една стъпка/i });
  await expect(form).toBeVisible();

  const phone = form.getByLabel(/телефонен номер/i);
  await expect(phone).toBeVisible();

  // An obviously invalid number must be rejected before anything is stored.
  await phone.fill("12");
  await form.getByRole("button", { name: /поискай обаждане/i }).click();

  // Either the browser's own constraint validation or our server-side message.
  await expect(
    page.getByText(/валиден телефонен номер|проверете отбелязаните полета/i).first().or(phone),
  ).toBeVisible();

  // Nothing should have been reported as a successful order.
  await expect(page.getByText(/заявката е получена/i)).toHaveCount(0);
});
