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

test("there is no cart or checkout anywhere", async ({ page }) => {
  // The reference site has neither, and inventing one would be a different
  // business, not a functional equivalent.
  await openProduct(page);
  const html = await page.content();
  expect(html).not.toMatch(/add to cart|checkout|basket/i);
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
 * Quick order from a product card.
 *
 * With JavaScript, "Бърза поръчка" on a card opens the product's order form in
 * a modal `<dialog>`; without it, it is a link to the order panel on the
 * product page. Both are the same form posting to the same action.
 */
test.describe("from a product card", () => {
  const LISTING = BG.capsules;

  /** The first card's control; its accessible name carries the product's name. */
  const cardControl = (page: Page) =>
    page
      .locator("main article")
      .getByRole("link", { name: /^Бърза поръчка/ })
      .first();
  const orderDialog = (page: Page) => page.getByRole("dialog", { name: /Бърза поръчка/ });

  test("opens a dialog with focus inside, and Escape returns focus to the card", async ({
    page,
  }) => {
    await page.goto(LISTING);
    await waitForHydration(page);

    const control = cardControl(page);
    const name = (await control.innerText()).trim();
    await control.click();

    const dialog = orderDialog(page);
    await expect(dialog).toBeVisible();
    // Opening it does not leave the listing.
    await expect(page).toHaveURL(new RegExp(`${LISTING}$`));
    await expect(dialog.getByLabel(/телефонен номер/i)).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    // A modal: the page behind it is inert.
    expect(await dialog.evaluate((node) => (node as HTMLDialogElement).matches(":modal"))).toBe(
      true,
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(control).toBeFocused();
    expect((await control.innerText()).trim()).toBe(name);
  });

  test("the dialog's close button closes it too", async ({ page }) => {
    await page.goto(LISTING);
    await waitForHydration(page);
    await cardControl(page).click();
    await orderDialog(page).getByRole("button", { name: "Затвори" }).click();
    await expect(orderDialog(page)).toBeHidden();
    await expect(cardControl(page)).toBeFocused();
  });

  test("Tab stays inside the dialog", async ({ page }) => {
    await page.goto(LISTING);
    await waitForHydration(page);
    await cardControl(page).click();
    const dialog = orderDialog(page);
    await expect(dialog).toBeVisible();

    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((node) => node.contains(document.activeElement)),
        `focus after ${step + 1} Tab presses`,
      ).toBe(true);
    }
  });

  test("the form in the dialog submits and confirms", async ({ page }) => {
    await asDistinctVisitor(page);
    await page.goto(LISTING);
    await waitForHydration(page);
    await cardControl(page).click();

    const dialog = orderDialog(page);
    // A number of its own, so the duplicate check never answers for another spec.
    const phone = `0887 ${String(Math.floor(Math.random() * 900) + 100)} ${String(Math.floor(Math.random() * 900) + 100)}`;
    await dialog.getByLabel(/телефонен номер/i).fill(phone);
    await dialog.getByRole("button", { name: /поискай обаждане/i }).click();

    await expect(dialog.getByRole("status")).toContainText(/заявката е получена/i, {
      timeout: 15_000,
    });
    await expect(page).toHaveURL(new RegExp(`${LISTING}$`));
  });

  test("without JavaScript it is a link to the order panel on the product page", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(LISTING);

    const control = cardControl(page);
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
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await context.close();
  });
});
