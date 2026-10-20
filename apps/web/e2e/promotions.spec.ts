import { expect, test, type Page } from "@playwright/test";
import { withDatabase } from "./support/database";
import { asDistinctVisitor } from "./support/hydration";

/**
 * The owner's promotion, end to end: signed in, a new promotion of 10% on one
 * product, saved — and the shop shows the reduced price and the badge at
 * once, on the product page and on a listing that is a cached page (the
 * Lavazza beans landing, regenerated every 300 seconds), which only an
 * on-demand revalidation of the whole shop can explain. Then "Спри сега", and
 * the regular price is back on both, again at once.
 *
 * The product is chosen from the database: a Lavazza bean product on sale,
 * in stock, at the source's own price, and in no promotion yet — a product
 * that was in one would rightly show a smaller badge or none (its 30-day
 * lowest price includes that promotion's). What the spec creates it deletes
 * afterwards, straight from the database: a promotion that has started is
 * history the panel itself never deletes.
 *
 * Desktop only. A promotion is the whole shop's price, and the phone project
 * runs at the same time against the same database: its promotion would put a
 * second "−10%" on the related products of this one's page, and the checks
 * that the badge is there, and then gone, would be reading the other run.
 */

/** What `playwright.config.ts` gives the server it starts; not a real password. */
const ADMIN_PASSWORD = "e2e-only-not-a-real-password";
const LANDING = "/bg/kafe-na-zarna-lavazza";
const NAME_PREFIX = "e2e promotion";

const euro = new Intl.NumberFormat("bg-BG", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A price as the shop writes it, as a pattern that does not care which space it uses. */
function priceText(amount: string): RegExp {
  return new RegExp(escape(euro.format(Number(amount))).replace(/\s/g, "\\s"));
}

/** 10% off, rounded down to the cent, in exact cents. */
function tenPercentOff(amount: string): string {
  const cents = BigInt(amount.replace(".", ""));
  const reduced = (cents * 90n) / 100n;
  return `${reduced / 100n}.${String(reduced % 100n).padStart(2, "0")}`;
}

interface Candidate {
  id: string;
  slug: string;
  price: string;
  /** As stored, to put back afterwards. */
  first_seen_at: string;
}

async function chooseProduct(): Promise<Candidate> {
  const rows = await withDatabase(
    (sql) => sql<Candidate[]>`
      select p.id, p.slug, p.current_price::text as price, p.first_seen_at::text
      from products p
      join brands b on b.id = p.brand_id
      join product_categories pc on pc.product_id = p.id
      join categories c on c.id = pc.category_id
      where p.status = 'active'
        and p.availability = 'in_stock'
        and p.current_price is not null
        and p.retail_price_override is null
        and p.old_price is null
        and b.slug = 'lavazza'
        and c.slug = 'kafe-na-zarna'
        and not exists (select 1 from promotion_products pp where pp.product_id = p.id)
      order by p.slug
      limit 1
    `,
  );
  const candidate = rows[0];
  if (!candidate) throw new Error("no Lavazza bean product left that was never in a promotion");
  return candidate;
}

/**
 * A product the shop has had for months. A development catalog seeded today
 * has had every product for minutes, and a product in the shop for less than
 * 30 days rightly gets the reduced price with no badge (no 30-day price to
 * compare with); the spec is about the badge, so it gives its product a past.
 */
async function establish(product: Candidate): Promise<void> {
  await withDatabase(
    (sql) =>
      sql`update products set first_seen_at = least(first_seen_at, now() - interval '90 days') where id = ${product.id}`,
  );
}

async function signIn(page: Page): Promise<void> {
  await asDistinctVisitor(page);
  await page.goto("/admin/vhod");
  await page.getByLabel("Парола").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Вход" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** The product's card on the cached landing. */
const landingCard = (page: Page, slug: string) =>
  page.locator("main article").filter({ has: page.locator(`a[href="/bg/${slug}"]`) });

/** The name this run's promotion was given, for the clean-up. */
let created: string | null = null;

/** The product this run gave a past, as it was, to put back. */
let established: Candidate | null = null;

test.afterAll(async () => {
  const name = created;
  const product = established;
  await withDatabase(async (sql) => {
    if (name) await sql`delete from promotions where name = ${name}`;
    if (product) {
      await sql`update products set first_seen_at = ${product.first_seen_at}::timestamptz where id = ${product.id}`;
    }
  });
});

test("a promotion the owner saves is the shop's price at once, and stopping it brings the price back", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one promotion at a time: see above");
  test.setTimeout(120_000);
  const product = await chooseProduct();
  await establish(product);
  established = product;
  const regular = priceText(product.price);
  const reduced = priceText(tenPercentOff(product.price));

  // The cached listing, before: the regular price, and the shop's name for it.
  await page.goto(LANDING);
  await expect(landingCard(page, product.slug)).toContainText(regular);
  const title = (await landingCard(page, product.slug).getByRole("heading").innerText()).trim();

  await signIn(page);
  await page.goto("/admin/promotsii");
  await page.getByRole("link", { name: "Нова промоция" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Нова промоция" })).toBeVisible();

  created = `${NAME_PREFIX} ${Date.now()}`;
  await page.getByRole("textbox", { name: /^Име/ }).fill(created);
  // 10% and today to a week from today are the form's own choices.
  await expect(page.getByRole("button", { name: "10%" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Добави продукт…" }).click();
  await page.getByRole("searchbox", { name: "Търсене" }).fill(title);
  // Its button names it with its pack ("Добави: Lavazza …, Кафе на зърна, 1 кг"),
  // so a longer name that starts the same is not taken for it.
  await page.getByRole("button", { name: new RegExp(`^Добави: ${escape(title)},`) }).click();
  await page.getByRole("button", { name: "Готово" }).click();

  const preview = page.getByRole("region", { name: "Как ще изглежда в магазина" });
  await expect(preview).toContainText("Ще бъдат намалени 1 продукт");
  await expect(preview.getByRole("cell", { name: "−10%" })).toBeVisible();
  await expect(preview).toContainText(reduced);

  await page.getByRole("button", { name: "Запази промоцията" }).click();
  await expect(page).toHaveURL(/\/admin\/promotsii\/[0-9a-f-]{36}\?izvestie=zapazena$/);
  await expect(page.getByText("Тече", { exact: true })).toBeVisible();
  const editor = page.url().replace(/\?.*$/, "");

  // The product page: the reduced price, the regular one struck, the badge.
  await page.goto(`/bg/${product.slug}`);
  const main = page.locator("main");
  await expect(main).toContainText(reduced);
  await expect(main.locator(".line-through").first()).toContainText(regular);
  await expect(main).toContainText("−10%");
  // And the cached listing, without waiting out its five minutes.
  await page.goto(LANDING);
  await expect(landingCard(page, product.slug)).toContainText(reduced);
  await expect(landingCard(page, product.slug)).toContainText("−10%");

  // Stop it.
  await page.goto(editor);
  await page.getByText("Спри сега", { exact: true }).click();
  await page.getByRole("button", { name: "Да, спри я сега" }).click();
  await expect(page).toHaveURL(/\?izvestie=spryana$/);
  await expect(page.getByText("Спряна", { exact: true })).toBeVisible();

  await page.goto(`/bg/${product.slug}`);
  await expect(main).toContainText(regular);
  await expect(main).not.toContainText("−10%");
  await expect(main).not.toContainText(reduced);
  await page.goto(LANDING);
  await expect(landingCard(page, product.slug)).toContainText(regular);
  await expect(landingCard(page, product.slug)).not.toContainText("−10%");
});
