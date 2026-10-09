import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { createDatabase, type Database } from "@catalog/db";

/**
 * Integration-test database.
 *
 * Uses a dedicated `*_test` database on the same server so a test run can
 * never truncate the development catalog. Migrations are applied from the same
 * files production uses, so the schema under test is the real schema.
 */

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/migrations",
);

/**
 * Overridable so that several checkouts can run the integration suite against
 * one server at the same time without truncating each other's tables.
 */
export const TEST_DATABASE_NAME = /^[a-z0-9_]+$/.test(process.env.TEST_DATABASE_NAME ?? "")
  ? (process.env.TEST_DATABASE_NAME as string)
  : "catalog_test";

export function baseDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgres://catalog:catalog@localhost:5433/catalog"
  );
}

export function testDatabaseUrl(): string {
  const url = new URL(baseDatabaseUrl());
  url.pathname = `/${TEST_DATABASE_NAME}`;
  return url.toString();
}

/** True when a PostgreSQL server is reachable; integration tests skip if not. */
export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const { sql: client, close } = createDatabase({ url: baseDatabaseUrl(), max: 1 });
    try {
      await client`select 1`;
      return true;
    } finally {
      await close();
    }
  } catch {
    return false;
  }
}

/**
 * Create the test database (if needed) and bring its schema up to date.
 *
 * **One caller at a time.** This database is shared on purpose by more than
 * one test file (the sync suite here and the storefront's rate-limit suite),
 * and Vitest runs files in parallel, in separate workers. On a database that
 * does not exist yet — the first run in a new checkout, or in CI — two workers
 * used to arrive here together: both found no database and both created it
 * (`pg_database_datname_index`), or both found no migration journal and both
 * ran the first migration (`CREATE TYPE availability`, failing on
 * `pg_type_typname_nsp_index`). Whichever lost skipped its whole file, and
 * the rerun passed because by then there was nothing left to create.
 *
 * So creating and migrating happen under a PostgreSQL advisory lock keyed by
 * the database's name, held on the admin connection. A lock in the server
 * rather than in this process, because the callers are different processes.
 * It is taken in the base database, which every caller of this helper shares
 * within a run; closing the connection releases it even if a step throws.
 */
export async function setupTestDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  // One connection, so the lock, the work and the unlock are one session.
  const admin = createDatabase({ url: baseDatabaseUrl(), max: 1 });
  try {
    await admin.sql`select pg_advisory_lock(hashtext(${`test-db-setup:${TEST_DATABASE_NAME}`}))`;

    const existing = await admin.sql`
      select 1 from pg_database where datname = ${TEST_DATABASE_NAME}
    `;
    if (existing.length === 0) {
      // Identifier cannot be parameterised; the name is a module constant.
      await admin.sql.unsafe(`create database ${TEST_DATABASE_NAME}`);
    }

    const { db, close } = createDatabase({ url: testDatabaseUrl(), max: 1 });
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    } catch (error) {
      await close();
      throw error;
    }
    return { db, close };
  } finally {
    // Ends the session, and with it the lock.
    await admin.close();
  }
}

/**
 * Empty every catalog table between tests.
 *
 * `truncate ... cascade` in one statement keeps foreign keys satisfied and is
 * far faster than deleting row by row.
 */
export async function resetTestDatabase(db: Database): Promise<void> {
  await db.execute(sql`
    truncate table
      sync_changes,
      sync_runs,
      catalog_baselines,
      product_images,
      product_categories,
      products,
      categories,
      brands,
      page_links,
      page_snapshots,
      discovered_pages,
      scrape_errors,
      observed_features,
      observed_filters,
      observed_forms,
      observed_route_patterns,
      crawl_runs,
      source_sites
    restart identity cascade
  `);
}

/** Available for manual cleanup; not used automatically. */
export async function dropTestDatabase(): Promise<void> {
  const exec = promisify(execFile);
  void exec;
  const admin = createDatabase({ url: baseDatabaseUrl(), max: 1 });
  try {
    await admin.sql.unsafe(`drop database if exists ${TEST_DATABASE_NAME} with (force)`);
  } finally {
    await admin.close();
  }
}
