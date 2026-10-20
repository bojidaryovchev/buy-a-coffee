import { expect, test, type Page } from "@playwright/test";
import { withDatabase } from "./support/database";

/**
 * The owner's monthly job, in a real browser against the real build: sign in,
 * start the month's letter from "Нов бюлетин", see its new arrivals drawn as
 * products, take one out, and watch the preview follow — the product gone
 * from the letter a subscriber would get — then save.
 *
 * The catalog the build reads holds no arrivals of its own (a seeded copy,
 * every product imported at once), so the spec records three of its products
 * as created by an ordinary sync run, as the sync would, and takes the run
 * and the drafts it made away again afterwards — through
 * `support/database.ts`, which writes only to a database on this machine. Nothing is sent: the build
 * has no Resend key, and no button that sends is pressed.
 *
 * The password is the throwaway one `playwright.config.ts` gives the server
 * it starts. Desktop only: the composer is the owner's desk, and two
 * projects editing the same catalog rows at once would test the race, not
 * the screen.
 */

const PASSWORD = "e2e-only-not-a-real-password";

let runId: string | null = null;
let seeded: string[] = [];
const drafts: string[] = [];

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL || process.env.E2E_BASE_URL) return;
  await withDatabase(async (sql) => {
    const rows = await sql<{ id: string; slug: string; source_site_id: string }[]>`
      select p.id, p.slug, p.source_site_id
      from products p
      where p.status = 'active' and p.availability = 'in_stock' and p.current_price is not null
        and exists (select 1 from product_images i where i.product_id = p.id)
      order by p.slug
      limit 3
    `;
    if (rows.length < 3) return;
    const [run] = await sql<{ id: string }[]>`
      insert into sync_runs (source_site_id, status, dry_run)
      values (${rows[0]!.source_site_id}, 'succeeded', false)
      returning id
    `;
    runId = run!.id;
    for (const row of rows) {
      await sql`
        insert into sync_changes (sync_run_id, product_id, source_key, change_type)
        values (${runId}, ${row.id}, ${`/e2e-newsletter/${row.slug}/`}, 'created')
      `;
    }
    seeded = rows.map((row) => row.slug);
  });
});

test.afterAll(async () => {
  if (!runId && drafts.length === 0) return;
  await withDatabase(async (sql) => {
    if (drafts.length > 0) await sql`delete from newsletter_campaigns where id in ${sql(drafts)}`;
    if (runId) await sql`delete from sync_runs where id = ${runId}`;
  });
});

async function signIn(page: Page) {
  await page.goto("/admin/vhod");
  await page.getByLabel("Парола").fill(PASSWORD);
  await page.getByRole("button", { name: "Вход" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** The letter as the preview frame was last given it. */
const previewHtml = (page: Page) =>
  page
    .getByTitle("Преглед на бюлетина")
    .getAttribute("srcdoc")
    .then((html) => html ?? "");

test("the owner starts the monthly letter, takes a product out, and the preview follows", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the owner's desk");
  test.skip(!runId, "needs a database with three products to make arrivals of");

  await signIn(page);
  await page.goto("/admin/byuletin");
  // Open already when there is no letter yet; a press opens it otherwise.
  const start = page.locator("details", { has: page.getByText("Започни месечния") });
  if (!(await start.evaluate((details) => (details as HTMLDetailsElement).open))) {
    await page.getByText("Нов бюлетин", { exact: true }).click();
  }
  // The monthly option says what it would hold, from the catalog.
  await expect(page.getByText(/Сега ще съдържа \d+ нов/)).toBeVisible();
  await page.getByRole("button", { name: "Започни месечния" }).click();

  await expect(page).toHaveURL(/\/admin\/byuletin\/[0-9a-f-]{36}$/);
  drafts.push(page.url().split("/").at(-1)!);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Новите продукти в магазина през",
  );

  // The new arrivals, drawn as products, in a block of their own.
  const block = page.getByRole("listitem", { name: "Избрани продукти" });
  await expect(block.locator("[data-product]")).toHaveCount(3);
  const rows = await block
    .locator("[data-product]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-product") ?? ""));
  expect([...rows].sort()).toEqual([...seeded].sort());
  const [first, ...rest] = rows;

  // The preview is the letter, with every one of them in it.
  await expect.poll(async () => (await previewHtml(page)).includes(`/bg/${first}?`)).toBe(true);

  // Take the first out: the block redraws at once, the preview a moment later.
  await block
    .locator(`[data-product="${first}"]`)
    .getByRole("button", { name: /^Махни: / })
    .click();
  await expect(block.locator("[data-product]")).toHaveCount(2);
  await expect.poll(async () => (await previewHtml(page)).includes(`/bg/${first}?`)).toBe(false);
  for (const slug of rest) expect(await previewHtml(page)).toContain(`/bg/${slug}?`);

  // And the body the form saves is the list without it.
  await page.getByRole("button", { name: "Запази черновата" }).click();
  await expect(page.getByText(/Черновата е запазена в/)).toBeVisible();
  await page.getByRole("button", { name: "Markdown" }).click();
  await expect(page.getByLabel("Текст")).toHaveValue(
    new RegExp(`\\[\\[продукти: ${rest.join(", ")}\\]\\]`),
  );
});
