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

export const TEST_DATABASE_NAME = "catalog_test";

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

/** Create the test database (if needed) and bring its schema up to date. */
export async function setupTestDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const admin = createDatabase({ url: baseDatabaseUrl(), max: 1 });
  try {
    const existing = await admin.sql`
      select 1 from pg_database where datname = ${TEST_DATABASE_NAME}
    `;
    if (existing.length === 0) {
      // Identifier cannot be parameterised; the name is a module constant.
      await admin.sql.unsafe(`create database ${TEST_DATABASE_NAME}`);
    }
  } finally {
    await admin.close();
  }

  const { db, close } = createDatabase({ url: testDatabaseUrl(), max: 1 });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close };
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
