import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { BG, PRODUCT_LINK, expectProductPage } from "./support/paths";
import { asDistinctVisitor, waitForHydration } from "./support/hydration";

/**
 * The storefront's forms when the button is pressed.
 *
 * Every form validates with the zod schema its server action validates with:
 * in the browser (react-hook-form) when the button is pressed, and on the
 * server, which is the only check a page without JavaScript gets. The forms
 * carry `noValidate`, so the browser's own bubbles never show; our messages
 * stand under the fields instead, tied to them with `aria-describedby`.
 *
 * What these prove, for the quick order, the contact form (and the vending
 * page's enquiry, which is the same form) and the newsletter:
 *
 *   - with JavaScript, pressing the button with nothing filled in shows our
 *     message under every invalid field, puts focus on the first, and sends
 *     nothing; one bad value is named for what is wrong with it;
 *   - without JavaScript the same press is a POST, and the page comes back with
 *     the server's messages in the same places — the same sentences, word for
 *     word — and what was typed still in the fields;
 *   - with JavaScript, an error only the server can find still lands where the
 *     browser's would.
 *
 * The messages are written out, not imported from the schemas: a change of
 * wording is meant to fail here and be looked at.
 */

const MESSAGE = {
  phoneMissing: "Въведете телефонен номер, за да можем да ви се обадим.",
  phoneShort: "Въведете телефонен номер с поне 9 цифри.",
  emailMissing: "Въведете имейл адреса си.",
  emailFormat: "Въведете целия имейл адрес, например ivan@example.com.",
  nameMissing: "Въведете името си.",
  messageMissing: "Напишете съобщението си.",
  checkFields: "Поправете отбелязаните полета и изпратете отново.",
} as const;

/** The text of the error paragraph a field names in `aria-describedby`, or null. */
async function errorUnder(field: Locator): Promise<string | null> {
  const ids = ((await field.getAttribute("aria-describedby")) ?? "").split(/\s+/);
  const id = ids.find((value) => value.endsWith("-error"));
  if (!id) return null;
  return (await field.page().locator(`[id="${id}"]`).textContent())?.trim() ?? null;
}

async function expectError(field: Locator, message: string): Promise<void> {
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect.poll(() => errorUnder(field)).toBe(message);
}

/** Server-action POSTs from this page, counted as they leave. */
function countActions(page: Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) count += 1;
  });
  return () => count;
}

/**
 * A page with JavaScript off. After the first POST the page is the server's
 * answer, and a second press is made with Enter in a field, which is how most
 * people send a form anyway: on that answer page Playwright's click waits for
 * the button to hold still, and with scripts off and `scroll-behavior: smooth`
 * it never decides that it does (a forced click submits the same way).
 */
async function withoutScript<T>(browser: Browser, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await asDistinctVisitor(page);
  try {
    return await run(page);
  } finally {
    await context.close();
  }
}

/** The address of the first product on the capsule listing. */
async function aProduct(page: Page): Promise<string> {
  await page.goto(BG.capsules);
  const href = await page.locator(PRODUCT_LINK).first().getAttribute("href");
  expect(href).toBeTruthy();
  return href!;
}

