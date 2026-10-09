import { expect, test, type Page } from "@playwright/test";
import { PRODUCT_LINK, expectProductPage } from "./support/paths";

/** Search behaviour against our own PostgreSQL catalog. */

/**
 * The header field.
 *
 * Located by name rather than by role on purpose: the server-rendered fallback
 * is a plain `searchbox`, and hydration turns it into a `combobox` once the
 * typeahead is attached. A role-based locator would be racing that swap.
 */
const searchInput = (page: Page) => page.locator('input[name="q"]').first();

/**
 * The header field once the interactive one has replaced the fallback.
 *
 * The swap replaces the `<input>` element, so text typed into the fallback
 * before it happens is lost (reported as an app defect). A spec that types
 * into the field to test the typeahead waits for the typeahead first.
 */
async function interactiveSearchInput(page: Page) {
  const field = searchInput(page);
  await expect(field).toHaveAttribute("role", "combobox");
  return field;
}

test("search page loads with no query", async ({ page }) => {
  await page.goto("/bg/tarsene");
  await expect(page.getByRole("heading", { name: "Търсене", exact: true })).toBeVisible();
  await expect(page.getByText(/какво търсите/i)).toBeVisible();
});

test("searching a known brand returns matching products", async ({ page }) => {
  await page.goto("/bg/tarsene?q=lavazza");

  await expect(page.getByText(/резултата? за/i)).toBeVisible();
  const links = page.locator(PRODUCT_LINK);
  await expect(links.first()).toBeVisible();
  expect(await links.count()).toBeGreaterThan(0);
});

test("search works from the header field", async ({ page }) => {
  await page.goto("/");
  const field = await interactiveSearchInput(page);
  await field.fill("lavazza");
  await field.press("Enter");

  await expect(page).toHaveURL(/\/bg\/tarsene\?q=lavazza/);
  await expect(page.locator(PRODUCT_LINK).first()).toBeVisible();
});

test("search matches Cyrillic product names", async ({ page }) => {
  // The catalog is Bulgarian; Latin-only search would find almost nothing.
  await page.goto("/bg/tarsene?q=" + encodeURIComponent("Капсули"));
  await expect(page.locator(PRODUCT_LINK).first()).toBeVisible();
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
  await page.goto("/bg/tarsene?q=" + encodeURIComponent("крема"));

  const links = page.locator(PRODUCT_LINK);
  await expect(links.first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).first()).toContainText(/crema/i);
});

test("a Latin query finds Cyrillic product names", async ({ page }) => {
  // "kapsuli" must reach the products written „Капсули".
  await page.goto("/bg/tarsene?q=kapsuli");

  await expect(page.locator(PRODUCT_LINK).first()).toBeVisible();
  // A card is headed by brand and line; that the result is a capsule is in
  // its address, which carries the format.
  await expect(page.getByRole("heading", { level: 3 }).first().getByRole("link")).toHaveAttribute(
    "href",
    /-kapsuli-/,
  );
});

test("both scripts return the same result count", async ({ page }) => {
  const countFor = async (query: string): Promise<number> => {
    await page.goto("/bg/tarsene?q=" + encodeURIComponent(query));
    const heading = await page
      .getByText(/резултата? за/i)
      .first()
      .textContent();
    return Number(heading?.match(/\d+/)?.[0] ?? -1);
  };

  const latin = await countFor("rema");
  expect(latin).toBeGreaterThan(0);
  expect(await countFor("рема")).toBe(latin);
});

test("a misspelled query still finds the product", async ({ page }) => {
  // One letter short of "lavazza" — the trigram fallback has to cover this.
  await page.goto("/bg/tarsene?q=lavaza");
  await expect(page.locator(PRODUCT_LINK).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).first()).toContainText(/lavazza/i);
});

/*
 * Phonetic spellings.
 *
 * Folding handles transliteration, not how Bulgarians write Italian: „Лаваца"
 * folds to `lavatsa`, not `lavazza`. A hand-kept synonym list closes that gap,
 * and it has to do so identically on the results page and in the dropdown.
 */
test("a phonetic Cyrillic brand spelling finds the brand's products", async ({ page }) => {
  await page.goto("/bg/tarsene?q=" + encodeURIComponent("лаваца"));

  await expect(page.locator(PRODUCT_LINK).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).first()).toContainText(/lavazza/i);
});

test("a phonetic spelling returns the same count as the Latin one", async ({ page }) => {
  const countFor = async (query: string): Promise<number> => {
    await page.goto("/bg/tarsene?q=" + encodeURIComponent(query));
    const heading = await page
      .getByText(/резултата? за/i)
      .first()
      .textContent();
    return Number(heading?.match(/\d+/)?.[0] ?? -1);
  };

  const latin = await countFor("lavazza");
  expect(latin).toBeGreaterThan(0);
  expect(await countFor("лаваца")).toBe(latin);
  expect(await countFor("неспресо")).toBe(await countFor("nespresso"));
});

