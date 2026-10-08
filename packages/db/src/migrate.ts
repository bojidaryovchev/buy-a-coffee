import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./client.ts";
import { applyPendingMigrations } from "./pending.ts";

/**
 * Apply pending migrations. Safe to run repeatedly: Drizzle records applied
 * migrations in its own journal table.
 */
async function main(): Promise<void> {
  const migrationsFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../migrations",
  );
  const { db, sql, close } = createDatabase({ max: 1 });
  try {
    console.log(JSON.stringify({ level: "info", msg: "migrate:start", migrationsFolder }));
    await migrate(db, { migrationsFolder });
    // Temporary: see migrations-pending/README.md.
    const pending = await applyPendingMigrations(sql);
    console.log(JSON.stringify({ level: "info", msg: "migrate:done", pending }));
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "migrate:failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