test.describe("the quick order", () => {
  const orderForm = (page: Page) =>
    page.locator("form").filter({ hasText: /поръчка на една стъпка/i });
  const phone = (page: Page) => orderForm(page).getByLabel(/телефонен номер/i);
  const submit = (page: Page) => orderForm(page).getByRole("button", { name: /поискай обаждане/i });

  test("with JavaScript: our message under the phone, focus on it, nothing sent", async ({
    page,
  }) => {
    const product = await aProduct(page);
    await page.goto(product);
    await expectProductPage(page);
    await waitForHydration(page);
    const sent = countActions(page);

    expect(await orderForm(page).evaluate((form) => (form as HTMLFormElement).noValidate)).toBe(
      true,
    );
    await submit(page).click();
    await expectError(phone(page), MESSAGE.phoneMissing);
    await expect(phone(page)).toBeFocused();
    await expect(orderForm(page).getByText(MESSAGE.checkFields)).toBeVisible();

    // One bad value: the message names what is wrong, and follows the typing.
    await phone(page).fill("0888 12");
    await expectError(phone(page), MESSAGE.phoneShort);
    await submit(page).click();
    await expectError(phone(page), MESSAGE.phoneShort);
    await phone(page).fill("0888 123 456");
    await expect(phone(page)).not.toHaveAttribute("aria-invalid", "true");
    expect(sent()).toBe(0);
  });

  test("with JavaScript: an email in the optional fields is checked, and its fields open", async ({
    page,
  }) => {
    const product = await aProduct(page);
    await page.goto(product);
    await waitForHydration(page);
    const sent = countActions(page);

    await phone(page).fill("0888 123 456");
    // Open the disclosure, type a half address, close it again.
    const summary = orderForm(page).locator("summary");
    await summary.click();
    const email = orderForm(page).getByLabel("Имейл", { exact: true });
    await email.fill("ivan@");
    await summary.click();
    await expect(email).toBeHidden();

    await submit(page).click();
    await expect(email).toBeVisible();
    await expectError(email, MESSAGE.emailFormat);
    await expect(email).toBeFocused();
    expect(sent()).toBe(0);
  });

  test("without JavaScript: the server's messages, the same words, in the same place", async ({
    browser,
    page,
  }) => {
    const product = await aProduct(page);
    await withoutScript(browser, async (bare) => {
      await bare.goto(product);
      await submit(bare).click();
      await expectError(phone(bare), MESSAGE.phoneMissing);
      await expect(orderForm(bare).getByText(MESSAGE.checkFields)).toBeVisible();

      await phone(bare).fill("0888 12");
      await phone(bare).press("Enter");
      await expectError(phone(bare), MESSAGE.phoneShort);
      // What was typed came back with the answer.
      await expect(phone(bare)).toHaveValue("0888 12");

      // And the form still orders.
      await phone(bare).fill(
        `0886 ${String(Math.floor(Math.random() * 900) + 100)} ${String(Math.floor(Math.random() * 900) + 100)}`,
      );
      await phone(bare).press("Enter");
      await expect(bare.locator("#order").getByRole("status")).toContainText(
        /заявката е получена/i,
      );
    });
  });

  test("with JavaScript: a refusal only the server can make is shown in the form's line", async ({
    page,
  }) => {
    await asDistinctVisitor(page);
    const product = await aProduct(page);
    await page.goto(product);
    await waitForHydration(page);
    // The page's own field, pointed at a product that does not exist: the
    // browser cannot know, the server can.
    await orderForm(page)
      .locator('input[name="productSlug"]')
      .evaluate((input) => ((input as HTMLInputElement).value = "nyama-takav-produkt"));
    await phone(page).fill("0888 123 456");
    await submit(page).click();
    await expect(orderForm(page).locator("[aria-live]")).toContainText("Не намерихме този продукт");
    // The number stays in the field.
    await expect(phone(page)).toHaveValue("0888 123 456");
  });
});

