import path from "node:path";
import { defineConfig } from "vitest/config";
import { webBase } from "./apps/web/vitest.base.ts";
import {
  IGNORED_DIRECTORIES,
  INTEGRATION_TEST_FILES,
  MIXED_TEST_FILES,
  NO_DATABASE_ENV,
  TIMEOUTS,
  WORKSPACE_TEST_FILES,
} from "./vitest.shared.ts";

/**
 * Four projects: unit and integration, for the packages and for the storefront.
 *
 *   pnpm test              unit + web-unit            no server needed
 *   pnpm test:integration  integration + web-integration   needs PostgreSQL
 *   pnpm test:all          all four
 *
 * The storefront is its own pair of projects because its modules need the
 * JSX runtime, the path aliases and the `server-only` stub in
 * `apps/web/vitest.base.ts`. The split between unit and integration is the file name
 * (see `vitest.shared.ts`); it is not repeated anywhere else.
 */
/*
 * Absolute, because `pnpm --filter @catalog/web test` runs this config from
 * `apps/web` with `--root ../..`, and a relative path would resolve from there.
 */
const here = (...parts: string[]) => path.resolve(import.meta.dirname, ...parts);
const webRoot = here("apps/web");
const globalSetup = [here("vitest.integration-setup.ts")];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: [...WORKSPACE_TEST_FILES],
          exclude: [...IGNORED_DIRECTORIES, ...INTEGRATION_TEST_FILES],
          env: NO_DATABASE_ENV,
          ...TIMEOUTS,
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: WORKSPACE_TEST_FILES.map((glob) =>
            glob.replace("*.test.ts", "*.{integration,db}.test.ts"),
          ),
          exclude: [...IGNORED_DIRECTORIES],
          globalSetup,
          ...TIMEOUTS,
        },
      },
      {
        ...webBase,
        test: {
          name: "web-unit",
          root: webRoot,
          include: ["test/**/*.test.ts"],
          exclude: [...IGNORED_DIRECTORIES, ...INTEGRATION_TEST_FILES],
          env: NO_DATABASE_ENV,
          ...TIMEOUTS,
        },
      },
      {
        ...webBase,
        test: {
          name: "web-integration",
          root: webRoot,
          include: ["test/**/*.{integration,db}.test.ts", ...MIXED_TEST_FILES],
          exclude: [...IGNORED_DIRECTORIES],
          globalSetup,
          ...TIMEOUTS,
        },
      },
    ],
  },
});
