import { expect, test, type Page } from "@playwright/test";

/** Search behaviour against our own PostgreSQL catalog. */

/**
 * The header field.
 *
 * Located by name rather than by role on purpose: the server-rendered fallback
 * is a plain `searchbox`, and hydration turns it into a `combobox` once the
 * typeahead is attached. A role-based locator would be racing that swap.
 */
const searchInput = (page: Page) => page.locator('input[name="q"]').first();

test("search page loads with no query", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByRole("heading", { name: "Търсене", exact: true })).toBeVisible();
  await expect(page.getByText(/какво търсите/i)).toBeVisible();
});

test("searching a known brand returns matching products", async ({ page }) => {
  await page.goto("/search?q=lavazza");

  await expect(page.getByText(/резултата? за/i)).toBeVisible();
  const links = page.locator('a[href^="/products/"]');
  await expect(links.first()).toBeVisible();
  expect(await links.count()).toBeGreaterThan(0);
});

test("search works from the header field", async ({ page }) => {
  await page.goto("/");
  const field = searchInput(page);
  await field.fill("lavazza");
  await field.press("Enter");

  await expect(page).toHaveURL(/\/search\?q=lavazza/);
  await expect(page.locator('a[href^="/products/"]').first()).toBeVisible();
});

test("search matches Cyrillic product names", async ({ page }) => {
  // The catalog is Bulgarian; Latin-only search would find almost nothing.
  await page.goto("/search?q=" + encodeURIComponent("Капсули"));
  await expect(page.locator('a[href^="/products/"]').first()).toBeVisible();
});

/*
 * Cross-script search.
 *
 * Product names mix the two alphabets in one string — "Капсули Nespresso Rema
 * Caffè Cookies" — and nobody switches keyboard layout mid-search. Both of
 * these have to find the same products, whichever way round the visitor types.
 */
test("a Cyrillic query finds Latin product names", async ({ page }) => {
  // „крема" must reach the products written "Crema".
  await page.goto("/search?q=" + encodeURIComponent("крема"));

  const links = page.locator('a[href^="/products/"]');
  await expect(links.first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).first()).toContainText(/crema/i);
});

test("a Latin query finds Cyrillic product names", async ({ page }) => {
  // "kapsuli" must reach the products written „Капсули".
  await page.goto("/search?q=kapsuli");

  await expect(page.locator('a[href^="/products/"]').first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).first()).toContainText(/капсули/i);
});

test("both scripts return the same result count", async ({ page }) => {
  const countFor = async (query: string): Promise<number> => {
    await page.goto("/search?q=" + encodeURIComponent(query));
    const heading = await page.getByText(/резултата? за/i).first().textContent();
    return Number(heading?.match(/\d+/)?.[0] ?? -1);
  };

  const latin = await countFor("rema");
  expect(latin).toBeGreaterThan(0);
  expect(await countFor("рема")).toBe(latin);
});

test("a misspelled query still finds the product", async ({ page }) => {
  // One letter short of "lavazza" — the trigram fallback has to cover this.
  await page.goto("/search?q=lavaza");
  await expect(page.locator('a[href^="/products/"]').first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).first()).toContainText(/lavazza/i);
});

test("a nonsense query shows a helpful no-results state", async ({ page }) => {
  await page.goto("/search?q=zzzzqqqqxxxx");
  await expect(page.getByText(/няма съвпадения за/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /разгледай категориите/i })).toBeVisible();
});

test("search results are not indexable", async ({ page }) => {
  // Unbounded user-generated URLs must not be crawled.
  await page.goto("/search?q=lavazza");
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  expect(robots).toContain("noindex");
});

test("an over-long query is handled safely", async ({ page }) => {
  const response = await page.goto("/search?q=" + "a".repeat(2000));
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a query containing SQL syntax is treated as text", async ({ page }) => {
  const response = await page.goto("/search?q=" + encodeURIComponent("'; drop table products; --"));
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Prove the catalog is intact afterwards.
  await page.goto("/categories/kapsuli");
  await expect(page.locator('a[href^="/products/"]').first()).toBeVisible();
});

test.describe("typeahead", () => {
  test("suggests products with images as you type", async ({ page }) => {
    await page.goto("/");
    await searchInput(page).fill("lavazza");

    const listbox = page.getByRole("listbox", { name: /предложения/i });
    await expect(listbox).toBeVisible();

    const options = listbox.getByRole("option");
    expect(await options.count()).toBeGreaterThan(1);
    // A picture per product is the point of the dropdown, not decoration.
    await expect(options.first().locator("img")).toBeVisible();
    // And the last row always offers the full result set.
    await expect(listbox.getByRole("option", { name: /виж всички/i })).toBeVisible();
  });

  test("suggests across scripts, like the results page", async ({ page }) => {
    await page.goto("/");
    await searchInput(page).fill("крема");

    const listbox = page.getByRole("listbox", { name: /предложения/i });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option").first()).toContainText(/crema/i);
  });

  test("the keyboard alone can reach a product", async ({ page }) => {
    await page.goto("/");
    const field = searchInput(page);
    await field.fill("lavazza");
    await expect(page.getByRole("listbox", { name: /предложения/i })).toBeVisible();

    await field.press("ArrowDown");
    // Focus stays on the input; `aria-activedescendant` is what moves.
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("aria-activedescendant", /.+/);

    await field.press("Enter");
    await expect(page).toHaveURL(/\/products\//);
  });

  test("Escape closes the dropdown without running the search", async ({ page }) => {
    await page.goto("/");
    const field = searchInput(page);
    await field.fill("lavazza");
    await expect(page.getByRole("listbox", { name: /предложения/i })).toBeVisible();

    await field.press("Escape");
    await expect(page.getByRole("listbox", { name: /предложения/i })).toBeHidden();
    await expect(page).toHaveURL("/");
  });

  test("Enter with nothing highlighted runs the full search", async ({ page }) => {
    await page.goto("/");
    const field = searchInput(page);
    await field.fill("lavazza");
    await expect(page.getByRole("listbox", { name: /предложения/i })).toBeVisible();

    await field.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=lavazza/);
  });

  test("the suggest endpoint treats LIKE wildcards as text", async ({ request }) => {
    // If `%` reached the pattern unescaped, this would match the whole catalog.
    const response = await request.get("/api/search/suggest?q=" + encodeURIComponent("%%"));
    expect(response.status()).toBe(200);
    expect((await response.json()).total).toBe(0);
  });

  test("the suggest endpoint ignores a term too short to be useful", async ({ request }) => {
    const response = await request.get("/api/search/suggest?q=a");
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ total: 0, products: [] });
  });

  test("suggestions and results agree", async ({ page, request }) => {
    // A dropdown offering something the results page cannot find is a bug.
    const suggested = await (await request.get("/api/search/suggest?q=rema")).json();
    expect(suggested.total).toBeGreaterThan(0);

    await page.goto("/search?q=rema");
    const heading = await page.getByText(/резултата? за/i).first().textContent();
    expect(Number(heading?.match(/\d+/)?.[0])).toBe(suggested.total);
  });
});
