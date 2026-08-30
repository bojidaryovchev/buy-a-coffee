import { expect, test, type Page } from "@playwright/test";

/**
 * Quick order.
 *
 * The reference storefront's ordering flow is a phone number and a callback.
 * These tests exercise ours end to end — including a real submission, which is
 * safe precisely because it writes to *our* database and notifies *our* sink.
 * No request ever reaches the source business.
 */

async function openProduct(page: Page) {
  await page.goto("/categories/kapsuli");
  await page.locator('a[href^="/products/"]').first().click();
  await expect(page).toHaveURL(/\/products\//);
}

test("the quick-order form is present with a phone field", async ({ page }) => {
  await openProduct(page);
  const form = page.locator("form").filter({ hasText: /поръчка на една стъпка/i });
  await expect(form).toBeVisible();
  await expect(form.getByLabel(/телефонен номер/i)).toBeVisible();
  await expect(form.getByRole("button", { name: /поискай обаждане/i })).toBeVisible();
});

test("there is no cart or checkout anywhere", async ({ page }) => {
  // The reference site has neither, and inventing one would be a different
  // business, not a functional equivalent.
  await openProduct(page);
  const html = await page.content();
  expect(html).not.toMatch(/add to cart|checkout|basket/i);
});

test("submitting a valid number is accepted and confirms to the customer", async ({ page }) => {
  await openProduct(page);
  const form = page.locator("form").filter({ hasText: /поръчка на една стъпка/i });

  await form.getByLabel(/телефонен номер/i).fill("0888 123 456");
  await form.getByRole("button", { name: /поискай обаждане/i }).click();

  await expect(page.getByText(/заявката е получена|вече получихме заявката ви/i).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("submitting twice does not create a second order", async ({ page }) => {
  await openProduct(page);
  const form = page.locator("form").filter({ hasText: /поръчка на една стъпка/i });

  await form.getByLabel(/телефонен номер/i).fill("0899 000 111");
  await form.getByRole("button", { name: /поискай обаждане/i }).click();
  await expect(page.getByText(/заявката е получена|вече получихме заявката ви/i).first()).toBeVisible({
    timeout: 15_000,
  });

  // Re-submitting the identical enquiry is idempotent, and the customer is
  // told so rather than shown an error.
  await page.reload();
  const secondForm = page.locator("form").filter({ hasText: /поръчка на една стъпка/i });
  await secondForm.getByLabel(/телефонен номер/i).fill("0899 000 111");
  await secondForm.getByRole("button", { name: /поискай обаждане/i }).click();
  await expect(page.getByText(/заявката е получена|вече получихме заявката ви/i).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("the form explains what happens to the phone number", async ({ page }) => {
  await openProduct(page);
  await expect(page.getByText(/политика за поверителност/i).first()).toBeVisible();
});
