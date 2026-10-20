import { createDatabase } from "@catalog/db";

/**
 * The database the server under test reads (`DATABASE_URL`, which the
 * Playwright config hands to `next start`), for a spec that has to choose
 * its data or clean up what it made.
 *
 * Only for that. What a spec checks it reads from the pages, as a visitor
 * does; this is the test's own bookkeeping, never the thing under test.
 */
export async function withDatabase<T>(
  work: (sql: ReturnType<typeof createDatabase>["sql"]) => Promise<T>,
): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: the e2e suite runs against a database");
  const { sql, close } = createDatabase({ url, max: 1 });
  try {
    return await work(sql);
  } finally {
    await close();
  }
}