test("a synonym inside a longer query still works", async ({ page }) => {
  await page.goto("/bg/tarsene?q=" + encodeURIComponent("капсули лаваца"));

  await expect(page.locator(PRODUCT_LINK).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).first()).toContainText(/lavazza/i);
});

test("a phonetic spelling of a brewing system finds its capsules", async ({ page }) => {
  // The supplier names Dolce Gusto capsules "DG"; the spelled-out Cyrillic
  // name has to reach them. The card shows our name, so the system is read
  // from the product's address.
  await page.goto("/bg/tarsene?q=" + encodeURIComponent("долче густо"));
  await expect(page.locator(PRODUCT_LINK).first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).first().getByRole("link")).toHaveAttribute(
    "href",
    /-kapsuli-dolce-gusto-/,
  );
});

test("a nonsense query shows a helpful no-results state", async ({ page }) => {
  await page.goto("/bg/tarsene?q=zzzzqqqqxxxx");
  // It names the term, so a typo is visible, and offers a way forward.
  await expect(page.getByRole("heading", { name: "Не намерихме „zzzzqqqqxxxx“" })).toBeVisible();
  await expect(page.locator(`main ${PRODUCT_LINK}`)).toHaveCount(0);
  // In <main>: the header rail has a link of the same name.
  await expect(
    page.locator("main").getByRole("link", { name: "Намери по машина" }),
  ).toHaveAttribute("href", "/bg/za-kafemashina");
});

test("search results are not indexable", async ({ page }) => {
  // Unbounded user-generated URLs must not be crawled.
  await page.goto("/bg/tarsene?q=lavazza");
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  expect(robots).toContain("noindex");
});

test("an over-long query is handled safely", async ({ page }) => {
  const response = await page.goto("/bg/tarsene?q=" + "a".repeat(2000));
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a query containing SQL syntax is treated as text", async ({ page }) => {
  const response = await page.goto(
    "/bg/tarsene?q=" + encodeURIComponent("'; drop table products; --"),
  );
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Prove the catalog is intact afterwards.
  await page.goto("/bg/kafe-kapsuli");
  await expect(page.locator(PRODUCT_LINK).first()).toBeVisible();
});

test.describe("typeahead", () => {
  test("suggests products with images as you type", async ({ page }) => {
    await page.goto("/");
    await (await interactiveSearchInput(page)).fill("lavazza");

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
    await (await interactiveSearchInput(page)).fill("крема");

    const listbox = page.getByRole("listbox", { name: /предложения/i });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option").first()).toContainText(/crema/i);
  });

  test("suggests for a phonetic spelling, like the results page", async ({ page }) => {
    await page.goto("/");
    await (await interactiveSearchInput(page)).fill("лаваца");

    const listbox = page.getByRole("listbox", { name: /предложения/i });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option").first()).toContainText(/lavazza/i);
  });

  test("suggestions and results agree for a phonetic spelling", async ({ page, request }) => {
    const query = encodeURIComponent("лаваца");
    const suggested = await (await request.get("/api/search/suggest?q=" + query)).json();
    expect(suggested.total).toBeGreaterThan(0);

    await page.goto("/bg/tarsene?q=" + query);
    const heading = await page
      .getByText(/резултата? за/i)
      .first()
      .textContent();
    expect(Number(heading?.match(/\d+/)?.[0])).toBe(suggested.total);
  });

  test("the keyboard alone can reach a product", async ({ page }) => {
    await page.goto("/");
    const field = await interactiveSearchInput(page);
    await field.fill("lavazza");
    await expect(page.getByRole("listbox", { name: /предложения/i })).toBeVisible();

    await field.press("ArrowDown");
    // Focus stays on the input; `aria-activedescendant` is what moves.
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("aria-activedescendant", /.+/);

    await field.press("Enter");
    await expectProductPage(page);
  });

  test("Escape closes the dropdown without running the search", async ({ page }) => {
    await page.goto("/");
    const field = await interactiveSearchInput(page);
    await field.fill("lavazza");
    await expect(page.getByRole("listbox", { name: /предложения/i })).toBeVisible();

    await field.press("Escape");
    await expect(page.getByRole("listbox", { name: /предложения/i })).toBeHidden();
    await expect(page).toHaveURL(/\/bg$/);
  });

  test("Enter with nothing highlighted runs the full search", async ({ page }) => {
    await page.goto("/");
    const field = await interactiveSearchInput(page);
    await field.fill("lavazza");
    await expect(page.getByRole("listbox", { name: /предложения/i })).toBeVisible();

    await field.press("Enter");
    await expect(page).toHaveURL(/\/bg\/tarsene\?q=lavazza/);
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

    await page.goto("/bg/tarsene?q=rema");
    const heading = await page
      .getByText(/резултата? за/i)
      .first()
      .textContent();
    expect(Number(heading?.match(/\d+/)?.[0])).toBe(suggested.total);
  });
});
