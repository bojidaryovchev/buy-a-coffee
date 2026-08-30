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
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Mobile is a first-class target, not an afterthought: the drawer,
    // filter sheet and layout all differ there.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
