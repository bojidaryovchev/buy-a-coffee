import "server-only";
import { createDatabase, type Database } from "@catalog/db";

/**
 * Database access for the storefront.
 *
 * `server-only` makes it a build error to import this from a client component:
 * the connection string must never reach a browser bundle.
 *
 * The client is created once per server process and cached on `globalThis` so
 * Next.js's dev-mode module reloading does not open a new pool on every edit
 * until the database runs out of connections.
 */

declare global {
   
  var __catalogDb: { db: Database; close: () => Promise<void> } | undefined;
}

function create(): { db: Database; close: () => Promise<void> } {
  const { db, close } = createDatabase({
    // A web process serves many concurrent requests, unlike the Lambda.
    max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "10", 10),
    idleTimeoutSeconds: 30,
  });
  return { db, close };
}

export const db: Database = (globalThis.__catalogDb ??= create()).db;
