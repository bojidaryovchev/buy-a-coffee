import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { BG } from "./support/paths";
import { asDistinctVisitor, waitForHydration } from "./support/hydration";
import { fillOrder, openCartWithAProduct, orderField, orderForm } from "./support/order-form";

/**
 * The storefront's forms when the button is pressed.
 *
 * Every form validates with the zod schema its server action validates with:
 * in the browser (react-hook-form) when the button is pressed, and on the
 * server, which is the only check a page without JavaScript gets. The forms
 * carry `noValidate`, so the browser's own bubbles never show; our messages
 * stand under the fields instead, tied to them with `aria-describedby`.
 *
 * What these prove, for the order form, the contact form (and the vending
 * page's enquiry, which is the same form) and the newsletter:
 *
 *   - with JavaScript, pressing the button with nothing filled in shows our
 *     message under every invalid field, puts focus on the first, and sends
 *     nothing; one bad value is named for what is wrong with it;
 *   - without JavaScript the same press is a POST, and the page comes back with
 *     the server's messages in the same places — the same sentences, word for
 *     word — and what was typed still in the fields. Not the order form: the
 *     cart it sends is in the browser, so without a script there is no form,
 *     and the page says so;
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
  lastNameMissing: "Въведете фамилията си.",
  courierMissing: "Изберете куриер.",
  cityMissing: "Въведете населеното място.",
  postcodeMissing: "Въведете пощенския код: 4 цифри, например 4000.",
  addressMissing: "Въведете улица и номер, или квартал, блок, вход и апартамент.",
  officeMissing: "Напишете кой офис или автомат, например „Пловдив Център“.",
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

test.describe("the order form", () => {
  const phone = (page: Page) => orderField(orderForm(page), "Телефонен номер");
  const submit = (page: Page) => orderForm(page).getByRole("button", { name: "Изпрати заявката" });

  test("with JavaScript: our messages under every required field, focus on the first, nothing sent", async ({
    page,
  }) => {
    await openCartWithAProduct(page);
    const form = orderForm(page);
    const sent = countActions(page);

    expect(await form.evaluate((element) => (element as HTMLFormElement).noValidate)).toBe(true);
    await submit(page).click();
    for (const [name, message] of [
      ["Име", MESSAGE.nameMissing],
      ["Фамилия", MESSAGE.lastNameMissing],
      ["Телефонен номер", MESSAGE.phoneMissing],
      ["Пощенски код", MESSAGE.postcodeMissing],
      ["Населено място", MESSAGE.cityMissing],
      ["Адрес", MESSAGE.addressMissing],
    ] as const) {
      await expectError(orderField(form, name), message);
    }
    // The courier's choices share one message, under the group.
    await expectError(form.getByRole("radio", { name: "Еконт" }), MESSAGE.courierMissing);
    await expect(orderField(form, "Име")).toBeFocused();
    await expect(form.getByText(MESSAGE.checkFields)).toBeVisible();

    // One bad value: the message names what is wrong, and follows the typing.
    await phone(page).fill("0888 12");
    await expectError(phone(page), MESSAGE.phoneShort);
    await submit(page).click();
    await expectError(phone(page), MESSAGE.phoneShort);
    await phone(page).fill("0888 123 456");
    await expect(phone(page)).not.toHaveAttribute("aria-invalid", "true");
    expect(sent()).toBe(0);
  });

  test("with JavaScript: a delivery to an office asks for the office, not for a street", async ({
    page,
  }) => {
    await openCartWithAProduct(page);
    const form = orderForm(page);
    const sent = countActions(page);

    await form.getByRole("radio", { name: "До офис или автомат" }).check();
    await expect(orderField(form, "Пощенски код")).toHaveCount(0);
    await expect(orderField(form, "Адрес")).toHaveCount(0);

    // BOX NOW delivers to its lockers only, so it is offered here, and the
    // field then asks for the locker.
    await form.getByRole("radio", { name: "BOX NOW" }).check();
    await submit(page).click();
    await expectError(orderField(form, "Автомат BOX NOW"), MESSAGE.officeMissing);

    // Back to an address: BOX NOW is no longer offered, nor left chosen.
    await form.getByRole("radio", { name: "До адрес" }).check();
    await expect(form.getByRole("radio", { name: "BOX NOW" })).toHaveCount(0);
    await expect(form.getByRole("radio", { name: "Еконт" })).not.toBeChecked();
    await expect(orderField(form, "Адрес")).toBeVisible();
    expect(sent()).toBe(0);
  });

  test("with JavaScript: an email in the optional fields is checked, and its fields open", async ({
    page,
  }) => {
    await openCartWithAProduct(page);
    const form = orderForm(page);
    const sent = countActions(page);

    await fillOrder(form, "0888 123 456");
    // Open the disclosure, type a half address, close it again.
    const summary = form.locator("summary");
    await summary.click();
    const email = form.getByLabel("Имейл", { exact: true });
    await email.fill("ivan@");
    await summary.click();
    await expect(email).toBeHidden();

    await submit(page).click();
    await expect(email).toBeVisible();
    await expectError(email, MESSAGE.emailFormat);
    await expect(email).toBeFocused();
    expect(sent()).toBe(0);
  });

  test("without JavaScript: no form that could not send, and the phone instead", async ({
    browser,
  }) => {
    await withoutScript(browser, async (bare) => {
      await bare.goto(BG.cart);
      await expect(bare.getByText(/Количката работи с включен JavaScript/)).toBeVisible();
      await expect(bare.locator('main a[href^="tel:"]').first()).toBeVisible();
      await expect(bare.getByRole("button", { name: "Изпрати заявката" })).toHaveCount(0);
    });
  });

  test("with JavaScript: a refusal only the server can make is shown in the form's line", async ({
    page,
  }) => {
    await asDistinctVisitor(page);
    await openCartWithAProduct(page);
    const form = orderForm(page);
    /* The browser sends a product it has; on the way out it becomes one the
       shop does not have, which only the server can find. */
    const productId = await page.evaluate(
      () =>
        (
          JSON.parse(window.localStorage.getItem("buy-a-coffee.cart") ?? "{}") as {
            lines: Array<{ productId: string }>;
          }
        ).lines[0]!.productId,
    );
    await page.route(
      (url) => url.pathname === BG.cart,
      async (route, request) => {
        if (request.method() !== "POST") return route.continue();
        const body = request.postData() ?? "";
        await route.continue({
          postData: body.replaceAll(productId, "00000000-0000-4000-8000-000000000000"),
        });
      },
    );
    await fillOrder(form, "0888 123 456");
    await submit(page).click();

    await expect(form.locator("[aria-live]")).toContainText("вече не се предлага");
    // What was typed stays in the fields.
    await expect(phone(page)).toHaveValue("0888 123 456");
    await expect(orderField(form, "Адрес")).toHaveValue("ул. Иван Вазов 12");
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
