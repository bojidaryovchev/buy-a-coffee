import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./client.ts";

/**
 * Apply pending migrations. Safe to run repeatedly: Drizzle records applied
 * migrations in its own journal table.
 */
async function main(): Promise<void> {
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  const { db, close } = createDatabase({ max: 1 });
  try {
    console.log(JSON.stringify({ level: "info", msg: "migrate:start", migrationsFolder }));
    await migrate(db, { migrationsFolder });
    console.log(JSON.stringify({ level: "info", msg: "migrate:done" }));
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
