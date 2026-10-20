import { assertLocalDatabase } from "./database";

/**
 * The database a spec may write to, or an error before anything is written.
 *
 * A spec that writes rows (`promotion.spec.ts`) writes to `DATABASE_URL`,
 * which is whatever the shell running Playwright holds — and a shell that once
 * pointed at production for a migration may still. So a write is allowed only
 * to a server on this machine, or in CI, whose database is the job's own
 * service: the one rule, `assertLocalDatabase`, every spec that writes obeys.
 */
export function writableDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec writes to the build's database");
  assertLocalDatabase(url);
  return url;
}
