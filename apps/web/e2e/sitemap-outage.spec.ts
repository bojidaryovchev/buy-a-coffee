import { expect, test, type APIRequestContext } from "@playwright/test";
import { createDatabase } from "@catalog/db";
import { writableDatabaseUrl } from "./support/local-database";

/**
 * The database gone, `/sitemap.xml` is the copy kept from the last good draw,
 * not a 500 (`lib/seo/sitemap-copy.ts`).
 *
 * The sitemap used to be a file deployed at build, which never failed; drawn
 * on request, it reads the database every time the CDN asks. This takes the
 * database away from the running server — new connections refused
 * (`allow_connections false`) and the server's own ended — after a good draw
 * and after a revalidation, which is the hard case: the next request has to
 * draw, the draw fails, and the kept copy, which a revalidation must not
 * expire, stands in. Then it gives the database back and the sitemap is drawn
 * fresh again.
 *
 * It runs in the "outage" project (`playwright.config.ts`), last and alone:
 * nothing else could run while the database is gone. It only ever touches a
 * local database, or CI's own (`writableDatabaseUrl`), from the server's
 * maintenance database `postgres`, and gives it back in every case, at the
 * start too, should an earlier run have stopped half-way. On its own:
 * `test:e2e --project outage --no-deps e2e/sitemap-outage.spec.ts`.
 */

/** As `playwright.config.ts` gives the server; not the secret of anything. */
const REVALIDATE_SECRET = "e2e-only-revalidate-secret-not-a-real-one-0123456789";

let maintenance: ReturnType<typeof createDatabase>;
let target: string;

const giveBack = () =>
  maintenance.sql.unsafe(`alter database "${target}" allow_connections true`).then(() => undefined);

async function takeAway(): Promise<void> {
  await maintenance.sql.unsafe(`alter database "${target}" allow_connections false`);
  await maintenance.sql`
    select pg_terminate_backend(pid) from pg_stat_activity
    where datname = ${target} and pid <> pg_backend_pid()`;
}

const declareChanged = (request: APIRequestContext) =>
  request.post("/api/revalidate", {
    headers: { authorization: `Bearer ${REVALIDATE_SECRET}` },
    data: { scope: "catalog" },
  });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // Throws, before anything is touched, for a database that is not local.
  const url = new URL(writableDatabaseUrl());
  target = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]+$/.test(target)) throw new Error(`Unexpected database name: ${target}`);
  url.pathname = "/postgres";
  maintenance = createDatabase({ url: url.toString(), max: 1 });
  await giveBack();
});

test.afterAll(async () => {
  if (!maintenance) return;
  try {
    await giveBack();
  } finally {
    await maintenance.close();
  }
});

test("the database gone, even after a revalidation, the sitemap is the last good copy", async ({
  request,
}) => {
  // A good draw, kept: declared changed first, so this one is drawn, not reused.
  expect((await declareChanged(request)).status()).toBe(200);
  const good = await request.get("/sitemap.xml");
  expect(good.status()).toBe(200);
  expect(good.headers()["x-sitemap-copy"]).toBe("drawn");
  const xml = await good.text();
  expect(xml).toContain("<urlset");

  await takeAway();
  try {
    // The hard case: the next request must draw, and cannot.
    expect((await declareChanged(request)).status()).toBe(200);

    const kept = await request.get("/sitemap.xml");
    expect(kept.status()).toBe(200);
    expect(kept.headers()["x-sitemap-copy"]).toBe("kept");
    expect(kept.headers()["content-type"]).toBe("application/xml");
    // The CDN asks again within a minute, and stands in with its own copy on an error.
    expect(kept.headers()["cdn-cache-control"]).toBe("public, s-maxage=60, stale-if-error=86400");
    expect(await kept.text()).toBe(xml);

    // A query string is sent to the plain address without a draw, database or not.
    const odd = await request.get("/sitemap.xml?nocache=1", { maxRedirects: 0 });
    expect(odd.status()).toBe(308);
    expect(odd.headers()["location"]).toBe("/sitemap.xml");
  } finally {
    await giveBack();
  }

  // Back: drawn fresh again.
  await expect(async () => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["x-sitemap-copy"]).toBe("drawn");
  }).toPass({ timeout: 30_000 });
});
