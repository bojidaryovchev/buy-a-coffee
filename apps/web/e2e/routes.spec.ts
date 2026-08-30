import { expect, test } from "@playwright/test";
import { expectNoSourceReference } from "./support/source-guard";

/** Every route the storefront promises, plus SEO endpoints and error states. */

test("the server under test is actually this storefront", async ({ page }) => {
  /*
   * A previous run reused an unrelated application that was listening on the
   * chosen port, and generic assertions passed against it. This canary makes
   * that failure mode impossible to miss.
   */
  await page.goto("/");
  await expect(page.locator(".skip-link")).toHaveCount(1);
  // The hero summary line: unique to this storefront and visible at every width,
  // unlike the navigation labels, which are hidden behind the drawer on mobile.
  await expect(page.getByText(/\d+ марки · \d+ продукта/)).toBeVisible();
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(blocks.join(" ")).toContain("WebSite");
});

const ROUTES = [
  "/",
  "/categories",
  "/brands",
  "/promotions",
  "/search",
  "/contact",
  "/journal",
  "/privacy",
  "/terms",
  "/cookies",
];

for (const route of ROUTES) {
  test(`${route} responds and renders a heading`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("404 page is a real 404 with a way forward", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");
  // The source site answers unknown routes with 200 and its home page; ours
  // must not repeat that mistake.
  expect(response?.status()).toBe(404);
  await expect(page.getByText(/не намерихме тази страница/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /началната страница/i })).toBeVisible();
});

test("sitemap lists real product URLs", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);

  const xml = await response.text();
  expect(xml).toContain("<urlset");
  expect(xml).toContain("/products/");
  expect(xml).toContain("/categories/");
  // A sitemap must never advertise the source site.
  expectNoSourceReference(xml, "sitemap");
  // Search results are not indexable and must not be listed.
  expect(xml).not.toContain("/search");
});

test("robots.txt points at our sitemap", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);

  const text = await response.text();
  expect(text.toLowerCase()).toContain("user-agent");
  expectNoSourceReference(text, "robots.txt");
});

test("legal pages state that they are drafts rather than pretending otherwise", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText(/този документ е чернова/i)).toBeVisible();
});

test("contact page exposes a working phone link", async ({ page }) => {
  await page.goto("/contact");
  // Scope to <main>: the header's phone link is hidden on small screens.
  const phoneLink = page.locator('main a[href^="tel:"]').first();
  await expect(phoneLink).toBeVisible();
});

test("security headers are present", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-frame-options"]).toBe("DENY");
});

test("the media route refuses to escape its storage root", async ({ request }) => {
  // Path traversal must be rejected, however it is encoded.
  for (const attempt of [
    "/media/..%2F..%2F..%2Fpackage.json",
    "/media/../../package.json",
  ]) {
    const response = await request.get(attempt, { maxRedirects: 0 });
    expect([400, 403, 404]).toContain(response.status());
  }
});
