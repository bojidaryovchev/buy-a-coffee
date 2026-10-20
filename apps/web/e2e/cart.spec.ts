import { expect, test, type Page } from "@playwright/test";
import { BG, PRODUCT_LINK, expectProductPage } from "./support/paths";
import { asDistinctVisitor, waitForHydration } from "./support/hydration";
import { aPhoneNumber, fillOrder, orderForm } from "./support/order-form";

/**
 * The cart, end to end: products added from a listing and from a product
 * page, the cart page asking the server what they cost, and one order request
 * for all of them, with who it is for and where it goes — written to our own
 * database.
 *
 * Every test starts with an empty cart: a Playwright context is a fresh
 * browser profile, so `localStorage` is empty.
 */

/** The add-to-cart buttons of the cards on a listing, once hydrated. */
const cardButtons = (page: Page) =>
  page.locator("main article").getByRole("button", { name: /^Добави в количката: / });

/**
 * Add the listing's `index`-th orderable product. A sold-out card has no such
 * button („Виж продукта“ instead), so every one found can be ordered.
 */
async function addFromListing(page: Page, index: number): Promise<void> {
  await cardButtons(page).nth(index).click();
  await expect(page.getByRole("status").filter({ hasText: "Добавено в количката" })).toBeVisible();
}

test("two products from a listing go into one order request, and the cart is emptied", async ({
  page,
}) => {
  await asDistinctVisitor(page);
  await page.goto(BG.capsules);
  await waitForHydration(page);

  await addFromListing(page, 0);
  await addFromListing(page, 1);
  await expect(page.getByRole("link", { name: "Количка, 2 броя" })).toBeVisible();

  await page.getByRole("link", { name: "Количка, 2 броя" }).click();
  await expect(page).toHaveURL(new RegExp(`${BG.cart}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Количка" })).toBeVisible();

  // The lines, priced by the server, and what they add up to.
  const lines = page.getByRole("list").filter({ has: page.getByRole("spinbutton") });
  await expect(lines.getByRole("listitem")).toHaveCount(2);
  const summary = page.getByRole("complementary", { name: "Сума и поръчка" });
  await expect(summary).toContainText("Сума на продуктите");
  await expect(summary).toContainText("(2 бр.)");

  // One more of the first.
  await page.getByRole("button", { name: "Един брой повече" }).first().click();
  await expect(summary).toContainText("(3 бр.)");

  // A name, a number of its own and a delivery: everything the form requires.
  await fillOrder(orderForm(page), aPhoneNumber());
  await summary.getByRole("button", { name: "Изпрати заявката" }).click();

  const answer = page.getByRole("status").filter({ hasText: "Заявката е получена" });
  await expect(answer).toBeVisible({ timeout: 15_000 });
  await expect(answer).toContainText(/Референция: [0-9A-F]{8}/);
  await expect(answer).toContainText(/ще ви се обадим/i);
  await expect(page.getByRole("heading", { name: "Какво поискахте" })).toBeVisible();

  // Sent, so nothing is left in the browser.
  await expect(page.getByRole("link", { name: "Количка", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("buy-a-coffee.cart"))).toBeNull();
});

test("a product page adds the chosen quantity, and „Поръчай“ then opens the cart without adding it again", async ({
  page,
}) => {
  await page.goto(BG.capsules);
  await page.locator(PRODUCT_LINK).first().click();
  await expectProductPage(page);
  await waitForHydration(page);

  const panel = page.locator("#order");
  await panel.getByRole("button", { name: "Един брой повече" }).click();
  await panel.getByRole("button", { name: /^Добави в количката$/ }).click();
  await expect(panel).toContainText("В количката: 2 бр.");
  await expect(page.getByRole("link", { name: "Количка, 2 броя" })).toBeVisible();

  // Already in the cart: „Поръчай“ goes to the order form and adds nothing.
  await panel.getByRole("button", { name: "Поръчай", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${BG.cart}$`));
  const summary = page.getByRole("complementary", { name: "Сума и поръчка" });
  await expect(summary).toContainText("(2 бр.)");
  await expect(orderForm(page)).toBeVisible();
});

/*
 * The header's cart link is on every page from the first paint, and the cart
 * page's order form brings react-hook-form and zod: fetched for being on the
 * screen, they came into every page as it loaded. It is fetched on intent
 * instead (`components/cart/cart-link.tsx`), still ahead of the click.
 */
test("the header's cart is fetched ahead when a pointer comes to it, not for being on the screen", async ({
  page,
}) => {
  const prefetched: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["next-router-prefetch"]) prefetched.push(new URL(request.url()).pathname);
  });
  await page.goto(BG.delivery);
  await waitForHydration(page);
  await page.waitForLoadState("networkidle");
  expect(prefetched).not.toContain(BG.cart);

  const cart = page.locator("header").getByRole("link", { name: "Количка" });
  await cart.hover();
  await expect.poll(() => prefetched.includes(BG.cart)).toBe(true);
  await cart.click();
  await expect(page).toHaveURL(BG.cart);
  await expect(page.getByRole("heading", { name: "Количката е празна" })).toBeVisible();
});

test("an empty cart says so and points back to the shelves", async ({ page }) => {
  await page.goto(BG.cart);
  await expect(page.getByRole("heading", { name: "Количката е празна" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Към каталога" })).toHaveAttribute(
    "href",
    BG.categories,
  );
});

test("the cart page is not for search engines and not in the sitemap", async ({
  page,
  request,
}) => {
  await page.goto(BG.cart);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/kolichka");
});

test("a product in the cart that the shop no longer has is shown and left out", async ({
  page,
}) => {
  await page.goto(BG.home);
  // A cart as the browser would hold it, naming a product that does not exist.
  await page.evaluate(() =>
    window.localStorage.setItem(
      "buy-a-coffee.cart",
      JSON.stringify({
        v: 1,
        lines: [
          {
            productId: "00000000-0000-4000-8000-000000000000",
            slug: "nyama-takav-produkt",
            quantity: 1,
          },
        ],
      }),
    ),
  );
  await page.goto(BG.cart);
  await expect(page.getByText("Продукт, който вече не е в каталога")).toBeVisible();
  await expect(page.getByText(/няма да влезе в заявката/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Няма какво да изпратим" })).toBeVisible();

  await page.getByRole("button", { name: /^Премахни/ }).click();
  await expect(page.getByRole("heading", { name: "Количката е празна" })).toBeVisible();
});
