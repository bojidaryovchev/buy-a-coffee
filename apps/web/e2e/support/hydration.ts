import { expect, type Page } from "@playwright/test";

/**
 * Wait until the page has hydrated.
 *
 * Several controls are links in the server's HTML and become something else
 * once React has attached: the menu trigger is a link to `/categories` that
 * turns into a drawer button, and a card's "Бърза поръчка" is a link to the
 * product page's order panel that turns into a dialog opener. A spec that
 * clicks one of them before hydration follows the link instead — correct
 * behaviour, but not the behaviour under test, and a race.
 *
 * The signal is the menu trigger gaining `role="button"`, which it does only
 * in the client render. It is in the header of every shop page (hidden from
 * `md` up, but present), and the whole page hydrates as one root, so once it
 * has switched the card controls have too.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await expect(page.locator('header a[aria-label="Меню"]')).toHaveAttribute("role", "button");
}

/**
 * Make this page a visitor of its own.
 *
 * The order form is rate limited per client, and the client is the forwarded
 * address plus the user agent. Every spec that submits runs from the same
 * machine with the same browser, and the limiter's buckets live in the
 * database, so without this a second run within the window — or Playwright's
 * own retry — would be refused for reasons that have nothing to do with the
 * behaviour under test. An address from a documentation range per test keeps
 * each one inside the limit, as a real visitor is; two tests drawing the same
 * one is harmless, since the limit is several submissions.
 */
export async function asDistinctVisitor(page: Page): Promise<void> {
  const range = Math.random() < 0.5 ? "198.51.100" : "203.0.113";
  const host = Math.floor(Math.random() * 254) + 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `${range}.${host}` });
}
