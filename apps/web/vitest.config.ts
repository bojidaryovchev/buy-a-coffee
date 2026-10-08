import { defineConfig } from "vitest/config";
import { webBase } from "./vitest.base.ts";

/**
 * The storefront's tests on their own, for an editor or `vitest` run from this
 * directory: unit and integration together.
 *
 * `pnpm test` and `pnpm test:integration` (and CI) go through the root
 * `vitest.config.ts`, which splits them into the `web-unit` and
 * `web-integration` projects. The split is by file name; see
 * `vitest.shared.ts` at the root.
 */
export default defineConfig({
  ...webBase,
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