test.describe("the contact form", () => {
  const contactForm = (page: Page) =>
    page.locator("main form").filter({ has: page.getByLabel(/^Съобщение/) });
  const field = (page: Page, label: RegExp) => contactForm(page).getByLabel(label);
  const submit = (page: Page) =>
    contactForm(page).getByRole("button", { name: "Изпрати съобщение" });

  const EMPTY: [RegExp, string][] = [
    [/^Вашето име/, MESSAGE.nameMissing],
    [/^Имейл/, MESSAGE.emailMissing],
    [/^Съобщение/, MESSAGE.messageMissing],
  ];

  test("with JavaScript: every empty required field is named, focus on the first", async ({
    page,
  }) => {
    await page.goto(BG.contact);
    await waitForHydration(page);
    const sent = countActions(page);

    await submit(page).click();
    for (const [label, message] of EMPTY) await expectError(field(page, label), message);
    await expect(field(page, /^Вашето име/)).toBeFocused();
    // The optional ones are not refused for being empty.
    await expect(field(page, /^Телефон/)).not.toHaveAttribute("aria-invalid", "true");

    await field(page, /^Вашето име/).fill("Мария");
    await expect(field(page, /^Вашето име/)).not.toHaveAttribute("aria-invalid", "true");
    await field(page, /^Имейл/).fill("maria.example.com");
    await expectError(field(page, /^Имейл/), MESSAGE.emailFormat);
    expect(sent()).toBe(0);
  });

  test("without JavaScript: the same messages from the server, and the text kept", async ({
    browser,
  }) => {
    await withoutScript(browser, async (bare) => {
      await bare.goto(BG.contact);
      await submit(bare).click();
      for (const [label, message] of EMPTY) await expectError(field(bare, label), message);

      await field(bare, /^Вашето име/).fill("Мария");
      await field(bare, /^Имейл/).fill("maria.example.com");
      await field(bare, /^Съобщение/).fill("Здравейте, имам въпрос за зърната.");
      await field(bare, /^Имейл/).press("Enter");
      await expectError(field(bare, /^Имейл/), MESSAGE.emailFormat);
      await expect(field(bare, /^Вашето име/)).not.toHaveAttribute("aria-invalid", "true");
      await expect(field(bare, /^Съобщение/)).toHaveValue("Здравейте, имам въпрос за зърната.");
      await expect(field(bare, /^Вашето име/)).toHaveValue("Мария");
    });
  });

  test("with JavaScript: the server's field error lands under the field, focused", async ({
    page,
  }) => {
    await asDistinctVisitor(page);
    await page.goto(BG.contact);
    await waitForHydration(page);
    /* The browser passes a good address; on the way out it is spoiled, so
       only the server can find the problem. */
    await page.route(
      (url) => url.pathname === BG.contact,
      async (route, request) => {
        if (request.method() !== "POST") return route.continue();
        const body = request.postData() ?? "";
        await route.continue({
          postData: body.replace("maria@example.test", "maria.example.test"),
        });
      },
    );
    await field(page, /^Вашето име/).fill("Мария");
    await field(page, /^Имейл/).fill("maria@example.test");
    await field(page, /^Съобщение/).fill("Здравейте, имам въпрос за зърната.");
    await submit(page).click();

    await expectError(field(page, /^Имейл/), MESSAGE.emailFormat);
    await expect(field(page, /^Имейл/)).toBeFocused();
    await expect(contactForm(page).getByText(MESSAGE.checkFields)).toBeVisible();
    await expect(field(page, /^Съобщение/)).toHaveValue("Здравейте, имам въпрос за зърната.");
  });

  test("on the vending page it arrives labelled, and is checked the same way", async ({ page }) => {
    await page.goto(BG.vending);
    await waitForHydration(page);
    await expect(field(page, /^Тема/)).toHaveValue("Запитване: вендинг зона");
    await submit(page).click();
    for (const [label, message] of EMPTY) await expectError(field(page, label), message);
    await expect(field(page, /^Вашето име/)).toBeFocused();
  });
});

test.describe("the newsletter band", () => {
  const band = (page: Page) => page.locator("aside[data-newsletter-band]");
  const email = (page: Page) => band(page).getByRole("textbox", { name: "Имейл адрес" });
  const submit = (page: Page) => band(page).getByRole("button", { name: "Абонирай ме" });

  test("with JavaScript: our message under the field, nothing sent", async ({ page }) => {
    await page.goto(BG.delivery);
    await waitForHydration(page);
    const sent = countActions(page);

    await submit(page).click();
    await expectError(email(page), MESSAGE.emailMissing);
    await expect(email(page)).toBeFocused();
    await email(page).fill("ivan@example");
    await submit(page).click();
    await expectError(email(page), MESSAGE.emailFormat);
    expect(sent()).toBe(0);
  });

  test("without JavaScript: the server says the same, and keeps the address", async ({
    browser,
  }) => {
    await withoutScript(browser, async (bare) => {
      await bare.goto(BG.delivery);
      await submit(bare).click();
      await expectError(email(bare), MESSAGE.emailMissing);

      await email(bare).fill("ivan@example");
      await email(bare).press("Enter");
      await expectError(email(bare), MESSAGE.emailFormat);
      await expect(email(bare)).toHaveValue("ivan@example");
    });
  });
});
