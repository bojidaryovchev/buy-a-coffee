import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { applyPendingMigrations, createDatabase, type Database } from "@catalog/db";

/**
 * A private, migrated database for one integration test file.
 *
 * The storefront's `db` reads `DATABASE_URL` once, when `@/lib/db` is first
 * imported, so a test calls `useTestDatabase()` BEFORE importing anything that
 * touches it and then imports that module dynamically.
 *
 * One database per file (`suffix`), not one per suite: Vitest runs files in
 * parallel, and two files truncating the same tables would fail each other at
 * random. The name derives from `TEST_DATABASE_NAME`, as the scraper's tests do,
 * so several checkouts can share a server.
 */

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../../../packages/db/migrations");

function baseUrl(): string | null {
  return process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
}

export async function isDatabaseAvailable(): Promise<boolean> {
  const url = baseUrl();
  if (!url) return false;
  try {
    const { sql, close } = createDatabase({ url, max: 1, connectTimeoutSeconds: 3 });
    try {
      await sql`select 1`;
      return true;
    } finally {
      await close();
    }
  } catch {
    return false;
  }
}

export async function useTestDatabase(
  suffix: string,
): Promise<{ db: Database; url: string; close: () => Promise<void> }> {
  const base = baseUrl();
  if (!base) throw new Error("No TEST_DATABASE_URL or DATABASE_URL");
  if (!/^[a-z0-9_]+$/.test(suffix)) throw new Error("suffix must be [a-z0-9_]");

  const prefix = /^[a-z0-9_]+$/.test(process.env.TEST_DATABASE_NAME ?? "")
    ? (process.env.TEST_DATABASE_NAME as string)
    : "catalog_test";
  const name = `${prefix}_${suffix}`;
  if (name.length > 63) throw new Error(`database name too long: ${name}`);

  const admin = createDatabase({ url: base, max: 1 });
  try {
    const existing = await admin.sql`select 1 from pg_database where datname = ${name}`;
    // Identifier cannot be parameterised; both parts were checked above.
    if (existing.length === 0) await admin.sql.unsafe(`create database ${name}`);
  } finally {
    await admin.close();
  }

  const url = new URL(base);
  url.pathname = `/${name}`;

  const { db, sql, close } = createDatabase({ url: url.toString(), max: 2 });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  // Temporary: see packages/db/migrations-pending/README.md.
  await applyPendingMigrations(sql);

  process.env.DATABASE_URL = url.toString();
  return { db, url: url.toString(), close };
}
