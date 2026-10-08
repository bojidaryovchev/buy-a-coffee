# Pending migrations

Temporary. This directory exists only while the work in
[IMPLEMENTATION_PLAN.md](../../../IMPLEMENTATION_PLAN.md) is being built on
several branches at once.

Numbered migrations in `../migrations/` share one journal, so two branches that
both add `0006_*` cannot both merge. While that is the case:

- **Do not add files to `../migrations/`.**
- Change the schema in `src/schema/*.ts` as usual, and put the matching SQL in
  one file here, named after your branch: `migrations-pending/<branch>.sql`.
- Every statement must be safe to run twice — `ADD COLUMN IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`, `ALTER TYPE … ADD VALUE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`.
- Separate statements with `--> statement-breakpoint`, as the numbered
  migrations do.

`pnpm db:migrate` and the integration-test database both apply the numbered
migrations first and then every file here, in name order.

Before this reaches `main`, the files here are folded into one numbered
migration, and `src/pending.ts` and this directory are deleted.
