import { createDatabase } from "@catalog/db";

/**
 * The database the server under test reads (`DATABASE_URL`, which the
 * Playwright config hands to `next start`), for a spec that has to choose
 * its data or clean up what it made.
 *
 * Only for that. What a spec checks it reads from the pages, as a visitor
 * does; this is the test's own bookkeeping, never the thing under test.
 *
 * And only on a database on this machine (or in CI, which has its own): a
 * spec that cleans up deletes rows, and a `DATABASE_URL` left pointing at
 * production in a terminal must make it stop before it connects, not after.
 */
export function assertLocalDatabase(url: string, ci = process.env.CI): void {
  if (ci) return;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a URL; the e2e suite will not touch it");
  }
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(
      `DATABASE_URL points at ${host}: the e2e suite writes only to a database on localhost or 127.0.0.1 (or in CI)`,
    );
  }
}

export async function withDatabase<T>(
  work: (sql: ReturnType<typeof createDatabase>["sql"]) => Promise<T>,
): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: the e2e suite runs against a database");
  assertLocalDatabase(url);
  const { sql, close } = createDatabase({ url, max: 1 });
  try {
    return await work(sql);
  } finally {
    await close();
  }
}
