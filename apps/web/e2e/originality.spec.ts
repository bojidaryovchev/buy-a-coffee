import { expect, test } from "@playwright/test";
import { expectNoSourceReference, findSourceUrls } from "./support/source-guard";

/**
 * Originality and the runtime data boundary, asserted against rendered pages.
 *
 * The static check (`pnpm check:originality`) scans source files. This is the
 * complement: it inspects what a real browser actually receives and requests,
 * which is what would catch branding leaking in through data rather than code.
 */

const PAGES = ["/", "/categories/kapsuli", "/brands", "/promotions", "/contact"];

for (const route of PAGES) {
  test(`${route} carries no source branding in the rendered HTML`, async ({ page }) => {
    await page.goto(route);
    expectNoSourceReference(await page.content(), `rendered HTML of ${route}`);
  });
}

test("no request during a full browse touches the source domain", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.goto("/categories/kapsuli");
  await page.waitForLoadState("networkidle");
  await page.locator('a[href^="/products/"]').first().click();
  await page.waitForLoadState("networkidle");

  expect(findSourceUrls(requested)).toEqual([]);
});

test("every rendered image points at our own infrastructure", async ({ page }) => {
  await page.goto("/categories/kapsuli");

  const sources = await page.locator("img").evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLImageElement).getAttribute("src") ?? ""),
  );

  expect(sources.length).toBeGreaterThan(0);
  expect(findSourceUrls(sources)).toEqual([]);
});

test("our own brand name is what the visitor sees", async ({ page }) => {
  await page.goto("/");
  const title = await page.title();
  expectNoSourceReference(title, "page title");
  expect(title.length).toBeGreaterThan(0);
});
