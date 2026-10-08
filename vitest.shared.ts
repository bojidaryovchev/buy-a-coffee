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
 * Files that are named as unit tests but contain database-backed sections.
 *
 * `apps/web/test/vending.test.ts` tests a pure naming rule and, further down,
 * the SQL that applies it to a real catalog. Splitting it into a `.test.ts`
 * and a `.db.test.ts` is the proper fix and belongs to the file's owner; until
 * then the integration project runs it as well, so those sections are not
 * stranded where the unit run (which has no database) can never reach them.
 */
export const MIXED_TEST_FILES = ["test/vending.test.ts"] as const;

/**
 * The unit projects run with no database configured at all. A test that needs
 * one then skips itself, and shows up as skipped, instead of quietly
 * depending on whatever `.env.local` happens to point at.
 */
export const NO_DATABASE_ENV = { DATABASE_URL: "", TEST_DATABASE_URL: "" } as const;
