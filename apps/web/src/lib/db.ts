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

/**
 * Default pool size, which depends on what a "process" means here.
 *
 * On a long-running server one process serves many concurrent requests, so a
 * pool of 10 is right. On Vercel every concurrent function instance is its own
 * process with its own pool, so 10 becomes 10 x N against a database that will
 * not have that many connections - and the failure arrives as connection
 * refusals under exactly the traffic you wanted.
 *
 * `VERCEL` is set on every Vercel runtime. Override with `DATABASE_POOL_MAX`
 * when pointing at a pooler that can take more.
 */
const DEFAULT_POOL_MAX = process.env.VERCEL ? "2" : "10";

function create(): { db: Database; close: () => Promise<void> } {
  const { db, close } = createDatabase({
    max: Number.parseInt(
      process.env.DATABASE_POOL_MAX ?? DEFAULT_POOL_MAX,
      10,
    ),
    idleTimeoutSeconds: 30,
  });
  return { db, close };
}

export const db: Database = (globalThis.__catalogDb ??= create()).db;
