/**
 * Runs once before the integration projects, in the main process.
 *
 * Answers one question loudly: is PostgreSQL there? The tests each skip
 * themselves when it is not, which is right on a laptop with no database but
 * means a run can end green having tested nothing. So:
 *
 *  - locally, an unreachable server prints a warning that says plainly the
 *    database-backed tests will be skipped, not passed;
 *  - in CI (`CI` set) it is an error. CI provisions a database, so one that
 *    does not answer is a broken job, not a reason to pass.
 *
 * The address checked is the one the tests use: `TEST_DATABASE_URL`, then
 * `DATABASE_URL`, then the repository's docker-compose default.
 */
import { createDatabase } from "./packages/db/src/index.ts";

const DEFAULT_URL = "postgres://catalog:catalog@localhost:5433/catalog";

/**
 * Both integration projects register this file, and each registration gets its
 * own copy of the module, so a module-level flag would not dedupe. The process
 * is shared, so the flag lives on it.
 */
const CHECKED = Symbol.for("catalog.integration-setup.checked");

function describeFailure(error: unknown): string {
  // A refused connection arrives as an AggregateError with no message of its own.
  const cause = (error as { errors?: Array<{ code?: string }> } | null)?.errors?.[0];
  const code = (error as { code?: string } | null)?.code ?? cause?.code;
  const message = error instanceof Error ? error.message.trim().split("\n")[0] : String(error);
  return code ?? (message || "connection failed");
}

export default async function setup(): Promise<void> {
  const flags = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (flags[CHECKED]) return;
  flags[CHECKED] = true;

  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_URL;
  const target = (() => {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}:${parsed.port || "5432"}`;
    } catch {
      return "(unparseable URL)";
    }
  })();

  const handle = createDatabase({ url, max: 1, connectTimeoutSeconds: 3 });
  try {
    await handle.sql`select 1`;
    return;
  } catch (error) {
    const reason = describeFailure(error);
    if (process.env.CI) {
      throw new Error(
        `[integration] PostgreSQL is not reachable at ${target} (${reason}). ` +
          "CI provides a database, so the integration tests must not be skipped here.",
      );
    }
    console.warn(
      "\n" +
        "================================================================================\n" +
        `[integration] PostgreSQL is NOT reachable at ${target} (${reason}).\n` +
        "[integration] Every database-backed test below will be SKIPPED, not passed.\n" +
        "[integration] Start one with `docker compose up -d`, then run `pnpm db:migrate`.\n" +
        "================================================================================\n",
    );
  } finally {
    await handle.close().catch(() => undefined);
  }
}
