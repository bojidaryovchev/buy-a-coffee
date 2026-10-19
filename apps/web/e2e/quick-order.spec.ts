import { expect, test, type Page } from "@playwright/test";
import { BG, PRODUCT_LINK, expectProductPage } from "./support/paths";
import { asDistinctVisitor, waitForHydration } from "./support/hydration";
import { aPhoneNumber, fillOrder, orderForm } from "./support/order-form";

/**
 * Ordering one product: „Поръчай“ on its page, the cart's form, the answer.
 *
 * Every order is sent from one form, the cart's, and asks who it is for and
 * where it goes (the owner's decision of 19 October 2026, which retired the
 * product page's phone-only quick order this file was written for). „Поръчай“
 * is the product page's way into it. These tests exercise it end to end —
 * including a real submission, which is safe precisely because it writes to
 * *our* database and notifies *our* sink. No request ever reaches the source
 * business.
 */

async function openProduct(page: Page) {
  await page.goto(BG.capsules);
  await page.locator(PRODUCT_LINK).first().click();
  await expectProductPage(page);
  await waitForHydration(page);
}

/** „Поръчай“ on the product page, to the cart and its form. */
async function orderThisProduct(page: Page) {
  await page.locator("#order").getByRole("button", { name: "Поръчай", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${BG.cart}$`));
  await expect(orderForm(page)).toBeVisible();
}

const answer = (page: Page) => page.getByRole("status").filter({ hasText: "Заявката е получена" });

test("there is a cart, but no checkout and no online payment", async ({ page }) => {
  // The cart gathers an order and a phone call confirms it; nothing on the
  // site takes a payment or asks for a card.
  await openProduct(page);
  await expect(page.getByRole("button", { name: /^Добави в количката$/ })).toBeVisible();
  const html = await page.content();
  expect(html).not.toMatch(/checkout|basket|card number|номер на карта/i);
});

test("„Поръчай“ puts the product in the cart and opens the form, which sends the order", async ({
  page,
}) => {
  await asDistinctVisitor(page);
  await openProduct(page);
  await orderThisProduct(page);

  // This one product, once.
  const summary = page.getByRole("complementary", { name: "Сума и поръчка" });
  await expect(summary).toContainText("(1 бр.)");

  await fillOrder(orderForm(page), aPhoneNumber("0899"));
  await orderForm(page).getByRole("button", { name: "Изпрати заявката" }).click();

  await expect(answer(page)).toBeVisible({ timeout: 15_000 });
  await expect(answer(page)).toContainText(/Референция: [0-9A-F]{8}/);
  await expect(answer(page)).toContainText(/ще ви се обадим/i);
});

test("sending the same order twice does not create a second one", async ({ page }) => {
  await asDistinctVisitor(page);
  const phone = aPhoneNumber("0899");
  /* The duplicate check works in five-minute windows, so two presses that
     straddle the edge of one are two orders. Only presses inside one window
     must come back as the same order. */
  const window = () => Math.floor(Date.now() / (5 * 60_000));
  const started = window();

  await openProduct(page);
  const product = page.url();
  await orderThisProduct(page);
  await fillOrder(orderForm(page), phone);
  await orderForm(page).getByRole("button", { name: "Изпрати заявката" }).click();
  await expect(answer(page)).toBeVisible({ timeout: 15_000 });
  const first = await answer(page).textContent();

  // The cart was emptied by the first; the same product, the same customer.
  await page.goto(product);
  await waitForHydration(page);
  await orderThisProduct(page);
  await fillOrder(orderForm(page), phone);
  await orderForm(page).getByRole("button", { name: "Изпрати заявката" }).click();
  await expect(answer(page)).toBeVisible({ timeout: 15_000 });

  if (window() === started) {
    // Told so, rather than shown an error, and under the first one's reference.
    await expect(answer(page)).toContainText("Вече получихме заявката ви");
    const reference = /Референция: ([0-9A-F]{8})/.exec(first ?? "")?.[1];
    expect(reference).toBeTruthy();
    await expect(answer(page)).toContainText(`Референция: ${reference}`);
  }
});

test("the form explains what the details are used for", async ({ page }) => {
  await openProduct(page);
  await orderThisProduct(page);
  const form = orderForm(page);
  await expect(form).toContainText("Използваме данните ви само за тази поръчка");
  await expect(form.getByRole("link", { name: "политика за поверителност" })).toHaveAttribute(
    "href",
    BG.privacy,
  );
});

/*
 * The product card's control.
 *
 * With JavaScript, „Добави“ on a card puts the product in the cart without
 * leaving the listing; without it, it is a link to the order panel on the
 * product page, which then offers the phone, since the cart needs a script.
 * The cart itself is `cart.spec.ts`.
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

  test("without JavaScript it is a link to the order panel, which offers the phone", async ({
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
    // The cart needs a script; without one the panel says so and gives the number.
    await expect(panel).toContainText("Поръчките се изпращат от количката");
    await expect(panel.locator('a[href^="tel:"]')).toBeVisible();
    await expect(panel.getByRole("button", { name: /Добави в количката/ })).toBeHidden();
    await expect(panel.getByRole("button", { name: "Поръчай", exact: true })).toBeHidden();
    // And no form that could not send.
    await expect(panel.locator("form")).toHaveCount(0);
    await context.close();
  });
});
