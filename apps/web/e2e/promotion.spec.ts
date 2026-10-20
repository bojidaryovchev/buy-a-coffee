import { expect, test, type Page } from "@playwright/test";
import { createDatabase } from "@catalog/db";
import { asDistinctVisitor, waitForHydration } from "./support/hydration";
import { BG } from "./support/paths";

/**
 * The shop's own promotion, end to end, on a production build: the product
 * page, its structured data, and the cart, for a product a running promotion
 * reduces by 10%.
 *
 * The spec writes what it needs and takes it away again: a product of its own
 * — a copy of a real one, under a slug no page has ever been rendered at, so
 * no cached render can hide the promotion — and a promotion over it, its
 * 30-day price the regular one, so the whole 10% is announced. It runs in the
 * "after" project (`playwright.config.ts`), once every other spec is done: a
 * promotion changes what the promotions page lists while the sitemap, built
 * before it, does not, and nothing else should read the shop in between.
 *
 * The expected figures are worked out here from the regular price, in cents,
 * and the expected date with `Intl` in Sofia, not by the code under test.
 *
 * A file filter does not narrow the projects this one depends on, so on its
 * own it runs as `test:e2e --project after --no-deps e2e/promotion.spec.ts`.
 */

const OWNERS_NAME = "e2e: промоция на проверката";
const LABEL = "Есенни дни";
const SLUG_PREFIX = "e2e-promotsiya-";
const PERCENT = 10;
const DAY = 24 * 60 * 60 * 1000;

const url = process.env.DATABASE_URL;
let database: ReturnType<typeof createDatabase>;
let slug: string;
let productId: string;
let regularCents: number;
let endsAt: Date;

