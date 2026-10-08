import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";

/**
 * Pending migrations.
 *
 * A staging area that exists only while several branches are changing the
 * schema at once. Numbered migrations share one journal file, so two branches
 * that each add `0006_*` cannot both merge. Instead, each branch drops an
 * idempotent SQL file into `migrations-pending/`, and this applies them after
 * the numbered migrations.
 *
 * Before the work reaches `main` the pending files are folded into a single
 * numbered migration and this module, with its two call sites, is deleted.
 * See `migrations-pending/README.md`.
 */

export const PENDING_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations-pending",
);

/** Same separator Drizzle's own migration files use. */
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/**
 * Apply every `*.sql` file in the pending directory, in name order.
 *
 * Nothing records what has been applied: each file must be safe to run twice
 * (`IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`, `CREATE OR REPLACE`).
 */
export async function applyPendingMigrations(
  sql: postgres.Sql,
  directory: string = PENDING_MIGRATIONS_DIR,
): Promise<string[]> {
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  } catch {
    return [];
  }

  for (const file of files) {
    const text = await readFile(path.join(directory, file), "utf8");
    for (const statement of text.split(STATEMENT_BREAKPOINT)) {
      if (statement.trim()) await sql.unsafe(statement);
    }
  }
  return files;
}
