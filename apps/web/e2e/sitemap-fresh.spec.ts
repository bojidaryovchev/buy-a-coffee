import { expect, test, type APIRequestContext } from "@playwright/test";
import { createDatabase } from "@catalog/db";
import { writableDatabaseUrl } from "./support/local-database";
import { BG } from "./support/paths";

/**
 * A change to the catalog reaches the sitemap and the cached pages without a
 * deploy.
 *
 * The sitemap used to be the copy drawn at build: on Vercel it was deployed as
 * a static file and never redrawn (`app/sitemap.xml/route.ts` says why). It is
 * drawn on request now, so a product the sync adds, a change to it and its
 * removal are in the very next answer; `next start` has no CDN in front, and
 * the hour the CDN keeps a copy for is the one part this cannot show (see
 * `docs/architecture.md`, "Catalog freshness", for checking it on a preview).
 *
 * The listings are prerendered and kept for five minutes, so a product joining
 * one is not in its next answer: `POST /api/revalidate`, which the sync and the
 * copy scripts call after a run, is what redraws it, and this holds it to
 * that, on the Lavazza beans landing (as `promotions.spec.ts` does).
 *
 * The spec writes its own product — a copy of a Lavazza bean product with its
 * photographs, under a slug no page has been rendered at — and takes it away
 * again. It runs in the "after" project (`playwright.config.ts`): a product in
 * the sitemap, named like the one it copies, would fail the specs that walk
 * the sitemap if they met it. It writes only to a local database, or CI's own
 * (`writableDatabaseUrl`), and refuses before the first write otherwise. On
 * its own: `test:e2e --project after --no-deps e2e/sitemap-fresh.spec.ts`.
 */

const SLUG_PREFIX = "e2e-karta-";
/** As `playwright.config.ts` gives the server; not the secret of anything. */
const CRON_SECRET = "e2e-only-cron-secret-not-a-real-one-0123456789";
/** Its source's last change, then ours: what its `<lastmod>` should say. */
const CHANGED = "2026-03-01T10:00:00.000Z";
const REWRITTEN = "2026-04-02T09:30:00.000Z";
/** A listing prerendered with a five-minute `revalidate`, which the copy can join. */
const LANDING = BG.lavazzaBeans;

let database: ReturnType<typeof createDatabase>;
let source: { id: string; slug: string };
let copyId: string;
let slug: string;
let photos: number;

/** The `<url>` entry for a path, or null when the sitemap does not list it. */
async function entryFor(request: APIRequestContext, path: string): Promise<string | null> {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1]!);
  return entries.find((entry) => new RegExp(`<loc>[^<]+${path}</loc>`).test(entry)) ?? null;
}

const linksTo = (html: string, path: string) => html.includes(`href="${path}"`);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // Throws, before anything is written, for a database that is not local.
  database = createDatabase({ url: writableDatabaseUrl(), max: 1 });
  const { sql } = database;
  // Whatever an interrupted run left behind.
  await sql`delete from products where slug like ${`${SLUG_PREFIX}%`}`;

  // A Lavazza bean product on sale with photographs of its own.
  const [found] = await sql<Array<{ id: string; slug: string }>>`
    select p.id, p.slug from products p
    join brands b on b.id = p.brand_id
    where p.status = 'active' and b.slug = 'lavazza'
      and exists (select 1 from product_categories pc
                  join categories c on c.id = pc.category_id
                  where pc.product_id = p.id
                    and (c.slug = 'kafe-na-zarna' or c.source_key = 'kafe-na-zarna'))
      and exists (select 1 from product_images i
                  where i.product_id = p.id and i.status = 'active' and i.object_key is not null)
    order by p.slug
    limit 1`;
  if (!found) throw new Error("The catalog has no Lavazza bean product with photographs to copy");
  source = found;

  // As the sync adds one; in no category yet, so on no listing yet.
  slug = `${SLUG_PREFIX}${Date.now().toString(36)}`;
  const [copy] = await sql<Array<{ id: string }>>`
    insert into products (
      source_site_id, source_key, source_url, source_path, name, slug, current_price,
      currency, availability, brand_id, weight, weight_value, weight_unit, attributes,
      semantic_hash, status, first_seen_at, last_changed_at
    )
    select source_site_id, ${`/${slug}/`}, ${`https://example.invalid/${slug}/`}, ${`/${slug}/`},
      name, ${slug}, current_price, currency, availability, brand_id, weight, weight_value,
      weight_unit, attributes, ${slug}, 'active', first_seen_at, ${CHANGED}::timestamptz
    from products where id = ${source.id}
    returning id`;
  copyId = copy!.id;
  const images = await sql`
    insert into product_images (product_id, source_url, object_key, public_url, mime_type,
      width, height, ordinal, is_primary, status)
    select ${copyId}, source_url, object_key, public_url, mime_type, width, height, ordinal,
      is_primary, status
    from product_images
    where product_id = ${source.id} and status = 'active' and object_key is not null
    returning id`;
  photos = images.length;
});

test.afterAll(async () => {
  if (!database) return;
  try {
    // Its photographs and category links go with it (`on delete cascade`).
    await database.sql`delete from products where slug like ${`${SLUG_PREFIX}%`}`;
  } finally {
    await database.close();
  }
});

test("a product added to the catalog is in the next sitemap, dated by its own change", async ({
  request,
}) => {
  const entry = await entryFor(request, `/bg/${slug}`);
  expect(entry, "the new product's entry").not.toBeNull();
  expect(entry).toContain(`<lastmod>${CHANGED}</lastmod>`);
  expect(entry).toContain("<changefreq>weekly</changefreq>");
  expect(entry).toContain("<priority>0.9</priority>");
  expect(entry).toMatch(new RegExp(`hreflang="bg" href="[^"]+/bg/${slug}"`));
  expect(entry).toMatch(new RegExp(`hreflang="x-default" href="[^"]+/bg/${slug}"`));
  expect(photos).toBeGreaterThan(0);
  expect([...entry!.matchAll(/<image:loc>/g)]).toHaveLength(photos);
});

