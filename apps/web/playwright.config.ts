import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * They run against a real production build backed by the real database, so
 * what is tested is what ships. No test touches the source site.
 *
 * The port is deliberately unusual, and `reuseExistingServer` is off. An
 * earlier run reused a *different* application that happened to be listening
 * on the chosen port: generic assertions passed against someone else's site,
 * which is far worse than a failing test. Refusing to reuse means a port
 * collision fails loudly instead.
 */
const PORT = Number(process.env.E2E_PORT ?? 8765);

/** The specs that write shop-wide state to the database (the "after" project below). */
const SHOP_WIDE = /(^|[\\/])(promotion|promotions|sitemap-fresh)\.spec\.ts$/;
/** The spec that takes the database away from the server (the "outage" project below). */
const OUTAGE = /(^|[\\/])sitemap-outage\.spec\.ts$/;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  /*
   * Every worker drives the same single `next start` process. Playwright's
   * local default (half the cores) only queues requests behind each other, and
   * on a busy machine that turned client-side navigations into ten-second
   * timeouts that had nothing to do with the code under test.
   */
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: [SHOP_WIDE, OUTAGE] },
    // Mobile is a first-class target, not an afterthought: the drawer,
    // filter sheet and layout all differ there.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: [SHOP_WIDE, OUTAGE] },
    /*
     * Specs that change what the whole shop shows run once every other spec
     * has finished, and one at a time. The sitemap is drawn per request, so
     * whatever they write is in it at once: a promotion puts the promotions
     * page in it and takes it out again (`promotion.spec.ts`, and
     * `promotions.spec.ts` through the panel), and `sitemap-fresh.spec.ts`
     * adds a product to it and to the Lavazza beans landing. A spec walking
     * the sitemap (`seo-audit`, `link-graph`) or comparing it with a page
     * (`stitch`) in the middle of that would read a shop that is half changed,
     * so these run after them. And against each other: `promotions.spec.ts`
     * promotes a Lavazza bean product it picks from the database, which could
     * be the one `sitemap-fresh.spec.ts` adds and deletes, and checks badges a
     * second running promotion would also draw. Desktop only; every spec here
     * either is, or writes what the phone run would read twice. If a spec in
     * the projects before them fails, these are reported as not run.
     */
    {
      name: "after",
      use: { ...devices["Desktop Chrome"] },
      testMatch: SHOP_WIDE,
      dependencies: ["desktop", "mobile"],
      workers: 1,
    },
    /*
     * Last and alone: the database is taken away from the server and given
     * back, to show the sitemap stands in with its kept copy. Nothing else
     * could run while the database is gone.
     */
    {
      name: "outage",
      use: { ...devices["Desktop Chrome"] },
      testMatch: OUTAGE,
      dependencies: ["after"],
      workers: 1,
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: false,
        /*
         * The admin gate redirects a signed-out visitor to the login page only
         * when the panel is configured; with no password it shows a "disabled"
         * notice instead, and a spec that checks the redirect would pass or
         * fail on whatever the machine's `.env.local` happened to hold. These
         * throwaway values make the gate's behaviour part of the test setup.
         * They exist only for the server this config starts, and they are not
         * the password of anything; `promotions.spec.ts` signs in with this one
         * to drive the panel.
         */
        env: {
          ADMIN_PASSWORD: "e2e-only-not-a-real-password",
          ADMIN_SESSION_SECRET: "e2e-only-not-a-real-session-secret-0123456789",
          // Served at /<key>.txt for `seo-audit.spec.ts`; no spec submits anything.
          INDEXNOW_KEY: "e2e-only-indexnow-key-0123",
          // Opens `/api/revalidate` to the specs that hold it
          // (`sitemap-fresh.spec.ts`, `sitemap-outage.spec.ts`). Not the
          // secret of anything.
          REVALIDATE_SECRET: "e2e-only-revalidate-secret-not-a-real-one-0123456789",
          // Runs against one database add up within the endpoint's ten-minute
          // window; honoured only off a deployment (`revalidateCallLimit`).
          REVALIDATE_RATE_LIMIT: "1000",
        },
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
