import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    /*
     * apps/web is excluded on purpose: it has its own Vitest config with the
     * path aliases and the `server-only` stub its modules require. The root
     * `test` script runs both.
     */
    include: ["packages/**/test/**/*.test.ts", "apps/scraper/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**", "**/.next/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: process.env.CI ? ["default"] : ["default"],
  },
});