test("a change to it moves its date in the next sitemap", async ({ request }) => {
  await database.sql`
    update products set copy_written_at = ${REWRITTEN}::timestamptz where slug = ${slug}`;
  const entry = await entryFor(request, `/bg/${slug}`);
  expect(entry).toContain(`<lastmod>${REWRITTEN}</lastmod>`);
});

test("a cached listing it joins shows it only once POST /api/revalidate names the listing", async ({
  request,
}) => {
  // The landing as it is cached now: its products, without the copy.
  let before = "";
  await expect(async () => {
    const response = await request.get(LANDING);
    expect(response.headers()["x-nextjs-cache"]).toBe("HIT");
    before = await response.text();
  }).toPass({ timeout: 30_000 });
  expect(linksTo(before, `/bg/${source.slug}`), "the source is on the landing").toBe(true);
  expect(linksTo(before, `/bg/${slug}`)).toBe(false);

  // Filed where its source is, as a sync would file it.
  await database.sql`
    insert into product_categories (product_id, category_id, is_primary)
    select ${copyId}, category_id, is_primary from product_categories
    where product_id = ${source.id}`;

  // The cached copy does not know.
  const cached = await request.get(LANDING);
  expect(cached.headers()["x-nextjs-cache"]).toBe("HIT");
  expect(linksTo(await cached.text(), `/bg/${slug}`)).toBe(false);

  // Without the secret: refused, and the landing stays as it was.
  const refused = await request.post("/api/revalidate", { data: { paths: [LANDING] } });
  expect(refused.status()).toBe(401);
  expect(linksTo(await (await request.get(LANDING)).text(), `/bg/${slug}`)).toBe(false);

  const response = await request.post("/api/revalidate", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    data: { paths: [LANDING], slugs: [slug] },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    scope: null,
    routes: [],
    paths: [LANDING, `/bg/${slug}`],
    sitemap: "/sitemap.xml",
  });

  await expect(async () => {
    expect(linksTo(await (await request.get(LANDING)).text(), `/bg/${slug}`)).toBe(true);
  }).toPass({ timeout: 15_000 });
});

test("the catalog scope refreshes every page route and the sitemap, and no self-timed one", async ({
  request,
}) => {
  const response = await request.post("/api/revalidate", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    data: { scope: "catalog" },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { routes: string[]; sitemap: string };
  expect(body.routes).toContain("/(site)/[lang]/[slug]");
  expect(body.routes).toContain("/(site)/[lang]/kafe-na-zarna-lavazza");
  expect(body.routes.some((route) => /\/(blog|za-kafemashina)\/\[/.test(route))).toBe(false);
  expect(body.sitemap).toBe("/sitemap.xml");

  // And the pages that prebuild their whole list are still pages, not cached 404s.
  for (const path of [BG.machineBrand("krups"), "/bg/blog/vidove-kapsuli-za-kafe"]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

test("once it is taken off the site it leaves the next sitemap", async ({ request }) => {
  await database.sql`update products set status = 'removed' where slug = ${slug}`;
  expect(await entryFor(request, `/bg/${slug}`)).toBeNull();
});
