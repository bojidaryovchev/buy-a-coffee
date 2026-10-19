import { expect, type Locator, type Page } from "@playwright/test";
import { waitForHydration } from "./hydration";
import { BG } from "./paths";

/**
 * The order form: the cart page's, the one form every order is sent from.
 *
 * It asks who the order is for, a phone number and where it goes (to an
 * address, or to a courier's office or locker), so a spec that sends an order
 * fills all of it; `fillOrder` does that the way a customer would.
 */

/** The form, in the cart page's summary. */
export const orderForm = (page: Page): Locator =>
  page.getByRole("complementary", { name: "Сума и поръчка" }).locator("form");

/**
 * A text field of the order form, by its label.
 *
 * By role and accessible name rather than `getByLabel`: a required field's
 * label ends in a mark (`*`) that is hidden from the accessible name but not
 * from the label's text, and „Име“ is the start of „Имейл“.
 */
export const orderField = (form: Locator, name: string): Locator =>
  form.getByRole("textbox", { name, exact: true });

/** A number of its own, so the duplicate check never answers for another spec. */
export function aPhoneNumber(prefix = "0887"): string {
  const three = () => String(Math.floor(Math.random() * 900) + 100);
  return `${prefix} ${three()} ${three()}`;
}

/** Everything the form requires, for a delivery by Econt to an address. */
export async function fillOrder(form: Locator, phone: string): Promise<void> {
  await orderField(form, "Име").fill("Иван");
  await orderField(form, "Фамилия").fill("Петров");
  await orderField(form, "Телефонен номер").fill(phone);
  // „До адрес“ is chosen to begin with.
  await form.getByRole("radio", { name: "Еконт" }).check();
  await orderField(form, "Пощенски код").fill("4000");
  await orderField(form, "Населено място").fill("Пловдив");
  await orderField(form, "Адрес").fill("ул. Иван Вазов 12");
}

/** Put the capsule listing's first orderable product in the cart, and open the cart. */
export async function openCartWithAProduct(page: Page): Promise<void> {
  await page.goto(BG.capsules);
  await waitForHydration(page);
  await page
    .locator("main article")
    .getByRole("button", { name: /^Добави в количката: / })
    .first()
    .click();
  await expect(page.getByRole("status").filter({ hasText: "Добавено в количката" })).toBeVisible();
  await page.goto(BG.cart);
  await waitForHydration(page);
  // Drawn once the server has said what the cart's product is and costs.
  await expect(orderForm(page)).toBeVisible();
}