/** Cents as the shop prints them, without the currency: 2223 → "22,23". */
const euros = (cents: number) =>
  `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
/** A price on the page, whatever space `Intl` put before the sign. */
const price = (cents: number) => new RegExp(`${euros(cents)}\\s€`);

const reducedCents = () => Math.floor((regularCents * (100 - PERCENT)) / 100);

/** The Sofia date of the moment before the promotion ends: its last day. */
function lastDay(): { readonly words: string; readonly iso: string } {
  const last = new Date(endsAt.getTime() - 1);
  const words = new Intl.DateTimeFormat("bg-BG", {
    timeZone: "Europe/Sofia",
    day: "numeric",
    month: "long",
  }).format(last);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Sofia",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(last)
      .map((part) => [part.type, part.value]),
  );
  return { words, iso: `${parts.year}-${parts.month}-${parts.day}` };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  if (!url) throw new Error("DATABASE_URL: the spec writes its promotion to the build's database");
  database = createDatabase({ url, max: 1 });
  const { sql } = database;
  // Whatever an interrupted run left behind.
  await sql`delete from promotions where name = ${OWNERS_NAME}`;
  await sql`delete from products where slug like ${`${SLUG_PREFIX}%`}`;

  // A product the shop sells today at the source's price, with no struck price
  // of its own and under the free-delivery threshold.
  const [source] = await sql<Array<{ id: string }>>`
    select id from products
    where status = 'active' and availability = 'in_stock'
      and retail_price_override is null and old_price is null
      and current_price between 5 and 40
    order by slug desc
    limit 1`;
  if (!source) throw new Error("The catalog has no product to copy");

  slug = `${SLUG_PREFIX}${Date.now().toString(36)}`;
  const [copy] = await sql<Array<{ id: string; regular: string }>>`
    insert into products (
      source_site_id, source_key, source_url, source_path, name, slug, current_price,
      currency, availability, brand_id, weight, weight_value, weight_unit, semantic_hash,
      status, first_seen_at
    )
    select source_site_id, ${`/${slug}/`}, ${`https://example.invalid/${slug}/`}, ${`/${slug}/`},
      name, ${slug}, current_price, currency, availability, brand_id, weight, weight_value,
      weight_unit, ${slug}, 'active', now() - interval '90 days'
    from products where id = ${source.id}
    returning id, current_price::text as regular`;
  productId = copy!.id;
  const [whole, fraction = "0"] = copy!.regular.split(".");
  regularCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  endsAt = new Date(Date.now() + 6 * DAY);
  // Instants as ISO text: the client is set up for the application's types.
  const startsAt = new Date(Date.now() - DAY).toISOString();
  const [promotion] = await sql<Array<{ id: string }>>`
    insert into promotions (name, label, percent_off, starts_at, ends_at)
    values (${OWNERS_NAME}, ${LABEL}, ${PERCENT}, ${startsAt}::timestamptz,
      ${endsAt.toISOString()}::timestamptz)
    returning id`;
  await sql`
    insert into promotion_products (promotion_id, product_id, reference_price, reference_at, reference_final)
    values (${promotion!.id}, ${productId}, ${copy!.regular}, now(), true)`;
});

test.afterAll(async () => {
  if (!database) return;
  try {
    await database.sql`delete from promotions where name = ${OWNERS_NAME}`;
    await database.sql`delete from products where slug like ${`${SLUG_PREFIX}%`}`;
  } finally {
    await database.close();
  }
});

/** The product's page; the proxy may need a moment to learn a slug this new. */
async function openProduct(page: Page) {
  await expect(async () => {
    const response = await page.goto(`/bg/${slug}`);
    expect(response?.status()).toBe(200);
  }).toPass({ timeout: 30_000 });
}

test("the product page shows the reduction, the promotion's words, its last day and the 30-day note", async ({
  page,
}) => {
  await openProduct(page);
  const reduced = reducedCents();

  const summary = page.locator("main");
  await expect(summary.getByText(price(reduced)).first()).toBeVisible();
  const struck = summary.locator(".line-through").first();
  await expect(struck).toHaveText(price(regularCents));
  await expect(summary.getByText(`−${PERCENT}%`).first()).toBeVisible();

  const promotion = page.locator("[data-promotion]");
  await expect(promotion).toContainText(LABEL);
  await expect(promotion).toContainText(`до ${lastDay().words}`);
  await expect(promotion).toContainText(
    "Зачеркнатата цена е най-ниската ни цена за последните 30 дни преди намалението.",
  );

  // The owner's name for the promotion is nowhere in what the visitor receives.
  expect(await page.content()).not.toContain(OWNERS_NAME);

  // The offer is the promotion's price, valid through its last day.
  const data = JSON.parse((await page.locator("#ld-product").textContent()) ?? "{}") as {
    offers?: { price?: string; priceValidUntil?: string };
  };
  expect(data.offers).toMatchObject({
    price: `${Math.floor(reduced / 100)}.${String(reduced % 100).padStart(2, "0")}`,
    priceValidUntil: lastDay().iso,
  });
});

test("the cart strikes the line through and says what it saves, on the reduced sum", async ({
  page,
}) => {
  await asDistinctVisitor(page);
  await openProduct(page);
  await waitForHydration(page);
  const panel = page.locator("#order");
  await panel.getByRole("button", { name: "Един брой повече" }).click();
  await panel.getByRole("button", { name: /^Добави в количката$/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Добавено в количката" })).toBeVisible();

  await page.goto(BG.cart);
  const line = page.getByRole("listitem").filter({ has: page.getByRole("spinbutton") });
  await expect(line).toHaveCount(1);
  const reduced = reducedCents();
  await expect(line).toContainText(new RegExp(`Намалена цена ${euros(reduced)}\\s€ за брой`));
  await expect(line.locator(".line-through")).toHaveText(price(regularCents));
  await expect(line).toContainText(`−${PERCENT}%`);
  await expect(line).toContainText(`${LABEL} · до ${lastDay().words}`);
  // Two of them.
  await expect(line).toContainText(price(reduced * 2));

  const summary = page.getByRole("complementary", { name: "Сума и поръчка" });
  await expect(summary).toContainText(price(reduced * 2));
  await expect(summary).toContainText(
    new RegExp(`Спестявате\\s*${euros((regularCents - reduced) * 2)}\\s€`),
  );
  // The free-delivery threshold — the configured 49,00 €, written out as the
  // paths are — is measured against what is charged.
  const threshold = 4900;
  if (reduced * 2 < threshold) {
    await expect(summary).toContainText(
      new RegExp(`до тази сума остават ${euros(threshold - reduced * 2)}\\s€`),
    );
  }
  expect(await page.content()).not.toContain(OWNERS_NAME);
});
