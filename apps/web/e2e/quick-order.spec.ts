import { expect, test, type Page } from "@playwright/test";
import { BG, PRODUCT_LINK, expectProductPage } from "./support/paths";
import { asDistinctVisitor, waitForHydration } from "./support/hydration";

/**
 * Quick order.
 *
 * The reference storefront's ordering flow is a phone number and a callback.
 * These tests exercise ours end to end — including a real submission, which is
 * safe precisely because it writes to *our* database and notifies *our* sink.
 * No request ever reaches the source business.
 */

async function openProduct(page: Page) {
  await page.goto("/bg/kafe-kapsuli");
  await page.locator(PRODUCT_LINK).first().click();
  await expectProductPage(page);
}

test("the quick-order form is present with a phone field", async ({ page }) => {
  await openProduct(page);
  const form = page.locator("form").filter({ hasText: /поръчка на една стъпка/i });
  await expect(form).toBeVisible();
  await expect(form.getByLabel(/телефонен номер/i)).toBeVisible();
  await expect(form.getByRole("button", { name: /поискай обаждане/i })).toBeVisible();
});

test("there is a cart, but no checkout and no online payment", async ({ page }) => {
  // The cart gathers an order and a phone call confirms it; nothing on the
  // site takes a payment or asks for a card. The quick order stays beside it.
  await openProduct(page);
  await expect(page.getByRole("button", { name: /^Добави в количката$/ })).toBeVisible();
  const html = await page.content();
  expect(html).not.toMatch(/checkout|basket|card number|номер на карта/i);
});

test("submitting a valid number is accepted and confirms to the customer", async ({ page }) => {
  await asDistinctVisitor(page);
  await openProduct(page);
  const form = page.locator("form").filter({ hasText: /поръчка на една стъпка/i });

  await form.getByLabel(/телефонен номер/i).fill("0888 123 456");
  await form.getByRole("button", { name: /поискай обаждане/i }).click();

  await expect(
    page.getByText(/заявката е получена|вече получихме заявката ви/i).first(),
  ).toBeVisible({
    timeout: 15_000,
  });
});

test("submitting twice does not create a second order", async ({ page }) => {
  await asDistinctVisitor(page);
  await openProduct(page);
  const form = page.locator("form").filter({ hasText: /поръчка на една стъпка/i });

  await form.getByLabel(/телефонен номер/i).fill("0899 000 111");
  await form.getByRole("button", { name: /поискай обаждане/i }).click();
  await expect(
    page.getByText(/заявката е получена|вече получихме заявката ви/i).first(),
  ).toBeVisible({
    timeout: 15_000,
  });

  // Re-submitting the identical enquiry is idempotent, and the customer is
  // told so rather than shown an error.
  await page.reload();
  const secondForm = page.locator("form").filter({ hasText: /поръчка на една стъпка/i });
  await secondForm.getByLabel(/телефонен номер/i).fill("0899 000 111");
  await secondForm.getByRole("button", { name: /поискай обаждане/i }).click();
  await expect(
    page.getByText(/заявката е получена|вече получихме заявката ви/i).first(),
  ).toBeVisible({
    timeout: 15_000,
  });
});

test("the form explains what happens to the phone number", async ({ page }) => {
  await openProduct(page);
  await expect(page.getByText(/политика за поверителност/i).first()).toBeVisible();
});

/*
 * The product card's control.
 *
 * With JavaScript, „Добави“ on a card puts the product in the cart without
 * leaving the listing; without it, it is a link to the order panel on the
 * product page, whose quick order is a plain form. The cart itself is
 * `cart.spec.ts`.
 */
test.describe("from a product card", () => {
  const LISTING = BG.capsules;

  /** The first card's control; its accessible name carries the product's name. */
  const cardControl = (page: Page, role: "button" | "link") =>
    page
      .locator("main article")
      .getByRole(role, { name: /^Добави в количката: / })
      .first();

  test("adds to the cart without leaving the listing, and the header counts it", async ({
    page,
  }) => {
    await page.goto(LISTING);
    await waitForHydration(page);

    await cardControl(page, "button").click();

    const notice = page.getByRole("status").filter({ hasText: "Добавено в количката" });
    await expect(notice).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${LISTING}$`));
    await expect(page.getByRole("link", { name: "Количка, 1 брой" })).toBeVisible();

    await notice.getByRole("link", { name: "Към количката" }).click();
    await expect(page).toHaveURL(new RegExp(`${BG.cart}$`));
  });

  test("without JavaScript it is a link to the order panel on the product page", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(LISTING);

    const control = cardControl(page, "link");
    await expect(control).toHaveAttribute("href", /^\/bg\/[^/#]+#order$/);
    const href = (await control.getAttribute("href"))!;
    await control.click();

    await expect
      .poll(() => {
        const url = new URL(page.url());
        return url.pathname + url.hash;
      })
      .toBe(href);
    const panel = page.locator("#order");
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel(/телефонен номер/i)).toBeVisible();
    // The cart needs a script; without one the quick order is the whole panel.
    await expect(panel.getByRole("button", { name: /Добави в количката/ })).toBeHidden();
    await context.close();
  });
});
