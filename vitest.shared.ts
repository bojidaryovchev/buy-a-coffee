/**
 * What counts as an integration test, in one place.
 *
 * The root `vitest.config.ts` builds its projects from this, and so does the
 * CI workflow by running those projects, so "unit" and "integration" mean the
 * same thing to `pnpm test`, `pnpm test:integration` and CI.
 *
 * The rule is the file name, because a name is visible in a directory listing
 * and a test cannot drift into the wrong group by changing an import:
 *
 *   *.integration.test.ts  needs PostgreSQL, builds its own private database
 *   *.db.test.ts           reads the development catalog in DATABASE_URL
 *
 * **`*.db.test.ts` is read-only, by rule.** Those files all share one catalog
 * and run in parallel workers, so a row one of them writes — even one it
 * deletes again in `afterAll` — is in every other file's catalog for as long
 * as it exists, and makes a neighbour fail once in a while. A test that has to
 * write is an integration test: it builds a private database
 * (`apps/web/test/helpers/test-db.ts`, or `setupTestDatabase` in scraper-core)
 * and puts the few rows it needs there. `apps/web/test/db-tests-read-only.test.ts`
 * reads every `*.db.test.ts` in the repository and fails on a write.
 *
 * Both skip, with a warning, when no database answers; see
 * `vitest.integration-setup.ts`. Everything else is a unit test and must pass
 * with no server of any kind.
 */
export const INTEGRATION_TEST_FILES = ["**/*.integration.test.ts", "**/*.db.test.ts"] as const;

export const IGNORED_DIRECTORIES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/e2e/**",
  "**/.next/**",
] as const;

/** Test locations outside the storefront, which has its own aliases and project. */
export const WORKSPACE_TEST_FILES = [
  "packages/**/test/**/*.test.ts",
  "apps/scraper/test/**/*.test.ts",
] as const;

export const TIMEOUTS = { testTimeout: 30_000, hookTimeout: 60_000 } as const;

/**
 * The unit projects run with no database configured at all. A test that needs
 * one then skips itself, and shows up as skipped, instead of quietly
 * depending on whatever `.env.local` happens to point at.
 */
export const NO_DATABASE_ENV = { DATABASE_URL: "", TEST_DATABASE_URL: "" } as const;
