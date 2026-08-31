import { expect, test } from "@playwright/test";

/**
 * The recommendation wizard.
 *
 * Run against the synchronised database, so these assert behaviour rather than
 * fixed products — the catalog is live. What they pin down is the part that
 * must not regress: compatibility is never guessed, the flow works without
 * JavaScript, and a contradiction is stated rather than hidden.
 */

test("the wizard walks from brew method to a recommendation", async ({ page }) => {
  await page.goto("/wizard");
  await expect(
    page.getByRole("heading", { level: 1, name: /как правите кафето си/i }),
  ).toBeVisible();

  await page
    .locator("main")
    .getByRole("link", { name: /с капсули/i })
    .click();
  await expect(page).toHaveURL(/brew=capsule/);
  await expect(page.getByRole("heading", { level: 1, name: /коя система/i })).toBeVisible();

  // Pick whichever system is first; the catalog decides which are offered.
  await page.locator('main a[href*="system="]').first().click();
  await expect(page).toHaveURL(/system=/);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();

  /*
   * A system with almost nothing in it skips straight to the result rather
   * than asking four questions to narrow three products.
   */
  if (!page.url().includes("/wizard/result")) {
    const main = page.locator("main");
    await main.getByRole("link", { name: /класическо еспресо/i }).click();
    await main.getByRole("link", { name: /3–5 чаши/i }).click();
    await main.getByRole("link", { name: /баланс между цена и вкус/i }).click();
  }

  await expect(page).toHaveURL(/\/wizard\/result/);
  await expect(page.locator('main a[href^="/products/"]').first()).toBeVisible();
});

test("every recommendation explains itself and shows a price per cup", async ({ page }) => {
  await page.goto(
    "/wizard/result?system=nespresso-original&taste=intense&volume=regular&budget=cheap",
  );

  // Named, because the page also carries a breadcrumb list.
  const cards = page.getByRole("list", { name: "Препоръки" }).locator("> li");
  expect(await cards.count()).toBeGreaterThan(0);

  // The reason phrases are what separate advice from a filter in a costume.
  await expect(
    cards
      .first()
      .getByText(/силно и наситено|интензивност|на чаша/i)
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/на чаша/).first()).toBeVisible();
});

test("an answer we cannot honour is stated, not hidden", async ({ page }) => {
  // Caffitaly holds no decaffeinated product, so the requirement must be relaxed.
  await page.goto("/wizard/result?system=caffitaly&requirements=decaf");

  await expect(page.getByText(/не можахме да изпълним всичко/i)).toBeVisible();
  await expect(page.getByText(/съдържа кофеин/i).first()).toBeVisible();
});

test("answers stay in the URL and can be changed one at a time", async ({ page }) => {
  await page.goto("/wizard?brew=capsule&system=nespresso-original&taste=intense");

  const chip = page.getByRole("link", { name: /силно и наситено/i }).first();
  await expect(chip).toBeVisible();
  await chip.click();

  // Removing one answer returns to that question with the others intact.
  await expect(page).toHaveURL(/system=nespresso-original/);
  await expect(page).not.toHaveURL(/taste=/);
});

test("the machine finder answers which capsule a model takes", async ({ page }) => {
  await page.goto("/wizard/machines");
  await expect(page.getByRole("heading", { level: 1, name: /коя капсула пасва/i })).toBeVisible();

  await page.locator('main a[href="/wizard/machines/krups"]').click();
  await expect(page).toHaveURL(/\/wizard\/machines\/krups/);

  // One brand, three incompatible systems: the reason this page exists.
  await expect(page.getByRole("heading", { name: "Dolce Gusto" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nespresso Original" })).toBeVisible();

  await page.getByRole("link", { name: /изберете кафе за dolce gusto/i }).click();
  await expect(page).toHaveURL(/system=dolce-gusto/);
});

test("a machine we cannot supply gets a straight answer", async ({ page }) => {
  await page.goto("/wizard/machines/nespresso");

  await expect(page.getByRole("heading", { name: /не предлагаме кафе/i })).toBeVisible();
  await expect(page.getByText(/vertuo чете баркод/i)).toBeVisible();
});

test("the wizard works with JavaScript disabled", async ({ browser }) => {
  /*
   * Not a nicety: the answers live in the URL and every control is a link, so
   * this is the contract the whole flow is built on. If it ever needs
   * JavaScript, something has been rebuilt as client state by accident.
   */
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto("/wizard");
  // Scoped to <main>: the header rail carries a category link of the same name.
  await page
    .locator("main")
    .getByRole("link", { name: /^на зърна/i })
    .click();

  // Beans imply their system, so the next question is about taste.
  await expect(page).toHaveURL(/system=beans/);
  await page
    .locator("main")
    .getByRole("link", { name: /класическо еспресо/i })
    .click();
  await expect(page).toHaveURL(/taste=classic/);

  await context.close();
});
